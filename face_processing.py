import face_recognition
import numpy as np
import logging

logger = logging.getLogger(__name__)


def detect_faces(image):
    """
    Given a numpy array (H×W×3), return a list of bounding boxes in (x1, y1, x2, y2) format.
    face_recognition.face_locations returns (top, right, bottom, left) → convert accordingly.
    """
    boxes = face_recognition.face_locations(image, model="hog")
    return [(left, top, right, bottom) for top, right, bottom, left in boxes]


def compute_embedding(face_img):
    """
    Given a numpy array of a cropped face, return a 128‐dim embedding.
    If no encodings are found, return a zero vector (and log a warning).
    """
    encs = face_recognition.face_encodings(face_img)
    if encs:
        return encs[0].astype("float32")
    logger.warning("No embedding computed; returning zero vector")
    return np.zeros((128,), dtype="float32")
