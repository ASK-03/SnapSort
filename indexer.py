import faiss
import numpy as np
import logging

logger = logging.getLogger(__name__)


class FaissIndex:
    def __init__(self, path, dim=128):
        """
        path: filesystem path to store a flat‐L2 index.
        dim: embedding dimension (128 for face_recognition).
        """
        self.path = path
        self.dim = dim
        try:
            self.index = faiss.read_index(path)
            logger.info("Loaded Faiss index from %s", path)
        except:
            self.index = faiss.IndexFlatL2(dim)
            logger.info("Created new Faiss index")

    def find_or_add(self, emb, threshold=0.24):
        """
        Search for the nearest neighbor to 'emb'. If distance < threshold,
        return its ID. Otherwise, add 'emb' as a new vector.
        The returned ID is the row‐number in the index.
        """
        vec = emb.reshape(1, -1).astype("float32")
        if self.index.ntotal > 0:
            D, I = self.index.search(vec, 1)
            if D[0][0] < threshold:
                logger.debug("Found existing ID %d (dist=%.4f)", I[0][0], D[0][0])
                return int(I[0][0])

        new_id = self.index.ntotal
        self.index.add(vec)
        logger.debug("Added new embedding as ID %d", new_id)
        return new_id

    def save(self):
        """Write the index to disk at self.path."""
        faiss.write_index(self.index, self.path)
        logger.info("Saved Faiss index to %s", self.path)
