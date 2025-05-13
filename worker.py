import logging
from face_processing import detect_faces, compute_embedding
from PIL import Image
import numpy as np

logger = logging.getLogger(__name__)

def process_image(path):
    """
    Worker: detect faces and compute embeddings for one image.
    Returns {'image': path, 'embeddings': [(emb, box), ...]}.
    """
    logger.debug('Worker processing: %s', path)
    try:
        img = Image.open(path).convert('RGB')
        arr = np.array(img)
        boxes = detect_faces(arr)
        embs_and_boxes = []
        for box in boxes:
            crop = img.crop((box[0], box[1], box[2], box[3]))
            emb = compute_embedding(np.array(crop))
            embs_and_boxes.append((emb, box))
        return {'image': path, 'embeddings': embs_and_boxes}
    except Exception as e:
        logger.error('Error processing %s: %s', path, e)
        return {'image': path, 'embeddings': []}