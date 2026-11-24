import asyncio
import hashlib
import logging
import os
import sys
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, ImageEnhance, ImageOps
import pillow_heif
from pydantic import BaseModel, Field
import uvicorn

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
    data_dir = os.path.abspath(os.environ.get("SNAPSORT_DATA_DIR", DATA_DIR))
    _controller = Controller(num_workers=4, data_dir=data_dir)


@app.on_event("shutdown")
def _shutdown():
    global _controller
    if _controller is not None:
        _controller.shutdown()
        _controller = None

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

class EditAdjustments(BaseModel):
    light: float = 0.0
    contrast: float = 0.0
    saturation: float = 0.0
    warmth: float = 0.0


class CropRect(BaseModel):
    x: float = 0.0
    y: float = 0.0
    w: float = 1.0
    h: float = 1.0


class SaveEditRequest(BaseModel):
    source_path: str
    mode: Literal["copy", "replace"] = "copy"
    crop: CropRect | None = None
    rotate_deg: int = 0
    flip_h: bool = False
    flip_v: bool = False
    straighten_deg: float = 0.0
    filter_preset: Literal["original", "vivid", "warm", "cool", "mono", "noir"] = "original"
    adjustments: EditAdjustments = Field(default_factory=EditAdjustments)


_FILTER_DELTAS: dict[str, dict[str, float | bool]] = {
    "original": {},
    "vivid": {"contrast": 15.0, "saturation": 35.0},
    "warm": {"warmth": 35.0, "saturation": 10.0},
    "cool": {"warmth": -35.0, "contrast": 8.0},
    "mono": {"grayscale": True, "contrast": 8.0},
    "noir": {"grayscale": True, "contrast": 35.0, "light": -8.0},
}

_EXT_TO_PIL_FORMAT = {
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".png": "PNG",
    ".webp": "WEBP",
    ".bmp": "BMP",
    ".tif": "TIFF",
    ".tiff": "TIFF",
}


def _next_edited_copy_path(real_path: str, ext: str) -> str:
    stem, _ = os.path.splitext(real_path)
    candidate = f"{stem}_edited{ext}"
    index = 2
    while os.path.exists(candidate):
        candidate = f"{stem}_edited_{index}{ext}"
        index += 1
    return candidate


def _extract_normalized_exif(img: Image.Image) -> bytes | None:
    raw_exif = img.info.get("exif")
    if not raw_exif:
        return None
    try:
        exif = img.getexif()
        exif[274] = 1  # Reset Orientation after applying exif_transpose to pixels
        return exif.tobytes()
    except Exception:
        return raw_exif


def _apply_tone_and_color(rgb: Image.Image, req: SaveEditRequest) -> Image.Image:
    preset = _FILTER_DELTAS.get(req.filter_preset, {})
    light = max(-100.0, min(100.0, req.adjustments.light + float(preset.get("light", 0.0))))
    contrast = max(-100.0, min(100.0, req.adjustments.contrast + float(preset.get("contrast", 0.0))))
    saturation = max(-100.0, min(100.0, req.adjustments.saturation + float(preset.get("saturation", 0.0))))
    warmth = max(-100.0, min(100.0, req.adjustments.warmth + float(preset.get("warmth", 0.0))))
    is_mono = bool(preset.get("grayscale", False))

    if is_mono:
        rgb = ImageOps.grayscale(rgb).convert("RGB")
    elif abs(saturation) > 0.01:
        rgb = ImageEnhance.Color(rgb).enhance(max(0.0, 1.0 + saturation / 100.0))

    if abs(light) > 0.01:
        rgb = ImageEnhance.Brightness(rgb).enhance(max(0.1, 1.0 + light / 100.0))

    if abs(contrast) > 0.01:
        rgb = ImageEnhance.Contrast(rgb).enhance(max(0.1, 1.0 + contrast / 100.0))

    if not is_mono and abs(warmth) > 0.01:
        r_gain = max(0.5, min(1.5, 1.0 + warmth / 180.0))
        b_gain = max(0.5, min(1.5, 1.0 - warmth / 180.0))
        r, g, b = rgb.split()
        r = r.point(lambda p: max(0, min(255, int(round(p * r_gain)))))
        b = b.point(lambda p: max(0, min(255, int(round(p * b_gain)))))
        rgb = Image.merge("RGB", (r, g, b))

    return rgb


def _apply_edits_and_save(real_path: str, req: SaveEditRequest, db) -> str:
    _, orig_ext = os.path.splitext(real_path)
    ext_lower = orig_ext.lower()
    if req.mode == "replace" and ext_lower not in _EXT_TO_PIL_FORMAT:
        raise HTTPException(
            status_code=422,
            detail="Replace Original is not supported for this format; use Save as Copy instead.",
        )
    out_ext = orig_ext if ext_lower in _EXT_TO_PIL_FORMAT else ".jpg"
    out_format = _EXT_TO_PIL_FORMAT.get(out_ext.lower(), "JPEG")
    target_path = real_path if req.mode == "replace" else _next_edited_copy_path(real_path, out_ext)

    with Image.open(real_path) as opened:
        raw_exif = _extract_normalized_exif(opened)
        img = ImageOps.exif_transpose(opened)

        steps = (req.rotate_deg % 360) // 90
        if steps == 1:
            img = img.transpose(Image.Transpose.ROTATE_270)
        elif steps == 2:
            img = img.transpose(Image.Transpose.ROTATE_180)
        elif steps == 3:
            img = img.transpose(Image.Transpose.ROTATE_90)

        if req.flip_h:
            img = ImageOps.mirror(img)
        if req.flip_v:
            img = ImageOps.flip(img)

        straighten = max(-45.0, min(45.0, float(req.straighten_deg)))
        if abs(straighten) > 0.05:
            img = img.rotate(-straighten, resample=Image.Resampling.BICUBIC, expand=False)

        if req.crop is not None:
            cx = max(0.0, min(0.99, float(req.crop.x)))
            cy = max(0.0, min(0.99, float(req.crop.y)))
            cw = max(0.01, min(1.0 - cx, float(req.crop.w)))
            ch = max(0.01, min(1.0 - cy, float(req.crop.h)))
            if cx > 0.001 or cy > 0.001 or cw < 0.999 or ch < 0.999:
                width, height = img.size
                left = int(round(cx * width))
                top = int(round(cy * height))
                right = max(left + 1, int(round((cx + cw) * width)))
                bottom = max(top + 1, int(round((cy + ch) * height)))
                img = img.crop((left, top, right, bottom))

        has_alpha = img.mode == "RGBA" and out_format in ("PNG", "WEBP")
        alpha = img.getchannel("A") if has_alpha else None
        rgb = _apply_tone_and_color(img.convert("RGB"), req)
        out_img = rgb
        if alpha is not None:
            out_img = rgb.copy()
            out_img.putalpha(alpha)

        save_kwargs: dict[str, object] = {}
        if out_format in ("JPEG", "WEBP"):
            save_kwargs["quality"] = 95
        if raw_exif and out_format in ("JPEG", "PNG", "WEBP", "TIFF"):
            save_kwargs["exif"] = raw_exif

        target_ext = os.path.splitext(target_path)[1] or out_ext
        tmp_path = f"{target_path}.tmp-{os.getpid()}{target_ext}"
        try:
            try:
                out_img.save(tmp_path, format=out_format, **save_kwargs)
            except TypeError:
                save_kwargs.pop("exif", None)
                out_img.save(tmp_path, format=out_format, **save_kwargs)
            os.replace(tmp_path, target_path)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    if req.mode == "copy":
        db.insert_image(target_path)
    else:
        img_id = db.get_image_id(real_path)
        if img_id is not None:
            db.update_image_mtime(img_id, os.path.getmtime(real_path))
    return target_path


@app.post("/api/images/save-copy")
async def save_edited_image(req: SaveEditRequest):
    """Apply non-destructive viewer edits to disk as a new copy or replace the original."""
    ctrl = controller()
    real_path = _resolve_indexed_path(req.source_path)
    try:
        saved_path = await asyncio.to_thread(_apply_edits_and_save, real_path, req, ctrl.db)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to save edited image %s: %s", real_path, exc)
        raise HTTPException(status_code=422, detail="Could not save edited photo")
    return {"status": "ok", "saved_path": saved_path, "mode": req.mode}


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
    for candidate in (path, os.path.realpath(path)):
        if db.get_image_id(candidate) is None:
            continue
        # Indexed but gone from disk: an unplugged external drive or a file
        # moved outside SnapSort. 404 here rather than letting the caller
        # fail deeper with a misleading 422 + error log per tile.
        if not os.path.exists(candidate):
            raise HTTPException(status_code=404, detail="File unavailable (moved or drive not mounted)")
        return candidate
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
