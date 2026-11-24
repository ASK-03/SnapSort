import asyncio
import hashlib
import hmac
import logging
import os
import secrets
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageEnhance, ImageOps
import pillow_heif
from pydantic import BaseModel, Field
import uvicorn

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from mcp_runtime import (
    APP_VERSION,
    BACKEND_LOCK_FILENAME,
    PROTOCOL_VERSION,
    FileLockError,
    file_lock,
    is_path_within_approved_roots,
    is_pid_alive,
    load_policy,
    read_audit_log,
    remove_runtime_info_if_matches,
    write_runtime_info,
)

pillow_heif.register_heif_opener()  # lets Image.open() decode .heic/.heif in the main process

logger = logging.getLogger(__name__)


def _parse_cli_arg(name: str, default: str) -> str:
    """Read --name VALUE from sys.argv, falling back to *default*."""
    if name in sys.argv:
        idx = sys.argv.index(name)
        if idx + 1 < len(sys.argv):
            return sys.argv[idx + 1]
    return default


def _parse_cli_flag(name: str) -> bool:
    return name in sys.argv


DATA_DIR = _parse_cli_arg(
    "--data-dir",
    os.environ.get("SNAPSORT_DATA_DIR", os.path.join(_BACKEND_DIR, "..", "data")),
)
MODELS_DIR = _parse_cli_arg(
    "--models-dir",
    os.environ.get("SNAPSORT_MODELS_DIR", os.path.join(_BACKEND_DIR, "..", "models")),
)
IS_HEADLESS = _parse_cli_flag("--headless") or os.environ.get("SNAPSORT_HEADLESS") == "1"
IDLE_TIMEOUT = int(_parse_cli_arg("--idle-timeout", os.environ.get("SNAPSORT_IDLE_TIMEOUT", "300")))
INSTANCE_ID = _parse_cli_arg("--instance-id", os.environ.get("SNAPSORT_INSTANCE_ID", str(uuid.uuid4())))
BIND_PORT = int(_parse_cli_arg("--port", os.environ.get("SNAPSORT_PORT", "8000")))

os.makedirs(DATA_DIR, exist_ok=True)
os.environ["SNAPSORT_DATA_DIR"] = os.path.abspath(DATA_DIR)
os.environ["SNAPSORT_MODELS_DIR"] = os.path.abspath(MODELS_DIR)

_ALLOWED_HOSTS = {"127.0.0.1", "localhost", "testserver", "::1", "[::1]"}


def _publish_runtime_if_needed(app_instance: FastAPI) -> None:
    data_dir = app_instance.state.data_dir
    policy = load_policy(data_dir)
    if app_instance.state.mode == "headless" or policy["mcp_enabled"]:
        write_runtime_info(
            data_dir,
            {
                "version": 1,
                "mode": app_instance.state.mode,
                "app_version": APP_VERSION,
                "protocol_version": PROTOCOL_VERSION,
                "port": app_instance.state.port,
                "instance_id": app_instance.state.instance_id,
                "token": app_instance.state.token,
                "data_dir": os.path.realpath(data_dir),
                "pid": os.getpid(),
                "started_at": app_instance.state.started_at,
            },
        )
    else:
        remove_runtime_info_if_matches(data_dir, app_instance.state.instance_id)


async def _watchdog_loop(app_instance: FastAPI) -> None:
    try:
        while True:
            sleep_s = min(5.0, max(0.5, float(app_instance.state.idle_timeout) / 2.0))
            await asyncio.sleep(sleep_s)
            ctrl = getattr(app_instance.state, "controller", None)
            if ctrl is not None:
                ctrl.shutdown_idle_pool()

            if app_instance.state.desktop_attached and app_instance.state.desktop_pid:
                if not is_pid_alive(app_instance.state.desktop_pid):
                    logger.warning(
                        "Desktop PID %s exited unexpectedly; transitioning backend state",
                        app_instance.state.desktop_pid,
                    )
                    app_instance.state.desktop_attached = False
                    app_instance.state.desktop_pid = None
                    if ctrl is not None and ctrl.is_scanning:
                        app_instance.state.mode = "headless"
                        _publish_runtime_if_needed(app_instance)

            if not app_instance.state.desktop_attached:
                is_scanning = bool(ctrl and ctrl.is_scanning)
                idle_elapsed = time.monotonic() - app_instance.state.last_activity_ts
                if not is_scanning and idle_elapsed >= app_instance.state.idle_timeout:
                    logger.info("Headless idle timeout (%ds) reached; shutting down", app_instance.state.idle_timeout)
                    srv = getattr(app_instance.state, "uvicorn_server", None)
                    if srv is not None:
                        srv.should_exit = True
                    break
    except asyncio.CancelledError:
        pass


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    data_dir = os.path.abspath(os.environ.get("SNAPSORT_DATA_DIR", DATA_DIR))
    os.makedirs(data_dir, exist_ok=True)
    os.environ["SNAPSORT_DATA_DIR"] = data_dir

    headless = _parse_cli_flag("--headless") or os.environ.get("SNAPSORT_HEADLESS") == "1"
    idle_timeout = int(os.environ.get("SNAPSORT_IDLE_TIMEOUT", str(IDLE_TIMEOUT)))
    instance_id = os.environ.get("SNAPSORT_INSTANCE_ID", INSTANCE_ID)
    token = os.environ.get("SNAPSORT_API_TOKEN") or secrets.token_urlsafe(32)
    port = int(os.environ.get("SNAPSORT_PORT", str(BIND_PORT)))
    desktop_pid_raw = os.environ.get("SNAPSORT_DESKTOP_PID")
    desktop_pid = int(desktop_pid_raw) if desktop_pid_raw and desktop_pid_raw.isdigit() else None

    lock_cm = file_lock(os.path.join(data_dir, BACKEND_LOCK_FILENAME), non_blocking=True)
    try:
        lock_cm.__enter__()
    except FileLockError:
        logger.error("Another SnapSort backend already holds %s", BACKEND_LOCK_FILENAME)
        raise RuntimeError("SnapSort backend lock is already held for this library")

    app_instance.state.data_dir = data_dir
    app_instance.state.instance_id = instance_id
    app_instance.state.token = token
    app_instance.state.port = port
    app_instance.state.idle_timeout = idle_timeout
    app_instance.state.mode = "headless" if headless else "desktop"
    app_instance.state.desktop_attached = not headless
    app_instance.state.desktop_pid = desktop_pid
    app_instance.state.started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    app_instance.state.last_activity_ts = time.monotonic()
    app_instance.state.last_mcp_ts = 0.0
    app_instance.state.preview_timestamps = []

    from controller import Controller

    ctrl = Controller(data_dir=data_dir, headless=headless)
    app_instance.state.controller = ctrl
    _publish_runtime_if_needed(app_instance)

    watchdog_task = asyncio.create_task(_watchdog_loop(app_instance))
    try:
        yield
    finally:
        watchdog_task.cancel()
        try:
            await watchdog_task
        except asyncio.CancelledError:
            pass
        ctrl.shutdown()
        app_instance.state.controller = None
        remove_runtime_info_if_matches(data_dir, instance_id)
        lock_cm.__exit__(None, None, None)


app = FastAPI(title="SnapSort API", lifespan=lifespan)

# Strict loopback + packaged Electron file:// CORS policy
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|file://)$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-SnapSort-Client"],
)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    host_header = (request.headers.get("host") or "").split(":")[0].lower()
    if host_header and host_header not in _ALLOWED_HOSTS:
        return JSONResponse({"detail": "Forbidden host header"}, status_code=403)

    if request.method != "OPTIONS" and (
        request.url.path.startswith("/api/") or request.url.path.startswith("/media/")
    ):
        expected = getattr(app.state, "token", None)
        auth_header = request.headers.get("authorization") or ""
        if not expected or not auth_header.startswith("Bearer "):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        supplied = auth_header[7:]
        if not hmac.compare_digest(supplied, expected):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)

        now = time.monotonic()
        app.state.last_activity_ts = now
        if (
            request.headers.get("x-snapsort-client") == "mcp"
            or request.url.path.startswith("/api/mcp/")
        ):
            app.state.last_mcp_ts = now

    return await call_next(request)


def controller():
    ctrl = getattr(app.state, "controller", None)
    if ctrl is None:
        raise RuntimeError("Controller not initialised")
    return ctrl


def _preview_cache_dir() -> str:
    d = os.path.join(os.path.abspath(app.state.data_dir), "previews")
    os.makedirs(d, exist_ok=True)
    return d


class ScanRequest(BaseModel):
    folder_path: str


class AttachRequest(BaseModel):
    desktop_pid: int | None = None


class McpScanRequest(BaseModel):
    folder_path: str
    wait_seconds: float = 0.0


@app.get("/api/status")
async def get_status():
    """Health and identity check for Electron and MCP adapter."""
    ctrl = getattr(app.state, "controller", None)
    return {
        "status": "ok",
        "initialised": ctrl is not None,
        "instance_id": getattr(app.state, "instance_id", INSTANCE_ID),
        "data_dir": os.path.realpath(getattr(app.state, "data_dir", DATA_DIR)),
        "mode": getattr(app.state, "mode", "desktop"),
        "app_version": APP_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "desktop_attached": getattr(app.state, "desktop_attached", False),
        "indexing_in_progress": bool(ctrl and ctrl.is_scanning),
        "active_scan_id": ctrl.active_job_id if ctrl else None,
    }


@app.post("/api/client/attach")
async def attach_client(req: AttachRequest):
    """Attach Electron UI to a running backend instance."""
    app.state.desktop_attached = True
    app.state.desktop_pid = req.desktop_pid
    app.state.mode = "desktop"
    _publish_runtime_if_needed(app)
    ctrl = controller()
    return {
        "status": "attached",
        "mode": app.state.mode,
        "indexing_in_progress": ctrl.is_scanning,
        "active_scan_id": ctrl.active_job_id,
    }


@app.post("/api/client/heartbeat")
async def client_heartbeat():
    app.state.last_activity_ts = time.monotonic()
    return {"status": "ok"}


@app.post("/api/client/detach")
async def detach_client():
    """Detach Electron UI; keep running headless if a scan or headless MCP session is active."""
    app.state.desktop_attached = False
    app.state.desktop_pid = None
    ctrl = controller()
    policy = load_policy(app.state.data_dir)
    recent_mcp = (time.monotonic() - app.state.last_mcp_ts) < 30.0
    if ctrl.is_scanning or (policy["headless_enabled"] and recent_mcp):
        app.state.mode = "headless"
        _publish_runtime_if_needed(app)
        return {"action": "continuing_headless"}

    srv = getattr(app.state, "uvicorn_server", None)
    if srv is not None:
        srv.should_exit = True
    return {"action": "shutting_down"}


@app.post("/api/shutdown")
async def shutdown_backend():
    srv = getattr(app.state, "uvicorn_server", None)
    if srv is not None:
        srv.should_exit = True
    return {"status": "shutting_down"}


@app.post("/api/mcp/policy/sync")
async def sync_mcp_policy():
    """Re-read mcp-policy.json written by Electron UI and update discovery visibility."""
    policy = load_policy(app.state.data_dir)
    _publish_runtime_if_needed(app)
    return {"status": "ok", "policy": policy}


@app.post("/api/scan")
async def start_scan(req: ScanRequest):
    """Start or enqueue scanning a directory (for Electron UI)."""
    if not os.path.exists(req.folder_path) or not os.path.isdir(req.folder_path):
        raise HTTPException(status_code=400, detail="Invalid folder path")

    res = await asyncio.to_thread(controller().scan_folder, req.folder_path)
    if res.get("error"):
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@app.get("/api/progress")
async def get_progress(scan_id: str | None = None):
    """Get current or specific scanning progress."""
    ctrl = controller()
    job = ctrl.get_job_status(scan_id) if scan_id else ctrl.get_job_status(None)
    if scan_id and job.get("error"):
        raise HTTPException(status_code=404, detail=job["error"])
    return {
        "is_scanning": ctrl.is_scanning,
        "total_images": ctrl.total_images,
        "processed_images": ctrl.processed_images,
        "pending_tasks": ctrl.pending_tasks,
        "active_scan_id": ctrl.active_job_id,
        "job": job,
    }


@app.get("/api/stats")
async def get_stats():
    """Get library statistics plus active scan state."""
    ctrl = controller()
    stats = ctrl.db.get_stats()
    return {
        **stats,
        "indexing_in_progress": ctrl.is_scanning,
        "active_scan_id": ctrl.active_job_id,
    }


@app.get("/api/images")
async def get_images(offset: int = 0, limit: int = 50):
    """Fetch paginated list of all images."""
    images = controller().db.get_all_images_paginated(offset, limit)
    return {"images": images}


@app.get("/api/images/faces")
async def get_faces_in_image(image_path: str):
    """Get all face IDs and names found in an indexed image."""
    ctrl = controller()
    resolved = None
    for candidate in (image_path, os.path.realpath(image_path)):
        if ctrl.db.get_image_id(candidate) is not None:
            resolved = candidate
            break
    if resolved is None:
        raise HTTPException(status_code=404, detail="Image not found in index")

    face_ids = ctrl.get_faces_in_image(resolved)
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
        if img_id is not None and hasattr(db, "update_image_mtime"):
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


def _to_float(val) -> float | None:
    if val is None:
        return None
    try:
        if isinstance(val, tuple) and len(val) == 2:
            num, den = val
            return float(num) / float(den) if den else None
        return float(val)
    except Exception:
        return None


def _decode_gps_coord(dms, ref) -> float | None:
    if not isinstance(dms, (tuple, list)) or len(dms) != 3:
        return None
    d = _to_float(dms[0])
    m = _to_float(dms[1])
    s = _to_float(dms[2])
    if d is None or m is None or s is None:
        return None
    dec = d + m / 60.0 + s / 3600.0
    if isinstance(ref, bytes):
        ref = ref.decode("ascii", errors="ignore")
    if isinstance(ref, str) and ref.upper() in ("S", "W"):
        dec = -abs(dec)
    return round(dec, 5)


def _extract_image_metadata(real_path: str) -> dict[str, object]:
    stat = os.stat(real_path)
    modified_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _, ext = os.path.splitext(real_path)
    ext_fmt = ext.lstrip(".").upper() or "UNKNOWN"

    date_taken: str | None = None
    camera: str | None = None
    lens: str | None = None
    focal_length: str | None = None
    aperture: str | None = None
    shutter_speed: str | None = None
    iso: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    location_label: str | None = None

    with Image.open(real_path) as img:
        fmt = (img.format or ext_fmt).upper()
        width, height = img.size
        exif = img.getexif()

        orientation = exif.get(274)
        if orientation in (5, 6, 7, 8):
            width, height = height, width

        make = str(exif.get(271) or "").strip()
        model = str(exif.get(272) or "").strip()
        if model and make and model.lower().startswith(make.lower()):
            camera = model
        elif make or model:
            camera = f"{make} {model}".strip()

        base_date = str(exif.get(306) or "").strip() or None

        try:
            exif_ifd = exif.get_ifd(0x8769)
        except Exception:
            exif_ifd = {}

        raw_dto = str(exif_ifd.get(36867) or "").strip() if exif_ifd else ""
        date_taken = raw_dto or base_date
        if exif_ifd:
            lens_raw = exif_ifd.get(42036)
            if lens_raw:
                lens = str(lens_raw).strip() or None

            fl = _to_float(exif_ifd.get(37386))
            if fl is not None and fl > 0:
                focal_length = f"{fl:g} mm"

            fn = _to_float(exif_ifd.get(33437))
            if fn is not None and fn > 0:
                aperture = f"f/{fn:g}"

            exp = _to_float(exif_ifd.get(33434))
            if exp is not None and exp > 0:
                if exp < 1.0:
                    denom = max(1, int(round(1.0 / exp)))
                    shutter_speed = f"1/{denom} s"
                else:
                    shutter_speed = f"{exp:g} s"

            iso_raw = exif_ifd.get(34855) or exif_ifd.get(34867)
            if isinstance(iso_raw, (tuple, list)) and iso_raw:
                iso_raw = iso_raw[0]
            if iso_raw is not None:
                try:
                    iso = int(iso_raw)
                except Exception:
                    iso = None

        try:
            gps_ifd = exif.get_ifd(0x8825)
        except Exception:
            gps_ifd = {}

        if gps_ifd:
            latitude = _decode_gps_coord(gps_ifd.get(2), gps_ifd.get(1))
            longitude = _decode_gps_coord(gps_ifd.get(4), gps_ifd.get(3))
            if latitude is not None and longitude is not None:
                lat_hem = "N" if latitude >= 0 else "S"
                lon_hem = "E" if longitude >= 0 else "W"
                location_label = f"{abs(latitude):.5f}° {lat_hem}, {abs(longitude):.5f}° {lon_hem}"

    megapixels = round((width * height) / 1_000_000, 1) if width and height else 0.0
    return {
        "filename": os.path.basename(real_path),
        "path": real_path,
        "format": fmt,
        "width": width,
        "height": height,
        "megapixels": megapixels,
        "file_size_bytes": stat.st_size,
        "modified_at": modified_at,
        "date_taken": date_taken,
        "camera": camera,
        "lens": lens,
        "focal_length": focal_length,
        "aperture": aperture,
        "shutter_speed": shutter_speed,
        "iso": iso,
        "latitude": latitude,
        "longitude": longitude,
        "location_label": location_label,
    }


@app.get("/api/images/metadata")
async def get_image_metadata(path: str):
    """Return file dimensions, EXIF camera settings, and GPS coordinates for an indexed image."""
    real_path = _resolve_indexed_path(path)
    try:
        return await asyncio.to_thread(_extract_image_metadata, real_path)
    except Exception as exc:
        logger.error("Failed to read metadata for %s: %s", real_path, exc)
        raise HTTPException(status_code=422, detail="Could not inspect photo metadata")


@app.get("/api/faces")
async def get_faces(name: str | None = None, limit: int | None = None, offset: int = 0):
    """Fetch face clusters with distinct photo counts and optional filtering/pagination."""
    clamped_limit = max(1, min(100, limit)) if limit is not None else None
    faces = controller().db.get_all_faces_with_counts(
        name_filter=name,
        limit=clamped_limit,
        offset=max(0, offset),
    )
    return {"faces": faces}


@app.get("/api/faces/{face_id}/images")
async def get_images_for_face(
    face_id: int,
    folder: str | None = None,
    limit: int | None = None,
    offset: int = 0,
):
    """Fetch indexed images containing a specific person, resolving merged cluster IDs."""
    ctrl = controller()
    canonical_id, was_merged = ctrl.db.resolve_face_id(face_id)
    if not ctrl.db.face_exists(canonical_id):
        raise HTTPException(status_code=404, detail=f"Unknown face cluster ID: {face_id}")

    clamped_limit = max(1, min(100, limit)) if limit is not None else None
    images = ctrl.get_images_for_face(
        canonical_id,
        folder=folder,
        limit=clamped_limit,
        offset=max(0, offset),
    )
    return {
        "images": images,
        "face_id": canonical_id,
        "merged_from": face_id if was_merged else None,
    }


class RenameRequest(BaseModel):
    name: str


@app.put("/api/faces/{face_id}")
async def rename_face(face_id: int, req: RenameRequest):
    """Rename a face cluster."""
    controller().rename_face(face_id, req.name)
    return {"status": "ok"}


class MergeRequest(BaseModel):
    primary_id: int
    other_ids: list[int]


@app.post("/api/faces/merge")
async def merge_faces(req: MergeRequest):
    """Merge multiple face clusters together."""
    controller().merge_face_ids(req.primary_id, req.other_ids)
    return {"status": "ok"}


@app.get("/api/search")
async def search_images(
    q: str,
    person_id: int | None = None,
    person_name: str | None = None,
    folder: str | None = None,
    limit: int = 20,
    min_score: float | None = None,
    include_meta: bool = False,
):
    """Semantic text, person-filtered, and folder-filtered search."""
    ctrl = controller()
    clamped_limit = max(1, min(100, limit))
    policy = load_policy(app.state.data_dir)
    stats = ctrl.db.get_stats()
    resolved_person_id = None
    person_photo_count: int | None = None

    if person_id is not None:
        resolved_person_id, _ = ctrl.db.resolve_face_id(person_id)
        if not ctrl.db.face_exists(resolved_person_id):
            raise HTTPException(status_code=404, detail=f"Unknown face cluster ID: {person_id}")
        person_photo_count = len(ctrl.db.get_image_ids_for_face(resolved_person_id))
    elif person_name and person_name.strip():
        matches = ctrl.db.get_all_faces_with_counts(name_filter=person_name.strip(), limit=20)
        if not matches:
            if not include_meta:
                return []
            return {
                "results": [],
                "status": "person_not_found",
                "message": (
                    f"No indexed person matches '{person_name.strip()}'. "
                    "Ask the user to name them in SnapSort's People view."
                ),
                "resolved_person_id": None,
                "person_photo_count": 0,
                "total_indexed_photos": stats["photos"],
                "clip_indexed_photos": stats["clip_indexed_photos"],
                "indexing_in_progress": ctrl.is_scanning,
                "active_scan_id": ctrl.active_job_id,
                "allow_previews": policy["allow_previews"],
            }
        if len(matches) > 1:
            if not include_meta:
                return []
            return {
                "results": [],
                "status": "disambiguation_required",
                "matching_people": matches,
                "message": (
                    f"Multiple face clusters match '{person_name.strip()}'. "
                    "Ask the user which person_id to search."
                ),
                "resolved_person_id": None,
                "person_photo_count": None,
                "total_indexed_photos": stats["photos"],
                "clip_indexed_photos": stats["clip_indexed_photos"],
                "indexing_in_progress": ctrl.is_scanning,
                "active_scan_id": ctrl.active_job_id,
                "allow_previews": policy["allow_previews"],
            }
        resolved_person_id = matches[0]["id"]
        person_photo_count = matches[0]["count"]

    if min_score is not None:
        effective_min = max(0.0, min(1.0, float(min_score)))
    elif include_meta:
        effective_min = 0.20 if resolved_person_id is not None else 0.22
    else:
        effective_min = 0.25

    results, highest_below = await asyncio.to_thread(
        ctrl.search_with_diagnostics,
        q,
        top_k=clamped_limit,
        person_id=resolved_person_id,
        folder=folder,
        min_score=effective_min,
    )
    items = [{"path": path, "score": float(score)} for path, score in results]
    if not include_meta:
        return items

    status = "ok"
    hint: str | None = None
    if not items:
        if stats["photos"] == 0 or stats["clip_indexed_photos"] == 0:
            status = "empty_library"
            hint = (
                "No CLIP-indexed photos are available yet. Call list_approved_folders to check "
                "folder status or ask the user to scan a folder in SnapSort."
            )
        elif folder and ctrl.db.count_images_in_folder(folder) == 0:
            status = "folder_empty"
            hint = (
                f"No indexed photos found in '{folder}'. Stop searching this folder and tell "
                "the user to add or scan photos in an approved folder."
            )
        else:
            status = "no_matches"
            if resolved_person_id is not None:
                hint = (
                    "No scene matches met the threshold for that person. Do NOT keep retrying "
                    "rephrased queries—you may call get_person_images(person_id) or report this to the user."
                )
            else:
                hint = (
                    "No images met the similarity threshold. Make at most one broader search "
                    "(for example with min_score=0.18); do not loop over synonym variations."
                )

    return {
        "results": items,
        "status": status,
        "hint": hint,
        "resolved_person_id": resolved_person_id,
        "person_photo_count": person_photo_count,
        "total_indexed_photos": stats["photos"],
        "clip_indexed_photos": stats["clip_indexed_photos"],
        "indexing_in_progress": ctrl.is_scanning,
        "active_scan_id": ctrl.active_job_id,
        "allow_previews": policy["allow_previews"],
        "min_score_used": effective_min,
        "highest_below_threshold": highest_below,
    }


def _resolve_indexed_path(path: str) -> str:
    """Confirm 'path' is already known to the DB and exists on disk before serving."""
    db = controller().db
    for candidate in (path, os.path.realpath(path)):
        if db.get_image_id(candidate) is None:
            continue
        if not os.path.exists(candidate):
            raise HTTPException(status_code=404, detail="File unavailable (moved or drive not mounted)")
        return candidate
    raise HTTPException(status_code=404, detail="Image not found")


_BROWSER_UNSAFE_EXTS = (".heic", ".heif", ".tif", ".tiff")


@app.get("/media/image")
async def serve_image(path: str):
    real_path = _resolve_indexed_path(path)
    if real_path.lower().endswith(_BROWSER_UNSAFE_EXTS):
        cache_path = await asyncio.to_thread(generate_preview, real_path, 4096)
        return FileResponse(cache_path, media_type="image/jpeg")
    return FileResponse(real_path)


def generate_preview(path: str, size: int) -> str:
    """Render a downscaled, EXIF-stripped JPEG preview to cache and return its path."""
    mtime = os.path.getmtime(path)
    cache_dir = _preview_cache_dir()
    key = hashlib.sha1(f"{path}:{mtime}:{size}".encode()).hexdigest()
    cache_path = os.path.join(cache_dir, f"{key}.jpg")
    if os.path.exists(cache_path):
        return cache_path

    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((size, size))
        tmp_path = f"{cache_path}.tmp-{os.getpid()}"
        # Re-encoding without exif= strips GPS and camera metadata
        img.convert("RGB").save(tmp_path, format="JPEG", quality=75)
        os.replace(tmp_path, cache_path)
    return cache_path


@app.get("/media/preview")
async def serve_preview(path: str, size: int = 400):
    real_path = _resolve_indexed_path(path)
    try:
        cache_path = await asyncio.to_thread(generate_preview, real_path, size)
        return FileResponse(cache_path, media_type="image/jpeg")
    except Exception as e:
        logger.error("Preview generation failed for %s: %s", real_path, e)
        raise HTTPException(status_code=422, detail="Could not generate preview")


@app.get("/media/thumbnail/{face_id}")
async def serve_thumbnail(face_id: int):
    """Serve the generated thumbnail for a face."""
    path = controller().db.get_face_thumbnail(face_id)
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(path)


# ---------------------------------------------------------------------------
# MCP Policy-Gated Endpoints
# ---------------------------------------------------------------------------

def _require_mcp_policy() -> dict:
    policy = load_policy(app.state.data_dir)
    if not policy["mcp_enabled"]:
        raise HTTPException(status_code=403, detail="SnapSort MCP access is disabled in Settings")
    if app.state.mode == "headless" and not policy["headless_enabled"]:
        raise HTTPException(status_code=403, detail="Headless MCP access is disabled in Settings")
    return policy


def _folder_has_supported_files(folder: str) -> bool:
    """Return True as soon as one supported image file is found under folder."""
    from controller import Controller

    if not os.path.isdir(folder):
        return False
    for _, _, files in os.walk(folder):
        for fn in files:
            if fn.lower().endswith(Controller.SUPPORTED_EXTENSIONS):
                return True
    return False


@app.get("/api/mcp/folders")
async def mcp_list_approved_folders():
    policy = _require_mcp_policy()
    ctrl = controller()
    folders = []
    for root in policy["approved_roots"]:
        exists = os.path.isdir(root)
        indexed = ctrl.db.count_images_in_folder(root)
        has_files = indexed > 0 or (exists and await asyncio.to_thread(_folder_has_supported_files, root))
        if not exists:
            folder_status = "folder_unavailable"
        elif not has_files and indexed == 0:
            folder_status = "empty_folder"
        elif indexed == 0 and has_files:
            folder_status = "needs_scan" if policy["allow_agent_scan"] else "needs_user_scan"
        else:
            folder_status = "ready"
        folders.append(
            {
                "path": root,
                "exists": exists,
                "indexed_images": indexed,
                "has_supported_files": has_files,
                "status": folder_status,
            }
        )

    if not folders:
        top_status = "no_approved_folders"
        action_required = (
            "No approved folders are configured in SnapSort. Stop and tell the user to open "
            "SnapSort -> Settings -> MCP & AI Agent Access -> Approved Folders and click 'Add Folder'."
        )
    elif all(f["status"] in ("empty_folder", "folder_unavailable") for f in folders):
        top_status = "no_images_in_approved_folders"
        action_required = (
            "The approved folder(s) contain no supported photos (or are unavailable). "
            "Stop retrying and tell the user to add photos or approve a folder with photos in SnapSort Settings -> Approved Folders."
        )
    elif all(f["indexed_images"] == 0 for f in folders) and any(f["status"] == "needs_user_scan" for f in folders):
        top_status = "needs_user_scan"
        action_required = (
            "Approved folders contain unindexed photos, but Agent Folder Scanning is disabled. "
            "Tell the user to scan the folder in SnapSort or enable 'Allow Agent Folder Scanning' in Settings."
        )
    elif all(f["indexed_images"] == 0 for f in folders) and any(f["status"] == "needs_scan" for f in folders):
        top_status = "needs_scan"
        action_required = (
            "Approved folders contain unindexed photos. Call scan_folder on an approved root to index them."
        )
    else:
        top_status = "ok"
        action_required = None

    return {
        "status": top_status,
        "action_required": action_required,
        "folders": folders,
        "allow_agent_scan": policy["allow_agent_scan"],
        "allow_previews": policy["allow_previews"],
        "indexing_in_progress": ctrl.is_scanning,
        "active_scan_id": ctrl.active_job_id,
    }


@app.get("/api/mcp/folders/images")
async def mcp_list_folder_images(folder: str, limit: int = 20, offset: int = 0):
    policy = _require_mcp_policy()
    if not is_path_within_approved_roots(folder, policy["approved_roots"]):
        raise HTTPException(status_code=403, detail="Folder is not within user-approved library roots")
    real_folder = os.path.realpath(folder)
    clamped_limit = max(1, min(100, limit))
    images = controller().db.get_images_in_folder_paginated(
        real_folder,
        limit=clamped_limit,
        offset=max(0, offset),
    )
    status = "ok"
    action_required: str | None = None
    if not images:
        if not os.path.isdir(real_folder):
            status = "folder_unavailable"
            action_required = f"Folder '{real_folder}' is unavailable on disk. Tell the user to check the folder or drive."
        elif not await asyncio.to_thread(_folder_has_supported_files, real_folder):
            status = "empty_folder"
            action_required = (
                f"Approved folder '{real_folder}' contains no supported photos. "
                "Stop and tell the user to add photos or approve a different folder in SnapSort Settings."
            )
        elif policy["allow_agent_scan"]:
            status = "needs_scan"
            action_required = f"Folder '{real_folder}' has unindexed photos. Call scan_folder to index them."
        else:
            status = "needs_user_scan"
            action_required = (
                f"Folder '{real_folder}' has unindexed photos, and Agent Folder Scanning is disabled. "
                "Tell the user to scan the folder in SnapSort or enable 'Allow Agent Folder Scanning' in Settings."
            )
    return {
        "images": images,
        "folder": real_folder,
        "status": status,
        "action_required": action_required,
    }


@app.post("/api/mcp/scan")
async def mcp_scan_folder(req: McpScanRequest):
    policy = _require_mcp_policy()
    if not policy["allow_agent_scan"]:
        raise HTTPException(status_code=403, detail="Agent folder scanning is disabled in Settings")
    if not is_path_within_approved_roots(req.folder_path, policy["approved_roots"]):
        raise HTTPException(status_code=403, detail="Folder is not within user-approved library roots")

    real_folder = os.path.realpath(req.folder_path)
    if not os.path.exists(real_folder) or not os.path.isdir(real_folder):
        raise HTTPException(status_code=400, detail="Folder unavailable or drive not mounted")

    ctrl = controller()
    max_cap = policy["max_headless_scan_images"] if app.state.mode == "headless" else None
    job = await asyncio.to_thread(
        ctrl.enqueue_scan,
        real_folder,
        approved_roots=policy["approved_roots"],
        max_new_images=max_cap,
    )
    if job.get("error") and job.get("status") != "failed":
        raise HTTPException(status_code=400, detail=job["error"])

    if req.wait_seconds and req.wait_seconds > 0 and job.get("scan_id") and job.get("status") in ("queued", "indexing"):
        job = await asyncio.to_thread(ctrl.wait_for_job, job["scan_id"], req.wait_seconds) or job
    return job


@app.get("/api/mcp/preview")
async def mcp_preview(path: str, max_size: int = 1024):
    policy = _require_mcp_policy()
    if not policy["allow_previews"]:
        raise HTTPException(status_code=403, detail="Visual previews are disabled in Settings")

    now = time.monotonic()
    recent = [t for t in app.state.preview_timestamps if (now - t) < 60.0]
    if len(recent) >= 30:
        app.state.preview_timestamps = recent
        raise HTTPException(status_code=429, detail="Preview rate limit exceeded")
    recent.append(now)
    app.state.preview_timestamps = recent

    real_path = _resolve_indexed_path(path)
    if policy["approved_roots"] and not is_path_within_approved_roots(real_path, policy["approved_roots"]):
        raise HTTPException(status_code=403, detail="Image is outside approved library roots")

    size = max(64, min(1024, int(max_size)))
    try:
        cache_path = await asyncio.to_thread(generate_preview, real_path, size)
        if os.path.getsize(cache_path) > 2 * 1024 * 1024:
            cache_path = await asyncio.to_thread(generate_preview, real_path, min(512, size))
        return FileResponse(cache_path, media_type="image/jpeg")
    except Exception as exc:
        logger.error("MCP preview failed for %s: %s", real_path, exc)
        raise HTTPException(status_code=422, detail="Could not generate preview")


@app.get("/api/mcp/audit")
async def mcp_audit(limit: int = 50):
    return {"entries": read_audit_log(app.state.data_dir, limit=max(1, min(200, limit)))}


@app.post("/api/mcp/revoke")
async def mcp_revoke():
    """Stop headless backend or rotate token and remove runtime discovery file."""
    remove_runtime_info_if_matches(app.state.data_dir, app.state.instance_id)
    app.state.token = secrets.token_urlsafe(32)
    if app.state.mode == "headless" or not app.state.desktop_attached:
        srv = getattr(app.state, "uvicorn_server", None)
        if srv is not None:
            srv.should_exit = True
        return {"status": "stopping_headless"}
    return {"status": "revoked"}


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    try:
        multiprocessing.set_start_method("spawn")
    except RuntimeError:
        pass

    config = uvicorn.Config(app, host="127.0.0.1", port=BIND_PORT, reload=False, log_level="info")
    server = uvicorn.Server(config)
    app.state.uvicorn_server = server
    server.run()
