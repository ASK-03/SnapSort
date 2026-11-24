import asyncio
import logging
import os
import threading
import time
import uuid
from collections import deque
from multiprocessing import Pool

import db
import indexer
import worker
from clip_index import CLIPIndex
from clip_processor import CLIPProcessor
from mcp_runtime import is_path_within_approved_roots
from search_engine import SearchEngine

logger = logging.getLogger(__name__)


class Controller:
    # Formats Pillow (+ pillow-heif) can decode via Image.open
    SUPPORTED_EXTENSIONS = (
        ".jpg", ".jpeg", ".png", ".webp", ".bmp",
        ".tif", ".tiff", ".gif", ".heic", ".heif",
    )

    def __init__(
        self,
        num_workers: int | None = None,
        data_dir: str = "data",
        headless: bool = False,
        pool_idle_timeout: float = 60.0,
    ):
        self.headless = headless
        if num_workers is None:
            cpu_cnt = os.cpu_count() or 2
            self.num_workers = max(1, min(2, cpu_cnt // 2)) if headless else 4
        else:
            self.num_workers = max(1, int(num_workers))

        self.data_dir = os.path.abspath(data_dir)
        self.pool_idle_timeout = pool_idle_timeout
        os.makedirs(self.data_dir, exist_ok=True)
        logger.info(
            "Initializing Controller (workers=%d, headless=%s, data_dir=%s)",
            self.num_workers,
            self.headless,
            self.data_dir,
        )

        # Progress & job queue tracking
        self.scan_lock = threading.RLock()
        self.total_images = 0
        self.processed_images = 0
        self.is_scanning = False
        self.pending_tasks = 0
        self.max_pending = self.num_workers
        self.image_queue: deque[str] = deque()
        self._save_counter = 0

        self.jobs: dict[str, dict] = {}
        self.job_queue: deque[str] = deque()
        self.active_job_id: str | None = None
        self._job_events: dict[str, threading.Event] = {}
        self._job_items: dict[str, list[str]] = {}
        self._modified_paths: set[str] = set()

        # Database & FAISS indexes
        self.db = db.Database(os.path.join(self.data_dir, "faces.db"))
        self.idx = indexer.FaissIndex(os.path.join(self.data_dir, "faces.index"))
        self.clip_index = CLIPIndex(os.path.join(self.data_dir, "clip.index"))
        self.db.reconcile_clip_status(self.clip_index.get_all_ids())

        # Lazy worker pool and lazy main-process CLIP processor
        self.pool: Pool | None = None
        self._pool_lock = threading.Lock()
        self._last_pool_used = 0.0

        self._clip_proc: CLIPProcessor | None = None
        self._clip_lock = threading.Lock()
        self.search_engine = SearchEngine(self.db, self.clip_index, self.get_clip_processor)

    def get_clip_processor(self) -> CLIPProcessor:
        """Lazily create the main-process CLIPProcessor on first semantic search."""
        with self._clip_lock:
            if self._clip_proc is None:
                self._clip_proc = CLIPProcessor()
            return self._clip_proc

    def _ensure_pool(self) -> Pool:
        """Lazily spawn the worker Pool on the first active scan."""
        with self._pool_lock:
            if self.pool is None:
                logger.info("Spawning worker pool (%d workers, low_priority=%s)", self.num_workers, self.headless)
                self.pool = Pool(
                    processes=self.num_workers,
                    initializer=worker._worker_init,
                    initargs=(self.headless,),
                )
            self._last_pool_used = time.monotonic()
            return self.pool

    def shutdown_idle_pool(self) -> bool:
        """Tear down the worker Pool if idle past pool_idle_timeout and no scan is active."""
        with self.scan_lock:
            if self.is_scanning or self.pending_tasks > 0 or self.job_queue:
                return False
        with self._pool_lock:
            if self.pool is None:
                return False
            if (time.monotonic() - self._last_pool_used) < self.pool_idle_timeout:
                return False
            pool = self.pool
            self.pool = None
        try:
            pool.close()
            pool.join()
            logger.info("Shut down idle worker pool")
            return True
        except Exception as exc:
            logger.warning("Error closing idle pool: %s", exc)
            return False

    def save_indexes(self) -> None:
        """Atomically save both FAISS indexes."""
        try:
            self.idx.save()
            self.clip_index.save()
        except Exception as exc:
            logger.error("Error saving indexes: %s", exc)

    def enqueue_scan(
        self,
        folder_path: str,
        approved_roots: list[str] | None = None,
        max_new_images: int | None = None,
    ) -> dict:
        """
        Walk folder_path, detect new or mtime-modified images, deduplicate against
        queued/active jobs, and enqueue a serialized scan job.
        """
        canonical_folder = os.path.realpath(folder_path)
        if not os.path.exists(canonical_folder) or not os.path.isdir(canonical_folder):
            return {"error": "Invalid folder path"}

        scan_id = str(uuid.uuid4())
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Deduplicate and reserve a "walking" slot atomically under scan_lock
        with self.scan_lock:
            for job in self.jobs.values():
                if job["folder"] == canonical_folder and job["status"] in ("queued", "walking", "indexing"):
                    return dict(job)
            walking_job = {
                "scan_id": scan_id,
                "folder": canonical_folder,
                "status": "walking",
                "total_images": 0,
                "new_images": 0,
                "processed_images": 0,
                "failed_images": 0,
                "error": None,
                "started_at": now_iso,
                "completed_at": None,
            }
            self.jobs[scan_id] = walking_job
            self._job_events[scan_id] = threading.Event()

        try:
            all_image_paths: list[str] = []
            for root, _, files in os.walk(canonical_folder):
                for fn in files:
                    if not fn.lower().endswith(self.SUPPORTED_EXTENSIONS):
                        continue
                    full_path = os.path.join(root, fn)
                    if approved_roots is not None and not is_path_within_approved_roots(full_path, approved_roots):
                        logger.warning("Skipping symlink outside approved roots: %s", full_path)
                        continue
                    all_image_paths.append(full_path)

            processed_meta = self.db.get_processed_images_meta()
            clip_indexed_ids = self.db.get_clip_indexed_image_ids()
            to_process: list[str] = []
            modified_paths: set[str] = set()
            for path in all_image_paths:
                if path not in processed_meta:
                    to_process.append(path)
                else:
                    img_id, old_mtime = processed_meta[path]
                    try:
                        cur_mtime = os.path.getmtime(path)
                    except OSError:
                        continue
                    if abs(cur_mtime - old_mtime) > 1e-6:
                        to_process.append(path)
                        modified_paths.add(path)
                    elif img_id not in clip_indexed_ids:
                        # Backfill missing CLIP embeddings without clearing existing face tags
                        to_process.append(path)
        except Exception as exc:
            with self.scan_lock:
                job = self.jobs[scan_id]
                job["status"] = "failed"
                job["error"] = str(exc)
                job["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                self._job_events[scan_id].set()
                return dict(job)

        if max_new_images is not None and len(to_process) > max_new_images:
            with self.scan_lock:
                job = self.jobs[scan_id]
                job.update(
                    {
                        "status": "failed",
                        "total_images": len(all_image_paths),
                        "new_images": len(to_process),
                        "error": (
                            f"Folder contains {len(to_process)} images to index, exceeding the "
                            f"headless limit of {max_new_images}."
                        ),
                        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                )
                self._job_events[scan_id].set()
                return dict(job)

        if len(to_process) == 0:
            with self.scan_lock:
                job = self.jobs[scan_id]
                job.update(
                    {
                        "status": "completed",
                        "total_images": len(all_image_paths),
                        "new_images": 0,
                        "error": None,
                        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                )
                self._job_events[scan_id].set()
                if not self.active_job_id and not self.job_queue and self.pending_tasks == 0:
                    self.is_scanning = False
                return dict(job)

        with self.scan_lock:
            job = self.jobs[scan_id]
            job.update(
                {
                    "status": "queued",
                    "total_images": len(all_image_paths),
                    "new_images": len(to_process),
                }
            )
            self._job_items[scan_id] = to_process
            self._modified_paths.update(modified_paths)
            self.job_queue.append(scan_id)
            if self.active_job_id is None:
                self._start_next_job_locked()
            return dict(self.jobs[scan_id])

    def scan_folder(self, folder_path: str) -> dict:
        """Backward-compatible wrapper used by /api/scan."""
        return self.enqueue_scan(folder_path)

    def _start_next_job_locked(self) -> None:
        while self.job_queue:
            next_id = self.job_queue.popleft()
            job = self.jobs.get(next_id)
            items = self._job_items.pop(next_id, [])
            if not job or not items:
                if job:
                    job["status"] = "completed"
                    job["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    ev = self._job_events.get(next_id)
                    if ev:
                        ev.set()
                continue

            self.active_job_id = next_id
            job["status"] = "indexing"
            self.is_scanning = True
            self.total_images = len(items)
            self.processed_images = 0
            self.image_queue = deque(items)
            self._submit_next_images()
            return

        self.active_job_id = None
        self.is_scanning = False
        self._last_pool_used = time.monotonic()

    def _submit_next_images(self) -> None:
        """Dispatch queued images up to max_pending."""
        while True:
            with self.scan_lock:
                if not self.image_queue or self.pending_tasks >= self.max_pending:
                    return
                path = self.image_queue.popleft()
                self.pending_tasks += 1

            pool = self._ensure_pool()
            pool.apply_async(
                worker.process_image,
                args=(path,),
                callback=self._handle_image_result,
                error_callback=self._handle_worker_error,
            )

    def _handle_worker_error(self, e) -> None:
        logger.error("Worker error: %s", e)
        with self.scan_lock:
            self.pending_tasks = max(0, self.pending_tasks - 1)
            self.processed_images += 1
            if self.active_job_id and self.active_job_id in self.jobs:
                job = self.jobs[self.active_job_id]
                job["processed_images"] += 1
                job["failed_images"] += 1
        self._finalize_or_continue()

    def _handle_image_result(self, result) -> None:
        """Schedule result handling on the event loop when available, else run directly."""
        try:
            loop = asyncio.get_running_loop()
            loop.call_soon_threadsafe(self._process_result, result)
        except RuntimeError:
            self._process_result(result)

    def _process_result(self, result) -> None:
        img_path = result["image"]
        had_error = bool(result.get("error"))

        if not had_error or os.path.exists(img_path):
            img_id = self.db.insert_image(img_path)
            if img_path in self._modified_paths:
                self._modified_paths.discard(img_path)
                try:
                    self.db.update_image_mtime(img_id, os.path.getmtime(img_path))
                except OSError:
                    pass
                self.db.clear_occurrences_for_image(img_id)

            embs_and_boxes = result.get("embeddings", [])
            items = []
            for emb, box in embs_and_boxes:
                raw_fid = self.idx.find_or_add(emb)
                fid, _ = self.db.resolve_face_id(raw_fid)
                items.append((img_path, fid, box))

            if items:
                self.db.insert_occurrences_batch(items)

            clip_emb = result.get("clip_emb")
            if clip_emb is not None:
                self.clip_index.add(img_id, clip_emb)
                self.db.mark_clip_indexed(img_id)

        with self.scan_lock:
            self.pending_tasks = max(0, self.pending_tasks - 1)
            self.processed_images += 1
            self._save_counter += 1
            periodic_save = (self._save_counter % 50 == 0)

            if self.active_job_id and self.active_job_id in self.jobs:
                job = self.jobs[self.active_job_id]
                job["processed_images"] += 1
                if had_error:
                    job["failed_images"] += 1

        if periodic_save:
            self.save_indexes()

        self._finalize_or_continue()

    def _finalize_or_continue(self) -> None:
        finished_job = False
        with self.scan_lock:
            if not self.image_queue and self.pending_tasks == 0 and self.active_job_id:
                finished_job = True
                job = self.jobs.get(self.active_job_id)
                if job:
                    job["status"] = "completed"
                    job["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                ev = self._job_events.get(self.active_job_id)
                if ev:
                    ev.set()

        if finished_job:
            self.save_indexes()
            with self.scan_lock:
                self.active_job_id = None
                self._start_next_job_locked()
        else:
            self._submit_next_images()

    def wait_for_job(self, scan_id: str, wait_seconds: float) -> dict | None:
        clamped = max(0.0, min(30.0, float(wait_seconds)))
        with self.scan_lock:
            ev = self._job_events.get(scan_id)
        if ev is not None and clamped > 0:
            ev.wait(timeout=clamped)
        return self.get_job_status(scan_id)

    def get_job_status(self, scan_id: str | None = None) -> dict:
        with self.scan_lock:
            if scan_id:
                job = self.jobs.get(scan_id)
                return dict(job) if job else {"error": f"Unknown scan_id: {scan_id}"}
            if self.active_job_id and self.active_job_id in self.jobs:
                return dict(self.jobs[self.active_job_id])
            if self.jobs:
                last_id = list(self.jobs.keys())[-1]
                return dict(self.jobs[last_id])
            return {
                "scan_id": None,
                "folder": None,
                "status": "idle",
                "total_images": self.total_images,
                "new_images": self.total_images,
                "processed_images": self.processed_images,
                "failed_images": 0,
                "error": None,
            }

    def get_faces_in_image(self, image_path: str):
        return self.db.get_faces_in_image(image_path)

    def get_images_for_face(
        self,
        face_id: int,
        folder: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ):
        return self.db.get_images_with_face(face_id, folder=folder, limit=limit, offset=offset)

    def merge_face_ids(self, primary_id: int, other_ids: list[int]):
        if not other_ids:
            return
        self.db.merge_faces(primary_id, other_ids)
        logger.info("Controller: Requested merge of %s -> %d", other_ids, primary_id)

    def rename_face(self, face_id: int, name: str):
        cleaned = name.strip()
        self.db.set_face_name(face_id, cleaned or None)
        logger.info("Renamed face %d -> %r", face_id, cleaned or None)

    def search_with_diagnostics(
        self,
        query: str,
        top_k: int = 20,
        person_id: int | None = None,
        folder: str | None = None,
        min_score: float | None = None,
    ) -> tuple[list[tuple[str, float]], float | None]:
        if not query or not query.strip():
            return [], None
        effective_min = 0.25 if min_score is None else float(min_score)
        return self.search_engine.search_with_diagnostics(
            query,
            top_k=top_k,
            min_score=effective_min,
            person_id=person_id,
            folder=folder,
        )

    def search(
        self,
        query: str,
        top_k: int = 20,
        person_id: int | None = None,
        folder: str | None = None,
        min_score: float | None = None,
    ):
        results, _ = self.search_with_diagnostics(
            query,
            top_k=top_k,
            person_id=person_id,
            folder=folder,
            min_score=min_score,
        )
        return results

    def shutdown(self) -> None:
        """Persist FAISS indexes, close worker pool, and close DB."""
        logger.info("Shutting down Controller...")
        self.save_indexes()
        with self._pool_lock:
            pool = self.pool
            self.pool = None
        if pool is not None:
            try:
                pool.terminate()
                pool.join()
            except Exception as exc:
                logger.warning("Error terminating worker pool: %s", exc)
        self.db.close()
