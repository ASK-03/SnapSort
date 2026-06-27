import logging
from face_processing import detect_faces, compute_embedding
from PIL import Image, ImageOps
import numpy as np

logger = logging.getLogger(__name__)


def _worker_init():
    """Called once per worker process at pool creation."""
    import face_recognition  # loads dlib model once


def process_image(path):
    """
    Worker function to open 'path', detect faces, compute embeddings, and return:
      { "image": path, "embeddings": [ (vector, (x1,y1,x2,y2)), ... ] }
    """
    try:
        img = Image.open(path).convert("RGB")
        img = ImageOps.exif_transpose(img)  # Correct orientation (EXIF)

        # Downscale for face detection (HOG doesn't need >1080p)
        MAX_DIM = 1920
        if max(img.size) > MAX_DIM:
            scale = MAX_DIM / max(img.size)
            det_img = img.resize((int(img.width * scale), int(img.height * scale)))
        else:
            det_img = img
            scale = 1.0
        
        arr = np.array(det_img)
        full_arr = np.array(img)  # Need full image for embedding

        boxes = detect_faces(arr)  # list of (x1, y1, x2, y2) on downscaled image
        
        # Scale boxes back to original coordinates
        orig_boxes = [(int(x1/scale), int(y1/scale), int(x2/scale), int(y2/scale)) 
                      for x1, y1, x2, y2 in boxes]

        embs_and_boxes = []
        for box in orig_boxes:
            emb = compute_embedding(full_arr, box)
            embs_and_boxes.append((emb, box))

        return {"image": path, "embeddings": embs_and_boxes}
    except Exception as e:
        logger.error("Error processing %s: %s", path, e)
        return {"image": path, "embeddings": []}
