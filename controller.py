import os
import logging
from PyQt5.QtCore import QObject, pyqtSignal
from multiprocessing import Pool, Manager
import db, indexer, worker

logger = logging.getLogger(__name__)

class Controller(QObject):
    folder_scanned = pyqtSignal(list)
    faces_ready = pyqtSignal(dict)
    face_images_ready = pyqtSignal(int, list)
    images_with_all_faces_ready = pyqtSignal(list)

    def __init__(self, num_workers=4):
        super().__init__()
        self.num_workers = num_workers
        logger.info('Initializing Controller with %d workers', self.num_workers)

        self.db = db.Database('faces.db')
        self.idx = indexer.FaissIndex('faces.index')
        self.pool = Pool(processes=self.num_workers)
        self.manager = Manager()
        self.image_to_faces = self.manager.dict()

        # Throttle task submissions
        self.pending_tasks = 0
        self.max_pending = self.num_workers
        self.image_queue = []

    def scan_folder(self, folder_path):
        logger.info('Scanning folder: %s', folder_path)
        all_image_paths = []
        for root, _, files in os.walk(folder_path):
            for fn in files:
                if fn.lower().endswith(('.jpg', '.png', '.jpeg')):
                    all_image_paths.append(os.path.join(root, fn))

        # Filter out already processed images efficiently
        processed = self.db.get_processed_images()
        new_images = [p for p in all_image_paths if p not in processed]

        logger.info('Found %d total images, %d new to index',
                    len(all_image_paths), len(new_images))
        
        self.folder_scanned.emit(all_image_paths)
        self.image_queue = new_images
        self._submit_next_images()

    def _submit_next_images(self):
        while self.image_queue and self.pending_tasks <= self.max_pending:
            path = self.image_queue.pop(0)
            self.pending_tasks += 1
            self.pool.apply_async(
                worker.process_image,
                args=(path,),
                callback=self._handle_image_result,
                error_callback=self._handle_worker_error
            )

    def _handle_worker_error(self, e):
        logger.error('Worker error: %s', e)
        self.pending_tasks -= 1
        self._submit_next_images()

    def _handle_image_result(self, result):
        self.pending_tasks -= 1
        img_path = result['image']
        embs_and_boxes = result.get('embeddings', [])
        face_ids = []
        # TODO: what if no embeddings?
        for emb, box in embs_and_boxes:
            fid = self.idx.find_or_add(emb)
            face_ids.append(fid)
            self.db.insert_occurrence(img_path, fid, box)
        self.image_to_faces[img_path] = face_ids
        logger.debug('Indexed %s: %s', img_path, face_ids)

        try:
            self.idx.save()
        except Exception as e:
            logger.error('Error saving Faiss index: %s', e)

        self._submit_next_images()  # Schedule next task

    def request_faces_in_image(self, image_path):
        fids = self.db.get_faces_in_image(image_path)
        self.faces_ready.emit({image_path: fids})

    def request_images_for_face(self, face_id):
        paths = self.db.get_images_with_face(face_id)
        self.face_images_ready.emit(face_id, paths)

    def request_images_with_all_faces(self, image_path):
        face_ids = self.db.get_faces_in_image(image_path)
        if not face_ids:
            self.images_with_all_faces_ready.emit([])
            return
        paths = self.db.get_images_with_faces(face_ids)
        self.images_with_all_faces_ready.emit(paths)
