# TODO: SnapSort

This document outlines upcoming features, improvements, and bug fixes for **SnapSort**, organized by priority for efficient tracking and development. Add new items under the relevant priority section below.

---

## High Priority

- [ ] **Fix selection ring clipped on top-row gallery images**
  - `Gallery.tsx`: react-virtuoso sets `style="padding-top: 0px"` inline on its `virtuoso-item-list` div, overriding the `pt-8` Tailwind class — row 0 sits flush against the scroller's clipped top edge, so the `ring-offset-2` selection ring gets cut off. Fix: use an inset ring (`ring-inset`) instead of `ring-offset`, so the indicator draws inside the card and isn't clipped.

- [ ] **Progress bar shows incorrect/stale progress**
  - Bottom progress bar does not reflect real scan progress.

- [ ] **Browse by processed folder**
  - Sidebar view listing scanned folders; clicking one shows only its images; show per-folder processed percentage.
  
- [ ] **Add re-process button**
  - To re-process images that do not detect faces but have them; user can re-run the detection process.
  
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

- [ ] **Show face name in search filter instead of `face:id`**
  - `TopBar.tsx` displays the raw `face:<id>` query; show the face's name when set, falling back to `face:<id>`.

- [ ] **Allow reassigning a single wrong face detection**
  - Current rename/merge (`Faces.tsx`, `ImageDetails.tsx`) only relabels or merges whole clusters. Need to move one wrongly-clustered occurrence to the correct person: new backend endpoint to reassign `occurrences.face_id` for a single occurrence, plus UI to pick the target person.

### Functional Enhancements

- [ ] **Show face match confidence score**
  - Display the similarity score on hover or click for each matched face.

- [ ] **Add support for videos**
  - Extend scanning and indexing logic to extract frames from videos for facial recognition and semantic search. Sample keyframes at a fixed interval and reuse the existing face/CLIP pipeline; store a frame timestamp per detection.

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

### Community & Governance

- [ ] **Add CONTRIBUTING.md**
  - Document setup, branch/PR conventions, and issue-labeling for new contributors.

- [ ] **Add CODE_OF_CONDUCT.md**
  - Standard contributor covenant for the repository.

### Testing & DevOps

- [ ] **Add unit and regression test cases**
  - Start with a regression test for the path-validation fix (`a24e07b`), then wire `pytest` into CI and grow coverage incrementally for backend (FastAPI) and frontend (React/Zustand).

- [ ] **Set up GitHub Actions for code quality**
  - Run `flake8`, `black`, and `pytest` automatically on push.

- [ ] **Maintain dependencies and requirements**
  - Keep `requirements.txt` or `pyproject.toml` up to date.

- [ ] **Consolidate Python environments**
  - Replace the scattered `env/`, `.venv/`, `backend/.venv/` with a single `pyproject.toml` and one documented setup command.

- [ ] **Clean up repository history/objects**
  - Run `git gc` to compact loose objects; repo currently holds ~250MB of unpacked git data.

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
- [x] Support more image formats (WebP, BMP, TIFF, GIF, HEIC/HEIF)

---
