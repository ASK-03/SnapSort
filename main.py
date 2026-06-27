import sys
import os
import logging
from PyQt5.QtWidgets import QApplication, QMessageBox
from controller import Controller
from gui.main_window import MainWindow

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

_STALE_FILES = ["faces.index", "faces.db"]  # must be reset on model migration
_MODELS_DIR  = os.path.join(os.path.dirname(__file__), "models")
_REQUIRED_MODELS = [
    "face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx",
]


def _check_models(app):
    missing = [m for m in _REQUIRED_MODELS
               if not os.path.exists(os.path.join(_MODELS_DIR, m))]
    if missing:
        msg = (
            "Required face models not found:\n"
            + "\n".join(f"  • {m}" for m in missing)
            + "\n\nRun:  python3 scripts/download_models.py"
        )
        QMessageBox.critical(None, "SnapSort — Missing Models", msg)
        return False
    return True


def _migrate_stale_artefacts():
    """Delete index/db files built with old dlib embeddings (128-d L2)."""
    for fname in _STALE_FILES:
        path = os.path.join(os.path.dirname(__file__), fname)
        if os.path.exists(path):
            os.remove(path)
            logger.info("Removed stale artefact: %s", fname)


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()

    logger.info("Starting SnapSort")
    app = QApplication(sys.argv)

    if not _check_models(app):
        sys.exit(1)

    # Delete artefacts only when the FAISS index exists but has wrong dimension.
    # The FaissIndex constructor already handles this; we call _migrate here as
    # a belt-and-braces cleanup so the DB doesn't contain orphaned dlib IDs.
    index_path = os.path.join(os.path.dirname(__file__), "faces.index")
    if os.path.exists(index_path):
        import faiss
        try:
            idx = faiss.read_index(index_path)
            if idx.d != 128 or hasattr(idx, '_is_dlib'):
                _migrate_stale_artefacts()
        except Exception:
            _migrate_stale_artefacts()

    controller = Controller(num_workers=4)
    window = MainWindow(controller)
    window.show()
    exit_code = app.exec_()
    logger.info("Exiting with code %s", exit_code)
    sys.exit(exit_code)
