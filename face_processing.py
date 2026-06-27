"""
Face detection (YuNet) and embedding (SFace) via OpenCV DNN.
Both models are from the OpenCV Zoo — lightweight, CPU-optimised, packagable.

  YuNet  : ~375 KB   — face detector, returns bboxes + 5 keypoints
  SFace  : ~37  MB   — ArcFace-based recogniser, outputs 128-d L2-normalised embeddings

Cosine similarity is used for clustering (inner-product on L2-normalised vecs).
"""
import os
import logging
import numpy as np
import cv2

logger = logging.getLogger(__name__)

_detector   = None   # cv2.FaceDetectorYN
_recognizer = None   # cv2.FaceRecognizerSF

# Resolve models dir relative to this file so it works both in-place and packaged
_MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


def _model_path(filename):
    return os.path.join(_MODELS_DIR, filename)


def init_face_model():
    """
    Load YuNet + SFace once per process.
    Called by worker._worker_init() so each pool worker loads models exactly once.
    """
    global _detector, _recognizer

    det_path = _model_path("face_detection_yunet_2023mar.onnx")
    rec_path = _model_path("face_recognition_sface_2021dec.onnx")

    for p in (det_path, rec_path):
        if not os.path.exists(p):
            raise FileNotFoundError(
                f"Model not found: {p}\n"
                "Run:  python3 scripts/download_models.py"
            )

    # score_threshold=0.75: reduces clothing/texture false positives
    _detector   = cv2.FaceDetectorYN.create(det_path, "", (320, 320),
                                             score_threshold=0.75, nms_threshold=0.3)
    _recognizer = cv2.FaceRecognizerSF.create(rec_path, "")
    logger.info("Face models loaded (YuNet + SFace)")


# Filters applied after detection (in detection-image pixel space)
_MIN_FACE_PX  = 50    # discard boxes narrower/shorter than this (e.g. patterns on clothes)
_MAX_ASPECT   = 2.0   # discard very elongated detections (real faces are roughly square)


def detect_and_embed(rgb_array: np.ndarray) -> list[tuple[np.ndarray, tuple]]:
    """
    Detect faces in an RGB numpy array and return 128-d L2-normalised embeddings.

    Returns:
        List of (embedding: float32 ndarray shape (128,), bbox: (x1, y1, x2, y2))
    """
    if _detector is None or _recognizer is None:
        raise RuntimeError("Call init_face_model() before detect_and_embed()")

    h, w = rgb_array.shape[:2]
    bgr = cv2.cvtColor(rgb_array, cv2.COLOR_RGB2BGR)

    _detector.setInputSize((w, h))
    _, faces = _detector.detect(bgr)

    if faces is None:
        return []

    results = []
    for face in faces:
        # YuNet row: [x, y, w, h, kp0x, kp0y, ..., kp4x, kp4y, score]
        x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])

        # --- false-positive filters ---
        # 1. Minimum face size (in detection-image pixels)
        if fw < _MIN_FACE_PX or fh < _MIN_FACE_PX:
            continue
        # 2. Aspect ratio — real faces are roughly square
        longer  = max(fw, fh)
        shorter = min(fw, fh)
        if shorter == 0 or (longer / shorter) > _MAX_ASPECT:
            continue

        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(w, x + fw)
        y2 = min(h, y + fh)

        if x2 <= x1 or y2 <= y1:
            continue

        # alignCrop produces a 112×112 aligned face crop (SFace's expected input)
        aligned = _recognizer.alignCrop(bgr, face)
        raw_emb = _recognizer.feature(aligned)          # shape (1, 128)
        emb = raw_emb.flatten().astype("float32")

        # L2-normalise so dot-product == cosine similarity
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb /= norm

        results.append((emb, (x1, y1, x2, y2)))

    return results
