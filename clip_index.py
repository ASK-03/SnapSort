"""
FAISS index for CLIP image embeddings (semantic search).

  Dimension : 512 (CLIP ViT-B/32)
  Metric    : Inner-product (= cosine for L2-normalised vecs)
  IDs       : SQLite images.id (mapped via IndexIDMap2)
"""
import os
import faiss
import numpy as np
import logging

logger = logging.getLogger(__name__)

CLIP_DIM = 512


class CLIPIndex:
    def __init__(self, path: str):
        self.path = path
        if os.path.exists(path):
            self.index = faiss.read_index(path)
            if self.index.d != CLIP_DIM:
                logger.warning("Stale CLIP index (dim=%d) — resetting.", self.index.d)
                self._reset()
            else:
                logger.info("Loaded CLIP index from %s (%d vectors)", path, self.index.ntotal)
        else:
            self._reset()
            logger.info("Created new CLIP index (dim=%d)", CLIP_DIM)

    def _reset(self):
        flat = faiss.IndexFlatIP(CLIP_DIM)
        self.index = faiss.IndexIDMap2(flat)

    def add(self, image_id: int, emb: np.ndarray):
        """Add or overwrite embedding for image_id."""
        vec = np.array(emb, dtype="float32").reshape(1, -1)
        ids = np.array([image_id], dtype=np.int64)
        self.index.add_with_ids(vec, ids)

    def search(self, query_emb: np.ndarray, k: int = 60) -> list[tuple[int, float]]:
        """Return [(image_id, cosine_score), ...] sorted descending."""
        vec = np.array(query_emb, dtype="float32").reshape(1, -1)
        k   = min(k, self.index.ntotal)
        if k == 0:
            return []
        D, I = self.index.search(vec, k)
        return [(int(I[0][i]), float(D[0][i])) for i in range(k) if I[0][i] >= 0]

    def save(self):
        faiss.write_index(self.index, self.path)
        logger.info("Saved CLIP index to %s (%d vectors)", self.path, self.index.ntotal)
