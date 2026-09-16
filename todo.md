# TODO: SnapSort

This document outlines upcoming features, improvements, and bug fixes for **SnapSort**, organized by priority for efficient tracking and development. Add new items under the relevant priority section below.

---

## High Priority

_(none open)_

---

## Medium Priority

### GUI / UX Improvements

- [ ] **Add image interaction options**

  - Right-click or hover options for:
    - Delete image
    - Reprocess face data
    - Rename or tag
    - Mark as favorite

- [ ] **Add loading/progress indicators**

  - Show when thumbnails or face data are being generated in the background.

- [ ] **Enable image zoom/preview**

  - Click on image to view full-screen or high-res version.

- [ ] **Toast notifications or status bar**
  - For background events like face matching, DB updates, or errors.

### Functional Enhancements

- [ ] **Show face match confidence score**
  - Display the similarity score on hover or click for each matched face.

- [ ] **Add support for videos**
  - Extend scanning and indexing logic to extract frames from videos for facial recognition and semantic search.

- [ ] **Support more image formats**
  - Scanning is currently hardcoded to `.jpg`/`.jpeg`/`.png` (`controller.py::scan_folder`). Extend to HEIC, WebP, TIFF, etc.

---

## Low Priority

### Code Quality & Architecture

- [ ] **Refactor to modular or MVC architecture**

  - Improve separation between GUI, logic, and data layers.

- [ ] **Add type hints and docstrings**

  - Improve readability and help with static analysis.

- [ ] **Add configuration file**
  - Use `config.json`, `.env`, or `.ini` for user-configurable settings:
    - Paths
    - Face match threshold
    - Cache size

### Testing & DevOps

- [ ] **Add unit and regression test cases**
  - Implement comprehensive tests for the backend (FastAPI) and frontend (React/Zustand) to prevent regressions.

- [ ] **Set up GitHub Actions for code quality**
  - Run `flake8`, `black`, and `pytest` automatically on push.

- [ ] **Maintain dependencies and requirements**
  - Keep `requirements.txt` or `pyproject.toml` up to date.

---

## Stretch Goals

- [ ] **Deploy to mobile (Android/iOS)**
  - Consider using Kivy, BeeWare, or React Native with embedded face models.

- [ ] **Cloud sync support**
  - Optional: Sync metadata or processed DB to a cloud backend for portability.

---

## Completed

- [x] Human feedback loop to merge duplicate face clusters
- [x] Show related images with shared faces
- [x] Installers for Windows, Linux, and macOS
- [x] Fix arbitrary file read via `/media/image` and `/media/preview`
- [x] Retrieve image list from DB instead of in-memory list
- [x] Skip reprocessing of already-indexed images
- [x] Improve recognition accuracy and speed
- [x] Handle image orientation variations
- [x] Fix grid layout bug on image load
- [x] Prevent crash on "Go Back to Gallery"
- [x] Improve overall GUI layout
- [x] Allow naming of recognized individuals
- [x] Add search functionality
- [x] Add pagination / lazy-loading for large datasets (virtualized gallery grid + disk-cached previews)
- [x] GitHub Action to build & deploy desktop app

---
