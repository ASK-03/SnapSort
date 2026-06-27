import os
import logging
import asyncio
from collections import deque
from multiprocessing import Pool
import db, indexer, worker
from clip_index import CLIPIndex
from clip_processor import CLIPProcessor
from search_engine import SearchEngine

logger = logging.getLogger(__name__)


class Controller:
    def __init__(self, num_workers=4):
        self.num_workers = num_workers
        logger.info("Initializing Controller with %d workers", self.num_workers)

        # Progress tracking
        self.total_images = 0
        self.processed_images = 0
        self.is_scanning = False

        # Initialize database, Faiss index, CLIP index, and worker pool
        self.db         = db.Database("faces.db")
        self.idx        = indexer.FaissIndex("faces.index")
        self.clip_index = CLIPIndex("clip.index")
        self.pool = Pool(processes=self.num_workers, initializer=worker._worker_init)
        self.image_to_faces = {}

        # Search engine (uses main-process CLIP processor for query encoding)
        self._clip_proc   = CLIPProcessor()
        self.search_engine = SearchEngine(self.db, self.clip_index, self._clip_proc)

        # Throttling variables
        self.pending_tasks = 0
        self.max_pending = self.num_workers
        self.image_queue = deque()
        self._save_counter = 0

    def scan_folder(self, folder_path):
        """
        Walk 'folder_path' recursively, collect all .jpg/.png/.jpeg files.
        Queue new images (not yet in DB) for processing.
        """
        if self.is_scanning:
            return {"error": "Already scanning"}
            
        logger.info("Scanning folder: %s", folder_path)
        self.is_scanning = True
        
        all_image_paths = []
        for root, _, files in os.walk(folder_path):
            for fn in files:
                if fn.lower().endswith((".jpg", ".png", ".jpeg")):
                    all_image_paths.append(os.path.join(root, fn))

        # Filter out already-processed images
        processed = self.db.get_processed_images()
        new_images = [p for p in all_image_paths if p not in processed]

        self.total_images = len(new_images)
        self.processed_images = 0

        logger.info(
            "Found %d total images, %d new to index",
            len(all_image_paths),
            len(new_images),
        )

        # Enqueue only the new images for face-processing/indexing
        self.image_queue = deque(new_images)
        self._submit_next_images()
        
        return {"total_images": len(all_image_paths), "new_images": len(new_images)}

    def _submit_next_images(self):
        """
        If there are queued images and we haven't hit max pending tasks, dispatch them to worker pool.
        """
        while self.image_queue and self.pending_tasks < self.max_pending:
            path = self.image_queue.popleft()
            self.pending_tasks += 1
            self.pool.apply_async(
                worker.process_image,
                args=(path,),
                callback=self._handle_image_result,
                error_callback=self._handle_worker_error,
            )

    def _handle_worker_error(self, e):
        """
        Called if a worker throws an exception.
        """
        logger.error("Worker error: %s", e)
        self.pending_tasks -= 1
        self._submit_next_images()

    def _handle_image_result(self, result):
        """
        Callback for each processed image, runs in a separate thread.
        We'll schedule the result processing on the asyncio event loop if we are using one, 
        or just process it synchronously (which is thread-safe for our sqlite/faiss locks).
        """
        try:
            loop = asyncio.get_running_loop()
            loop.call_soon_threadsafe(self._process_result, result)
        except RuntimeError:
            # If no running loop, just run it directly
            self._process_result(result)

    def _process_result(self, result):
        """
        Callback for each processed image. 'result' is a dict:
          { "image": <path>, "embeddings": [ (embedding_vector, (x1,y1,x2,y2)), ... ] }
        """
        self.pending_tasks -= 1
        self.processed_images += 1
        
        if self.processed_images >= self.total_images and self.pending_tasks == 0:
            self.is_scanning = False
        img_path = result["image"]

        # 1. ALWAYS insert the image first to ensure we have an img_id for CLIP!
        img_id = self.db.insert_image(img_path)
        
        embs_and_boxes = result.get("embeddings", [])
        face_ids = []

        items = []
        for emb, box in embs_and_boxes:
            fid = self.idx.find_or_add(emb)
            face_ids.append(fid)
            items.append((img_path, fid, box))
            
        if items:
            self.db.insert_occurrences_batch(items)

        self.image_to_faces[img_path] = face_ids
        logger.debug("Indexed %s: faces=%s", img_path, face_ids)

        # Store CLIP embedding keyed by DB image_id
        clip_emb = result.get("clip_emb")
        if clip_emb is not None:
            self.clip_index.add(img_id, clip_emb)
            self.db.mark_clip_indexed(img_id)

        self._save_counter += 1
        if self._save_counter % 50 == 0:
            try:
                self.idx.save()
                self.clip_index.save()
            except Exception as e:
                logger.error("Error saving indexes: %s", e)

        # Schedule next chunk of images (if any)
        self._submit_next_images()

    def get_faces_in_image(self, image_path):
        """
        Queries DB for all face IDs in that image.
        """
        return self.db.get_faces_in_image(image_path)

    def get_images_for_face(self, face_id):
        """
        Queries DB for all images containing that face.
        """
        return self.db.get_images_with_face(face_id)

    def get_images_with_all_faces(self, image_path):
        """
        Find all face IDs in that image, then query for images that contain all of those face IDs.
        """
        face_ids = self.db.get_faces_in_image(image_path)
        if not face_ids:
            return []

        return self.db.get_images_with_faces(face_ids)

    def merge_face_ids(self, primary_id, other_ids):
        """
        Merge every ID in other_ids into primary_id. All SQL logic is in db.merge_faces.
        """
        if not other_ids:
            return
        self.db.merge_faces(primary_id, other_ids)
        logger.info("Controller: Requested merge of %s → %d", other_ids, primary_id)

    def rename_face(self, face_id: int, name: str):
        """Assign a human-readable name to a face cluster."""
        cleaned = name.strip()
        self.db.set_face_name(face_id, cleaned or None)
        logger.info("Renamed face %d → %r", face_id, cleaned or None)

    def search(self, query: str):
        """
        Run semantic search + face-name reranking.
        """
        if not query.strip():
            return []
        return self.search_engine.search(query, top_k=20)
