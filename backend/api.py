from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import logging
import os
import sys
import uvicorn
import pillow_heif

pillow_heif.register_heif_opener()  # lets Image.open() decode .heic/.heif in the main process

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Resolve runtime directories (passed by Electron or defaulting for dev)
# MUST happen before importing controller — the import chain triggers
# face_processing / clip_processor which read SNAPSORT_MODELS_DIR at
# module-load time.
# ---------------------------------------------------------------------------
def _parse_cli_arg(name: str, default: str) -> str:
    """Read --name VALUE from sys.argv, falling back to *default*."""
    if name in sys.argv:
        idx = sys.argv.index(name)
        if idx + 1 < len(sys.argv):
            return sys.argv[idx + 1]
    return default

# Where the backend stores its database & indexes (must be writable)
DATA_DIR   = _parse_cli_arg("--data-dir",   os.path.join(os.path.dirname(__file__), "..", "data"))
# Where ONNX model files live
MODELS_DIR = _parse_cli_arg("--models-dir", os.path.join(os.path.dirname(__file__), "..", "models"))

os.makedirs(DATA_DIR, exist_ok=True)

# Expose to other modules that read them during import
os.environ["SNAPSORT_DATA_DIR"]   = os.path.abspath(DATA_DIR)
os.environ["SNAPSORT_MODELS_DIR"] = os.path.abspath(MODELS_DIR)

app = FastAPI(title="SnapSort API")

# Allow Electron frontend to access API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Lazy controller initialisation.
#
# On Windows, multiprocessing uses 'spawn': each Pool worker re-imports this
# module from scratch.  If Controller (which creates a Pool) is instantiated
# at module level, every spawned worker would re-create a Pool → infinite
# recursion → UI freeze / crash.
#
# By deferring instantiation to a startup event that only fires in the main
# (uvicorn) process, workers can safely import api.py without side-effects.
# ---------------------------------------------------------------------------
_controller = None   # type: ignore

def _get_controller():
    """Return the singleton Controller, raising if not yet initialised."""
    global _controller
    if _controller is None:
        raise RuntimeError(
            "Controller not initialised — this code path should only "
            "run in the main uvicorn process, not in a Pool worker."
        )
    return _controller

@app.on_event("startup")
def _startup():
    """Create the Controller (and its Pool) exactly once, in the main process."""
    global _controller
    # Import here so the module-level import doesn't trigger Pool creation
    # in spawned workers that re-import this file.
    from controller import Controller
    _controller = Controller(num_workers=4, data_dir=os.path.abspath(DATA_DIR))

# Convenience alias used by every endpoint below
def controller():
    return _get_controller()

class ScanRequest(BaseModel):
    folder_path: str

@app.get("/api/status")
async def get_status():
    """Health check for Electron to verify backend is ready"""
    return {"status": "ok", "initialised": _controller is not None}

@app.post("/api/scan")
async def start_scan(req: ScanRequest):
    """Start scanning a directory"""
    if not os.path.exists(req.folder_path) or not os.path.isdir(req.folder_path):
        raise HTTPException(status_code=400, detail="Invalid folder path")
        
    res = controller().scan_folder(req.folder_path)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res

@app.get("/api/progress")
async def get_progress():
    """Get current scanning progress"""
    ctrl = controller()
    return {
        "is_scanning": ctrl.is_scanning,
        "total_images": ctrl.total_images,
        "processed_images": ctrl.processed_images,
        "pending_tasks": ctrl.pending_tasks
    }

@app.get("/api/stats")
async def get_stats():
    """Get statistics for the sidebar"""
    return controller().db.get_stats()

@app.get("/api/images")
async def get_images(offset: int = 0, limit: int = 50):
    """Fetch paginated list of all images"""
    images = controller().db.get_all_images_paginated(offset, limit)
    return {"images": images}

@app.get("/api/images/faces")
async def get_faces_in_image(image_path: str):
    """Get all face IDs and names found in a specific image"""
    ctrl = controller()
    face_ids = ctrl.get_faces_in_image(image_path)
    result = []
    for fid in face_ids:
        name = ctrl.db.get_face_name(fid)
        result.append({"id": fid, "name": name})
    return {"faces": result}

@app.get("/api/faces")
async def get_faces():
    """Fetch all unique face clusters (for the People view)"""
    faces = controller().db.get_all_faces_with_counts()
    return {"faces": faces}

@app.get("/api/faces/{face_id}/images")
async def get_images_for_face(face_id: int):
    """Fetch all images containing a specific person"""
    images = controller().get_images_for_face(face_id)
    return {"images": images}

class RenameRequest(BaseModel):
    name: str

@app.put("/api/faces/{face_id}")
async def rename_face(face_id: int, req: RenameRequest):
    """Rename a face cluster"""
    controller().rename_face(face_id, req.name)
    return {"status": "ok"}

class MergeRequest(BaseModel):
    primary_id: int
    other_ids: list[int]

@app.post("/api/faces/merge")
async def merge_faces(req: MergeRequest):
    """Merge multiple face clusters together"""
    controller().merge_face_ids(req.primary_id, req.other_ids)
    return {"status": "ok"}

@app.get("/api/search")
async def search_images(q: str):
    """Semantic text and name search"""
    results = controller().search(q)
    return [{"path": path, "score": float(score)} for path, score in results]

def _resolve_indexed_path(path: str) -> str:
    """
    Confirm 'path' is already known to the DB (i.e. it was found during a
    folder scan) before serving it. Without this check, these endpoints would
    let anyone who can reach the local API read arbitrary files on disk by
    passing any path on the query string.

    Paths are stored exactly as os.walk produced them (controller.py), which
    may go through a symlink — so try the raw path first and only fall back
    to a realpath comparison, rather than realpath-ing unconditionally and
    missing every symlinked library.
    """
    db = controller().db
    if db.get_image_id(path) is not None:
        return path
    real_path = os.path.realpath(path)
    if db.get_image_id(real_path) is not None:
        return real_path
    raise HTTPException(status_code=404, detail="Image not found")

# Formats Chromium's <img> can't decode natively — serve a JPEG transcode instead of raw bytes.
_BROWSER_UNSAFE_EXTS = (".heic", ".heif", ".tif", ".tiff")

# Endpoints to serve actual files
@app.get("/media/image")
async def serve_image(path: str):
    real_path = _resolve_indexed_path(path)
    if real_path.lower().endswith(_BROWSER_UNSAFE_EXTS):
        cache_path = await asyncio.to_thread(generate_preview, real_path, 4096)
        return FileResponse(cache_path, media_type="image/jpeg")
    return FileResponse(real_path)

import asyncio
import hashlib
from PIL import Image, ImageOps

_PREVIEW_CACHE_DIR = os.path.join(os.path.abspath(DATA_DIR), "previews")
os.makedirs(_PREVIEW_CACHE_DIR, exist_ok=True)

def generate_preview(path: str, size: int) -> str:
    """Render a downscaled JPEG preview to a cache file and return its path.

    Cache key includes mtime so an edited source image invalidates its cache
    entry automatically. Written via temp file + atomic rename so concurrent
    requests for the same uncached preview never race on a partial file.
    """
    mtime = os.path.getmtime(path)
    key = hashlib.sha1(f"{path}:{mtime}:{size}".encode()).hexdigest()
    cache_path = os.path.join(_PREVIEW_CACHE_DIR, f"{key}.jpg")
    if os.path.exists(cache_path):
        return cache_path

    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((size, size))
        tmp_path = f"{cache_path}.tmp-{os.getpid()}"
        img.convert("RGB").save(tmp_path, format="JPEG", quality=75)
        os.replace(tmp_path, cache_path)
    return cache_path

@app.get("/media/preview")
async def serve_preview(path: str, size: int = 400):
    real_path = _resolve_indexed_path(path)
    try:
        # Run CPU-bound PIL operation in a separate thread to unblock the event loop
        cache_path = await asyncio.to_thread(generate_preview, real_path, size)
        # FileResponse derives ETag/Last-Modified from cache_path's own stat, so
        # conditional GETs 304 correctly once the browser has fetched a preview.
        return FileResponse(cache_path, media_type="image/jpeg")
    except Exception as e:
        # Do not fall back to the full-resolution original here: a corrupt or
        # unreadable source file would otherwise stream a multi-MB image into
        # what's meant to be a small grid cell.
        logger.error("Preview generation failed for %s: %s", real_path, e)
        raise HTTPException(status_code=422, detail="Could not generate preview")

@app.get("/media/thumbnail/{face_id}")
async def serve_thumbnail(face_id: int):
    """Serve the generated thumbnail for a face"""
    path = controller().db.get_face_thumbnail(face_id)
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(path)

if __name__ == "__main__":
    # ------------------------------------------------------------------
    # Windows multiprocessing fix:
    # On Windows, 'spawn' is the only available start method.  Each
    # spawned worker re-imports this module.  freeze_support() prevents
    # the re-import from starting another top-level entry point, and
    # the Controller/Pool creation is deferred to the @app.on_event
    # ("startup") handler above so it never runs in a worker process.
    # ------------------------------------------------------------------
    import multiprocessing
    multiprocessing.freeze_support()
    # Explicitly set spawn to be consistent across platforms
    try:
        multiprocessing.set_start_method("spawn")
    except RuntimeError:
        pass  # already set

    port = 8000
    if "--port" in sys.argv:
        port_idx = sys.argv.index("--port")
        if port_idx + 1 < len(sys.argv):
            port = int(sys.argv[port_idx + 1])
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
