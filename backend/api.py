from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import sys
import uvicorn

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

# NOW safe to import controller (triggers face_processing, clip_processor)
from controller import Controller

app = FastAPI(title="SnapSort API")

# Allow Electron frontend to access API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global controller instance
controller = Controller(num_workers=4, data_dir=os.path.abspath(DATA_DIR))

class ScanRequest(BaseModel):
    folder_path: str

@app.get("/api/status")
async def get_status():
    """Health check for Electron to verify backend is ready"""
    return {"status": "ok"}

@app.post("/api/scan")
async def start_scan(req: ScanRequest):
    """Start scanning a directory"""
    if not os.path.exists(req.folder_path) or not os.path.isdir(req.folder_path):
        raise HTTPException(status_code=400, detail="Invalid folder path")
        
    res = controller.scan_folder(req.folder_path)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res

@app.get("/api/progress")
async def get_progress():
    """Get current scanning progress"""
    return {
        "is_scanning": controller.is_scanning,
        "total_images": controller.total_images,
        "processed_images": controller.processed_images,
        "pending_tasks": controller.pending_tasks
    }

@app.get("/api/stats")
async def get_stats():
    """Get statistics for the sidebar"""
    return controller.db.get_stats()

@app.get("/api/images")
async def get_images(offset: int = 0, limit: int = 50):
    """Fetch paginated list of all images"""
    images = controller.db.get_all_images_paginated(offset, limit)
    return {"images": images}

@app.get("/api/images/faces")
async def get_faces_in_image(image_path: str):
    """Get all face IDs and names found in a specific image"""
    face_ids = controller.get_faces_in_image(image_path)
    result = []
    for fid in face_ids:
        name = controller.db.get_face_name(fid)
        result.append({"id": fid, "name": name})
    return {"faces": result}

@app.get("/api/faces")
async def get_faces():
    """Fetch all unique face clusters (for the People view)"""
    faces = controller.db.get_all_faces_with_counts()
    return {"faces": faces}

@app.get("/api/faces/{face_id}/images")
async def get_images_for_face(face_id: int):
    """Fetch all images containing a specific person"""
    images = controller.get_images_for_face(face_id)
    return {"images": images}

class RenameRequest(BaseModel):
    name: str

@app.put("/api/faces/{face_id}")
async def rename_face(face_id: int, req: RenameRequest):
    """Rename a face cluster"""
    controller.rename_face(face_id, req.name)
    return {"status": "ok"}

class MergeRequest(BaseModel):
    primary_id: int
    other_ids: list[int]

@app.post("/api/faces/merge")
async def merge_faces(req: MergeRequest):
    """Merge multiple face clusters together"""
    controller.merge_face_ids(req.primary_id, req.other_ids)
    return {"status": "ok"}

@app.get("/api/search")
async def search_images(q: str):
    """Semantic text and name search"""
    results = controller.search(q)
    return [{"path": path, "score": float(score)} for path, score in results]

# Endpoints to serve actual files
@app.get("/media/image")
async def serve_image(path: str):
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)

import asyncio
from PIL import Image, ImageOps
import io
from fastapi.responses import Response

def generate_preview(path: str, size: int):
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((size, size))
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=75)
        return buf.getvalue()

@app.get("/media/preview")
async def serve_preview(path: str, size: int = 400):
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Image not found")
    try:
        # Run CPU-bound PIL operation in a separate thread to unblock the event loop
        img_bytes = await asyncio.to_thread(generate_preview, path, size)
        return Response(content=img_bytes, media_type="image/jpeg")
    except Exception as e:
        return FileResponse(path)

@app.get("/media/thumbnail/{face_id}")
async def serve_thumbnail(face_id: int):
    """Serve the generated thumbnail for a face"""
    path = controller.db.get_face_thumbnail(face_id)
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(path)

if __name__ == "__main__":
    port = 8000
    if "--port" in sys.argv:
        port_idx = sys.argv.index("--port")
        if port_idx + 1 < len(sys.argv):
            port = int(sys.argv[port_idx + 1])
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
