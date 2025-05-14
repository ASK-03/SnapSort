# SnapSort

SnapSort is a cross-platform desktop application for offline, face-based image sorting and viewing. Select a folder of photos and instantly browse thumbnails; in the background, SnapSort will detect faces, build a searchable embedding index, and let you:

- Click any photo to see the faces it contains.
- Click a face thumbnail to filter the gallery down to every image where that person appears.
- Hit “Back to All Images” to return to your full gallery.

Everything runs locally—no cloud uploads. SnapSort uses PyQt5 for the GUI, Python + `face_recognition` (dlib/CUDA) for ML, SQLite for metadata, and Faiss for fast vector search.

> 📌 **Want to see what's coming next?** Check out the [TODO.md](TODO.md) for upcoming features, fixes, and improvements.

# Features

- Instant Thumbnail Gallery: Loads and displays all images in a selected folder immediately.
- Background Face Processing: Uses multiprocessing (or GPU-accelerated CNN) to detect faces and compute embeddings without blocking the UI.
- Interactive Viewer & Face Panel: Click an image to enlarge it. A side panel lists every face in that photo—click one to filter the gallery.
- Back Navigation: A “Back to All Images” button returns you from the filtered view to the full gallery.
- Persistent Index & Metadata: Stores embeddings in Faiss (`faces.index`) and records image/face occurrences in a local SQLite database (`faces.db`).
- GPU-Ready: Supports GPU inference via `face_recognition`’s CNN model (requires dlib built with CUDA) or PyTorch-based models.
- Detailed Logging: Logs every stage (scanning, processing, indexing, UI events) to help diagnose performance or errors.

# Requirements

- Python ≥ 3.8
- Qt (PyQt5)
- Python Packages (see `requirements.txt`): `opencv-python`, `face_recognition`, `face_recognition_models`, `numpy`, `pillow`, `faiss-cpu` or `faiss-gpu`
- Optional (GPU): A CUDA-enabled GPU and dlib compiled with CUDA, or GPU-enabled PyTorch.

# Installation

1. Clone the repository:
   ```
   git clone https://github.com/your-username/SnapSort.git
   cd SnapSort
   ```
2. Create a virtual environment:
   ```
   python3 -m venv env
   source env/bin/activate
   ```
3. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
4. (GPU only) Build and install dlib with CUDA support, or install GPU-enabled PyTorch:
   ```
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
   ```

# Usage

Run the application:

```
python main.py
```

- Select Folder: Click “Select Folder” and choose any directory containing `.jpg`, `.png`, or `.jpeg` images.
- Browse Thumbnails: All photos appear instantly as 120×120 thumbnails. The app begins detecting faces in the background.
- View Faces in an Image: Click any thumbnail to enlarge it. The face panel on the right will list all detected faces in that photo.
- Filter by Person: Click a face thumbnail to filter the gallery to every image containing that person. The “Back to All Images” button appears above the gallery.
- Return to Full Gallery: Click **Back to All Images** to restore the complete thumbnail list.

# Configuration & Files

- `faces.db`: SQLite database storing image metadata and face occurrences.
- `faces.index`: Faiss index file that holds all face embeddings; grows as you process new images.
- `resources/thumbnails/`: Auto-generated directory of face-crop thumbnails for the GUI.
- Logging: Console output shows timestamps, module names, and INFO/DEBUG messages.

# Contributing

Contributions are welcome! To help:

1. Fork the repository.
2. Create a feature branch:
   ```
   git checkout -b my-cool-feature
   ```
3. Commit your changes and push:
   ```
   git commit -am "Add new feature"
   git push origin my-cool-feature
   ```
4. Open a Pull Request.

# License

This project is licensed under the MIT License. See the `LICENSE` file for details.
