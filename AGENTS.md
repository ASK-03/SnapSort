# AGENTS.md

SnapSort is a free, open-source AI-powered local photo manager. It uses on-device machine learning (CLIP for semantic search, YuNet + SFace for facial recognition) to index, categorize, and make an entire image library searchable without sending private data to the cloud. This file is the canonical guide for any AI coding agent working in this repo.

## Architecture

SnapSort uses a hybrid architecture:
1. **Frontend (Electron + React + TypeScript + Vite + Zustand + Tailwind CSS)**: Runs the desktop application UI.
2. **Backend (Python + FastAPI)**: Runs as a subprocess spawned by Electron. Handles all heavy ML processing, database interactions (SQLite), and vector indexing (FAISS).

## Setup commands

- Backend deps: `pip install -r requirements.txt`
- Frontend deps: `cd desktop && npm install`
- Start dev: `cd desktop && npm run dev` (Starts Vite, which starts Electron, which spawns the FastAPI backend automatically)
- Build: `cd desktop && npm run build` (Builds Electron app with electron-builder)

## Project layout

- `desktop/` — The Electron and React frontend application.
  - `desktop/src/` — React UI, store, API client to communicate with FastAPI.
  - `desktop/electron/` — Electron main process, spawns the Python backend.
- `backend/` — The Python backend handling ML, database, and search.
  - `backend/api.py` — FastAPI entrypoint.
  - `backend/db.py` — SQLite database interactions.
  - `backend/indexer.py` — FAISS vector database wrapper.
  - `backend/face_processing.py` — OpenCV DNN YuNet and SFace models.
  - `backend/clip_processor.py` — Xenova quantized ONNX CLIP models.
  - `backend/search_engine.py` — Semantic and hybrid search logic.
- `models/` — ONNX ML models downloaded by scripts.
- `resources/` — Generated thumbnails and icons.
- `data/` — Runtime artifacts: `faces.db` SQLite database, FAISS index files.
- `scripts/` — Helper scripts, e.g., `download_models.py`.

## Code style

- **Frontend**: TypeScript strict mode. React functional components with Tailwind CSS for styling. Zustand for state management.
- **Backend**: Python 3.12+. Use type hints. Keep processing offline and optimized for consumer hardware (CPU inference using ONNX).
- The repo explicitly avoids cloud dependencies. All ML models run locally using `onnxruntime` and `cv2`.

## Specialized notes

- **Port Management**: The Electron app dynamically allocates an open port and passes it to the Python backend via the `--port` argument to avoid conflicts.
- **Model Loading**: Models in `face_processing.py` and `clip_processor.py` expect the `models/` directory to exist two levels up or relative to the project root.
- **Thumbnail Generation**: Thumbnails are generated dynamically and saved to `resources/thumbnails/` to ensure the UI renders smoothly without reloading massive image files.
- **Multiprocessing**: The backend uses Python `multiprocessing.Pool` for image scanning. Models are initialized once per worker process to save RAM.
- **README tone**: The project is open-source, privacy-focused, and offline-first. Never add cloud telemetry, external logging, or paywalls.