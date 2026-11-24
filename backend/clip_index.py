"""
FAISS index for CLIP image embeddings (semantic search).

  Dimension : 512 (CLIP ViT-B/32)
  Metric    : Inner-product (= cosine for L2-normalised vecs)
  IDs       : SQLite images.id (mapped via IndexIDMap2)
"""
import logging
import os
import threading
import faiss
import numpy as np

logger = logging.getLogger(__name__)

CLIP_DIM = 512


class CLIPIndex:
    def __init__(self, path: str):
        self.path = os.path.abspath(path)
        self.lock = threading.RLock()
        if os.path.exists(self.path):
            self.index = faiss.read_index(self.path)
            if self.index.d != CLIP_DIM:
                logger.warning("Stale CLIP index (dim=%d) — resetting.", self.index.d)
                self._reset()
            else:
                logger.info("Loaded CLIP index from %s (%d vectors)", self.path, self.index.ntotal)
        else:
            self._reset()
            logger.info("Created new CLIP index (dim=%d)", CLIP_DIM)

    def _reset(self):
        flat = faiss.IndexFlatIP(CLIP_DIM)
        self.index = faiss.IndexIDMap2(flat)

    @property
    def ntotal(self) -> int:
        with self.lock:
            return int(self.index.ntotal)

    def get_all_ids(self) -> set[int]:
        """Return all SQLite image IDs currently stored in the CLIP index."""
        with self.lock:
            if self.index.ntotal == 0:
                return set()
            arr = faiss.vector_to_array(self.index.id_map)
            return {int(x) for x in arr}

    def add(self, image_id: int, emb: np.ndarray):
        """Add or overwrite embedding for image_id."""
        vec = np.array(emb, dtype="float32").reshape(1, -1)
        n = np.linalg.norm(vec)
        if n > 0:
            vec /= n
        ids = np.array([int(image_id)], dtype=np.int64)
        with self.lock:
            if self.index.ntotal > 0:
                try:
                    self.index.remove_ids(ids)
                except Exception:
                    pass
            self.index.add_with_ids(vec, ids)

    def search(self, query_emb: np.ndarray, k: int = 60) -> list[tuple[int, float]]:
        """Return [(image_id, cosine_score), ...] sorted descending."""
        vec = np.array(query_emb, dtype="float32").reshape(1, -1)
        with self.lock:
            k_eff = min(max(0, int(k)), int(self.index.ntotal))
            if k_eff == 0:
                return []
            D, I = self.index.search(vec, k_eff)
            return [(int(I[0][i]), float(D[0][i])) for i in range(k_eff) if I[0][i] >= 0]

    def search_subset(
        self,
        query_emb: np.ndarray,
        allowed_ids: set[int] | list[int],
        k: int = 60,
    ) -> list[tuple[int, float]]:
        """Pre-filter candidates to allowed_ids before scoring/ranking."""
        if not allowed_ids or k <= 0:
            return []
        vec = np.array(query_emb, dtype="float32").reshape(1, -1)
        n = np.linalg.norm(vec)
        if n > 0:
            vec /= n

        with self.lock:
            if self.index.ntotal == 0:
                return []
            target_ids = sorted({int(i) for i in allowed_ids} & self.get_all_ids())
            if not target_ids:
                return []
            k_eff = min(int(k), len(target_ids))

            try:
                sel = faiss.IDSelectorBatch(np.array(target_ids, dtype=np.int64))
                params = faiss.SearchParameters(sel=sel)
                D, I = self.index.search(vec, k_eff, params=params)
                return [
                    (int(I[0][i]), float(D[0][i]))
                    for i in range(k_eff)
                    if I[0][i] >= 0
                ]
            except (TypeError, AttributeError, RuntimeError):
                # Fallback for FAISS builds without SearchParameters(sel=...) on IndexIDMap2
                vecs = np.vstack([self.index.reconstruct(img_id) for img_id in target_ids])
                scores = vecs @ vec.ravel()
                order = np.argsort(-scores)[:k_eff]
                return [(int(target_ids[idx]), float(scores[idx])) for idx in order]

    def save(self):
        """Atomically persist the CLIP index using a temporary file and os.replace()."""
        with self.lock:
            parent = os.path.dirname(self.path)
            os.makedirs(parent, exist_ok=True)
            tmp_path = f"{self.path}.tmp.{os.getpid()}.{threading.get_ident()}"
            try:
                faiss.write_index(self.index, tmp_path)
                with open(tmp_path, "rb") as fh:
                    os.fsync(fh.fileno())
                os.replace(tmp_path, self.path)
                logger.info("Saved CLIP index to %s (%d vectors)", self.path, self.index.ntotal)
            except Exception:
                try:
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                except OSError:
                    pass
                raise
