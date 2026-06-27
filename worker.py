import logging
from face_processing import init_face_model, detect_and_embed
from PIL import Image, ImageOps
import numpy as np

logger = logging.getLogger(__name__)


def _worker_init():
    """Called once per worker process at pool creation — loads YuNet + SFace."""
    init_face_model()


def process_image(path):
    """
    Worker function: open image, detect faces, compute embeddings.
    Returns:
      {
        "image": path,
        "embeddings": [(emb_128d, (x1,y1,x2,y2)), ...],
      }
    CLIP embedding is added in Commit 2.
    """
    try:
        img = Image.open(path).convert("RGB")
        img = ImageOps.exif_transpose(img)  # correct EXIF orientation

        # Downscale for face detection — HOG/YuNet doesn't need >1080p
        MAX_DIM = 1920
        if max(img.size) > MAX_DIM:
            scale = MAX_DIM / max(img.size)
            det_img = img.resize(
                (int(img.width * scale), int(img.height * scale)),
                Image.LANCZOS,
            )
        else:
            det_img = img
            scale = 1.0

        arr = np.array(det_img)
        raw_results = detect_and_embed(arr)  # [(emb, (x1,y1,x2,y2)) in downscaled coords]

        # Scale bounding boxes back to original image coordinates
        embs_and_boxes = []
        for emb, (x1, y1, x2, y2) in raw_results:
            orig_box = (
                int(x1 / scale), int(y1 / scale),
                int(x2 / scale), int(y2 / scale),
            )
            embs_and_boxes.append((emb, orig_box))

        return {"image": path, "embeddings": embs_and_boxes}

    except Exception as e:
        logger.error("Error processing %s: %s", path, e)
        return {"image": path, "embeddings": []}
