"""
FAISS index for face identity clustering using cosine similarity (IndexFlatIP).

Embeddings must be L2-normalised before calling find_or_add / search;
face_processing.detect_and_embed() already normalises SFace output.

Clustering threshold:  COSINE_THRESHOLD = 0.38
  - same-person score typically ≥ 0.45  (SFace paper: 0.363 @ EER)
  - 0.38 gives moderate clustering: fewer false merges than 0.30,
    fewer splits than 0.50.
"""
import os
import faiss
import numpy as np
import logging

logger = logging.getLogger(__name__)

EMBEDDING_DIM    = 128   # SFace output dimension
COSINE_THRESHOLD = 0.38  # cosine similarity (inner-product on L2-normed vecs)


class FaissIndex:
    def __init__(self, path: str):
        self.path = path
        if os.path.exists(path):
            self.index = faiss.read_index(path)
            # Validate stored dimension matches expected
            if self.index.d != EMBEDDING_DIM:
                logger.warning(
                    "Stale index (dim=%d, expected %d) — resetting.",
                    self.index.d, EMBEDDING_DIM,
                )
                self.index = faiss.IndexFlatIP(EMBEDDING_DIM)
            else:
                logger.info("Loaded Faiss index from %s (%d vectors)", path, self.index.ntotal)
        else:
            self.index = faiss.IndexFlatIP(EMBEDDING_DIM)
            logger.info("Created new Faiss index (dim=%d, cosine)", EMBEDDING_DIM)

    def find_or_add(self, emb: np.ndarray) -> int:
        """
        Search for the nearest neighbour.  If cosine similarity ≥ COSINE_THRESHOLD,
        return its integer ID.  Otherwise add emb as a new vector and return its ID.
        IDs are consecutive integers (0, 1, 2, …) matching the DB faces.id column.
        """
        vec = np.array(emb, dtype="float32").reshape(1, -1)
        # Ensure L2-normalised (idempotent if already normalised)
        n = np.linalg.norm(vec)
        if n > 0:
            vec /= n

        if self.index.ntotal > 0:
            D, I = self.index.search(vec, 1)
            score = float(D[0][0])
            if score >= COSINE_THRESHOLD:
                logger.debug("Matched existing face %d (cosine=%.4f)", I[0][0], score)
                return int(I[0][0])

        new_id = self.index.ntotal
        self.index.add(vec)
        logger.debug("New face ID=%d added (total=%d)", new_id, self.index.ntotal)
        return new_id

    def save(self):
        faiss.write_index(self.index, self.path)
        logger.info("Saved Faiss index to %s", self.path)
