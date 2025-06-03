# ✅ TODO: SnapSort

This document outlines upcoming features, improvements, and bug fixes for **SnapSort**, organized by priority for efficient tracking and development.

---

## 🔁 Version 2.0.0 Plan

### 🧠 Core Functionality

- [x] **Adding Human Feedback Loop to club same faces that are recognized as different**  
       A complete different window which contains all the faces and human can select the faces that are same.


---

## 🔁 Version 1.0.0 Plan

### 🧠 Core Functionality

- [x] **Display related images with shared faces**  
       When an image is selected, show all other images where the same people (faces) also appear together.  
       _Hint: Use the existing face-image mapping in the database to retrieve relevant results._

### Installers

- [x] **Create installers for Windows, Linux, and macOS**  
       Use `PyInstaller` or `Briefcase` to package the application for each platform.  
       _Hint: Ensure all dependencies are included in the installer._

---


## 🔴 High Priority

### 🔧 Critical Logic & Performance

- [x] **The images are not retrieved from DB but from a list that is in-memory.**

  - This is a temporary solution. The images should be retrieved from the database to ensure persistence and reliability.

- [x] **Prevent reprocessing of already indexed images**

  - Before processing, check if the image has already been analyzed using SQLite index.

- [ ] **Improve recognition accuracy and speed**

  - Replace or upgrade current face recognition model.
  - Consider GPU-accelerated libraries such as:
    - `insightface`
    - `onnxruntime`
    - `face_recognition` with CUDA

- [x] **Handle image orientation variations**

  - Detect and adjust for rotated or flipped faces during processing.

- [x] **Fix grid layout bug on image load**

  - Images currently render in a single column until the window is resized.
  - Manually trigger layout/UI updates after thumbnails are inserted.

- [ ] **Prevent crash on "Go Back to Gallery"**
  - Handle navigation cleanup correctly to avoid panel memory issues or thread errors.

---

## 🟡 Medium Priority

### 🎨 GUI / UX Improvements

- [x] **Improve overall GUI layout**

  - Consistent spacing, padding, and transitions.
  - Polished visual hierarchy for thumbnail views, detail panels, and navigation.

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

### 🧠 Functional Enhancements

- [ ] **Allow naming of recognized individuals**

  - Associate a human-readable name with each face ID via GUI input.

- [ ] **Add search functionality**

  - Allow searching images by person name or face ID.

- [ ] **Show face match confidence score**

  - Display the similarity score on hover or click for each matched face.

- [ ] **Add pagination or lazy-loading for large datasets**
  - Prevent UI freezes and optimize memory usage.

### 🚀 Deployment & CI/CD

- [x] **Add GitHub Action to build & deploy desktop app**
  - Use [PyInstaller](https://pyinstaller.org/) or [Briefcase](https://beeware.org/project/projects/tools/briefcase/) to package as a desktop app.
  - Auto-generate platform-specific installers (Windows, Linux, macOS).
  - Set up GitHub CI workflow for releases.

---

## 🔵 Low Priority

### 🧰 Code Quality & Architecture

- [ ] **Refactor to modular or MVC architecture**

  - Improve separation between GUI, logic, and data layers.

- [ ] **Add type hints and docstrings**

  - Improve readability and help with static analysis.

- [ ] **Add configuration file**
  - Use `config.json`, `.env`, or `.ini` for user-configurable settings:
    - Paths
    - Face match threshold
    - Cache size

### 🧪 Testing & DevOps

- [ ] **Add unit and integration tests**

  - Focus on face recognition logic, database integrity, and UI navigation.

- [ ] **Set up GitHub Actions for code quality**

  - Run `flake8`, `black`, and `pytest` automatically on push.

- [ ] **Maintain dependencies and requirements**
  - Keep `requirements.txt` or `pyproject.toml` up to date.

---

## ✨ Stretch Goals

- [ ] **Deploy to mobile (Android/iOS)**

  - Consider using Kivy, BeeWare, or React Native with embedded face models.

- [ ] **Cloud sync support**
  - Optional: Sync metadata or processed DB to a cloud backend for portability.

---
