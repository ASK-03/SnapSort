import logging
from face_processing import detect_faces, compute_embedding
from PIL import Image, ImageOps
import numpy as np

logger = logging.getLogger(__name__)


def process_image(path):
    """
    Worker function to open 'path', detect faces, compute embeddings, and return:
      { "image": path, "embeddings": [ (vector, (x1,y1,x2,y2)), ... ] }
    """
    try:
        img = Image.open(path).convert("RGB")
        img = ImageOps.exif_transpose(img)  # Correct orientation (EXIF)
        arr = np.array(img)

        boxes = detect_faces(arr)  # list of (x1, y1, x2, y2)
        embs_and_boxes = []
        for box in boxes:
            x1, y1, x2, y2 = box
            crop = img.crop((x1, y1, x2, y2))
            emb = compute_embedding(np.array(crop))
            embs_and_boxes.append((emb, box))

        return {"image": path, "embeddings": embs_and_boxes}
    except Exception as e:
        logger.error("Error processing %s: %s", path, e)
        return {"image": path, "embeddings": []}
