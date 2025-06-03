import face_recognition
import numpy as np
import logging

logger = logging.getLogger(__name__)


def detect_faces(image):
    boxes = face_recognition.face_locations(image, model="hog")
    return [(left, top, right, bottom) for top, right, bottom, left in boxes]


def compute_embedding(face_img):
    encs = face_recognition.face_encodings(face_img)
    if encs:
        return encs[0].astype("float32")
    logger.warning("No embedding computed; returning zero vector")
    return np.zeros((128,), dtype="float32")
