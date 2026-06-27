# SnapSort

SnapSort is a cross-platform desktop application for offline, AI-powered image sorting, semantic searching, and face tagging. Select a folder of photos and instantly browse thumbnails; in the background, SnapSort will detect faces, extract semantic text-to-image embeddings, build a searchable embedding index, and let you:

- Search for photos by typing descriptions (e.g., "tree in sunset", "group of people outdoors").
- Search for photos by typing a specific person's name (e.g., "Rahul hiking").
- Click any photo to see the faces it contains, and tag them with names.
- Click a face thumbnail to filter the gallery down to every image where that person appears.
- Hit “Back to All Images” to return to your full gallery.

Everything runs locally—no cloud uploads. SnapSort uses PyQt5 for the GUI, `onnxruntime` with OpenCV (YuNet + SFace + CLIP) for machine learning, SQLite for metadata, and Faiss for fast vector search.

> 📌 **Want to see what's coming next?** Check out the [todo.md](todo.md) for upcoming features, fixes, and improvements.

# Features

- Instant Thumbnail Gallery: Loads and displays all images in a selected folder immediately, with correct EXIF orientation handling.
- Background AI Processing: Uses multiprocessing to detect faces (YuNet), extract face embeddings (SFace), and compute semantic image embeddings (CLIP) without blocking the UI.
- Semantic Search & Name Recognition: Type what you're looking for, or type a tagged person's name to instantly find matching photos using advanced cosine-similarity FAISS search and fuzzy text matching.
- Interactive Viewer & Face Panel: Click an image to enlarge it. A side panel lists every face in that photo—click one to filter the gallery, or right click to assign a name/merge faces.
- Persistent Index & Metadata: Stores high-dimensional vector embeddings in Faiss (`faces.index`, `clip.index`) and records image/face occurrences in a local SQLite database (`faces.db`).
- CPU-Optimized & Lightweight: Uses highly optimized ONNX models that run incredibly fast on standard consumer CPUs, eliminating the need for bulky dependencies like PyTorch or dlib.
- Detailed Logging: Logs every stage (scanning, processing, indexing, UI events) to help diagnose performance or errors.

# Requirements

- Python ≥ 3.10
- Qt (PyQt5)
- Python Packages (see `requirements.txt`): `opencv-python-headless`, `onnxruntime`, `numpy`, `pillow`, `faiss-cpu`, `rapidfuzz`, `transformers` (for tokenization).

# Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/SnapSort.git
   cd SnapSort
   ```
2. Create a virtual environment:
   ```bash
   python3 -m venv env
   source env/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Download the AI models (YuNet, SFace, CLIP):
   ```bash
   python scripts/download_models.py
   ```

# Usage

Run the application:

```bash
python main.py
```

- Select Folder: Click “Select Folder” and choose any directory containing `.jpg`, `.png`, or `.jpeg` images.
- Browse Thumbnails: All photos appear instantly as 120×120 thumbnails. The app begins analyzing images in the background.
- Search: Type a description or a person's name in the top search bar and press Enter to find matching photos.
- View & Tag Faces: Click any thumbnail to enlarge it. The face panel on the right will list all detected faces. Right-click a face to assign a name.
- Filter by Person: Click a face thumbnail to filter the gallery to every image containing that person.
- Return to Full Gallery: Click **Back to All Images** to restore the complete thumbnail list.

# Configuration & Files

- `faces.db`: SQLite database storing image metadata, assigned names, and face occurrences.
- `faces.index`: Faiss index file for rapid face similarity matching.
- `clip.index`: Faiss index file for rapid semantic text-to-image matching.
- `models/`: Directory containing the downloaded ONNX models and tokenizers.
- Logging: Console output shows timestamps, module names, and INFO/DEBUG messages.

# Contributing

Contributions are welcome! To help:

1. Fork the repository.
2. Create a feature branch:
   ```bash
   git checkout -b my-cool-feature
   ```
3. Commit your changes and push:
   ```bash
   git commit -am "Add new feature"
   git push origin my-cool-feature
   ```
4. Open a Pull Request.

# License

This project is licensed under the MIT License. See the `LICENSE` file for details.
