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


def compute_embedding(full_image, face_location):
    """Pass known location to skip redundant face detection."""
    # Our face_location is (x1, y1, x2, y2)
    # face_recognition expects (top, right, bottom, left)
    x1, y1, x2, y2 = face_location
    top, right, bottom, left = y1, x2, y2, x1

    encs = face_recognition.face_encodings(
        full_image, 
        known_face_locations=[(top, right, bottom, left)]
    )
    if encs:
        return encs[0].astype("float32")
    logger.warning("No embedding computed; returning zero vector")
    return np.zeros((128,), dtype="float32")
