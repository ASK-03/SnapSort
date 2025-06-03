import logging
import os
import json
import subprocess
from PyQt5.QtWidgets import (
    QApplication,
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QPushButton,
    QFileDialog,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QSplitter,
    QMenu,
    QProgressBar,
    QAction,
    QActionGroup,
    QMenuBar,
    QStatusBar,
)
from PyQt5.QtCore import Qt, QSize, QTimer, QThreadPool, QRunnable, QPoint
from PyQt5.QtGui import QPixmap, QIcon, QPalette, QColor, QFont
from PIL import Image
import hashlib
import sys

logger = logging.getLogger(__name__)

# Define dark and light styles, including menu bar and status bar
DARK_STYLESHEET = """
    QMainWindow { background-color: #2D2D2D; }
    QMenuBar { background-color: #2D2D2D; color: #FFFFFF; }
    QMenuBar::item { background-color: #2D2D2D; color: #FFFFFF; padding: 4px 10px; }
    QMenuBar::item:selected { background-color: #383838; }
    QMenu { background-color: #2D2D2D; color: #FFFFFF; border: 1px solid #5A5A5A; }
    QMenu::item:selected { background-color: #6464FA; }
    QPushButton {
        background-color: #5A5A5A;
        border: none;
        padding: 8px 12px;
        border-radius: 5px;
        color: #FFFFFF;
    }
    QPushButton:hover {
        background-color: #6E6E6E;
    }
    QListWidget {
        background-color: #383838;
        border: none;
        padding: 5px;
        color: #FFFFFF;
    }
    QListWidget::item { margin: 5px; }
    QProgressBar {
        background-color: #2D2D2D;
        border: 1px solid #5A5A5A;
        border-radius: 5px;
        text-align: center;
        color: #FFFFFF;
    }
    QProgressBar::chunk { background-color: #6464FA; border-radius: 5px; }
    QLabel { color: #FFFFFF; }
    QStatusBar { background-color: #2D2D2D; color: #FFFFFF; }
    QSplitter::handle { background-color: #2D2D2D; }
"""

LIGHT_STYLESHEET = """
    QMainWindow { background-color: #F0F0F0; }
    QMenuBar { background-color: #F0F0F0; color: #000000; }
    QMenuBar::item { background-color: #F0F0F0; color: #000000; padding: 4px 10px; }
    QMenuBar::item:selected { background-color: #E0E0E0; }
    QMenu { background-color: #FFFFFF; color: #000000; border: 1px solid #CCCCCC; }
    QMenu::item:selected { background-color: #3465A4; color: #FFFFFF; }
    QPushButton {
        background-color: #FFFFFF;
        border: 1px solid #CCCCCC;
        padding: 8px 12px;
        border-radius: 5px;
        color: #000000;
    }
    QPushButton:hover { background-color: #E5E5E5; }
    QListWidget {
        background-color: #FFFFFF;
        border: 1px solid #CCCCCC;
        padding: 5px;
        color: #000000;
    }
    QListWidget::item { margin: 5px; }
    QProgressBar {
        background-color: #FFFFFF;
        border: 1px solid #CCCCCC;
        border-radius: 5px;
        text-align: center;
        color: #000000;
    }
    QProgressBar::chunk { background-color: #3465A4; border-radius: 5px; }
    QLabel { color: #000000; }
    QStatusBar { background-color: #F0F0F0; color: #000000; }
    QSplitter::handle { background-color: #F0F0F0; }
"""


class ThumbnailLoader(QRunnable):
    def __init__(self, image_path, thumb_path, callback, failed_images):
        super().__init__()
        self.image_path = image_path
        self.thumb_path = thumb_path
        self.callback = callback
        self.failed_images = failed_images

    def run(self):
        try:
            logger.debug("Generating thumbnail for %s", self.image_path)
            if (
                not os.path.exists(self.image_path)
                or not os.access(self.image_path, os.R_OK)
                or os.stat(self.image_path).st_size == 0
            ):
                self.failed_images.add(self.image_path)
                self.callback(self.image_path, None)
                return
            if not os.path.exists(self.thumb_path):
                img = Image.open(self.image_path).convert("RGB")
                img.thumbnail((100, 100), Image.Resampling.LANCZOS)
                img.save(self.thumb_path, "JPEG", quality=85)
                img.close()
            pix = QPixmap(self.thumb_path)
            if pix.isNull():
                self.failed_images.add(self.image_path)
                self.callback(self.image_path, None)
                return
            self.callback(self.image_path, pix)
            logger.debug("Thumbnail loaded for %s", self.image_path)
        except Exception as e:
            logger.error("Error generating thumbnail for %s: %s", self.image_path, e)
            self.failed_images.add(self.image_path)
            self.callback(self.image_path, None)


class MainWindow(QMainWindow):
    def __init__(self, controller):
        super().__init__()
        self.controller = controller
        self.controller.model = "hog"
        self.all_image_paths = []
        self.in_filtered_view = False
        self.failed_images = set()
        self.thumbnail_dir = os.path.join(os.path.dirname(__file__), "thumbnails")
        os.makedirs(self.thumbnail_dir, exist_ok=True)
        self.threadpool = QThreadPool()
        self.threadpool.setMaxThreadCount(2)

        # Connect signals
        self.controller.folder_scanned.connect(self.show_thumbnails)
        self.controller.faces_ready.connect(self.display_faces_in_image)
        self.controller.images_with_all_faces_ready.connect(
            self.display_images_with_all_faces
        )
        self.controller.face_images_ready.connect(self.show_images_for_face)
        self.init_ui()
        logger.info("GUI initialized")
        self.load_settings()

        # At startup, default to dark theme
        self.apply_dark_theme()

    def init_ui(self):
        self.setWindowTitle("SnapSort")
        self.setGeometry(100, 100, 1000, 700)

        # Global font
        font = QFont("Segoe UI", 10)
        self.setFont(font)

        # Menu bar
        menubar = self.menuBar()
        # Model option
        opt_menu = menubar.addMenu("Options")
        self.model_action = QAction("Use CNN model", self)
        self.model_action.setCheckable(True)
        self.model_action.triggered.connect(self.toggle_model)
        opt_menu.addAction(self.model_action)

        # Theme menu
        theme_menu = menubar.addMenu("Theme")
        self.action_dark = QAction("Dark Mode", self, checkable=True)
        self.action_light = QAction("Light Mode", self, checkable=True)
        group = QActionGroup(self)
        group.setExclusive(True)
        for act in (self.action_dark, self.action_light):
            group.addAction(act)
            theme_menu.addAction(act)
        self.action_dark.triggered.connect(self.apply_dark_theme)
        self.action_light.triggered.connect(self.apply_light_theme)
        self.action_dark.setChecked(True)

        # Main splitter
        main_split = QSplitter(Qt.Horizontal)
        main_split.setHandleWidth(5)

        # Left pane: folder selector + gallery
        left_widget = QWidget()
        left_layout = QVBoxLayout(left_widget)
        left_layout.setContentsMargins(10, 10, 10, 10)
        left_layout.setSpacing(10)

        self.btn_select = QPushButton("Select Folder")
        self.btn_select.clicked.connect(self.select_folder)
        left_layout.addWidget(self.btn_select)

        self.btn_back = QPushButton("Back to All Images")
        self.btn_back.clicked.connect(self.back_to_gallery)
        self.btn_back.hide()
        left_layout.addWidget(self.btn_back)

        self.gallery_list = QListWidget()
        self.gallery_list.setViewMode(QListWidget.IconMode)
        self.gallery_list.setIconSize(QSize(100, 100))
        self.gallery_list.setResizeMode(QListWidget.Adjust)
        self.gallery_list.setFlow(QListWidget.LeftToRight)  # force flow
        self.gallery_list.setWrapping(True)  # enable wrapping immediately
        self.gallery_list.setGridSize(QSize(110, 110))  # ensure uniform grid spacing
        self.gallery_list.itemClicked.connect(self.on_image_clicked)
        self.gallery_list.setMinimumWidth(550)
        self.gallery_list.setContextMenuPolicy(Qt.CustomContextMenu)
        self.gallery_list.customContextMenuRequested.connect(self.open_context_menu)
        left_layout.addWidget(self.gallery_list)
        main_split.addWidget(left_widget)

        # Right pane: image viewer + face list + matching images
        right_split = QSplitter(Qt.Vertical)
        right_split.setHandleWidth(5)
        right_split.setContentsMargins(10, 10, 10, 10)

        self.viewer_label = QLabel("Select an image")
        self.viewer_label.setAlignment(Qt.AlignCenter)
        self.viewer_label.setStyleSheet(
            "border: 1px solid;"
        )  # border color follows theme
        right_split.addWidget(self.viewer_label)

        self.face_list = QListWidget()
        self.face_list.setViewMode(QListWidget.IconMode)
        self.face_list.setIconSize(QSize(80, 80))
        self.face_list.setFlow(QListWidget.LeftToRight)
        self.face_list.setWrapping(True)
        self.face_list.setGridSize(QSize(90, 90))
        self.face_list.itemClicked.connect(self.on_face_clicked)
        right_split.addWidget(self.face_list)

        self.matching_list = QListWidget()
        self.matching_list.setViewMode(QListWidget.IconMode)
        self.matching_list.setIconSize(QSize(100, 100))
        self.matching_list.setWrapping(True)
        self.matching_list.setGridSize(QSize(110, 110))
        self.matching_list.setMinimumHeight(150)
        self.matching_list.itemClicked.connect(self.on_image_clicked)
        right_split.addWidget(self.matching_list)

        main_split.addWidget(right_split)
        self.setCentralWidget(main_split)

        # Status & progress
        self.statusBar = QStatusBar()
        self.setStatusBar(self.statusBar)
        self.progress = QProgressBar()
        self.statusBar.addPermanentWidget(self.progress)
        self.gallery_list.verticalScrollBar().valueChanged.connect(
            self._load_visible_thumbnails
        )
        QTimer.singleShot(100, self._load_visible_thumbnails)

    def apply_light_theme(self):
        app = QApplication.instance()
        app.setStyle("Fusion")
        palette = QPalette()
        palette.setColor(QPalette.Window, QColor("#F0F0F0"))
        palette.setColor(QPalette.WindowText, Qt.black)
        palette.setColor(QPalette.Base, QColor("#FFFFFF"))
        palette.setColor(QPalette.AlternateBase, QColor("#F0F0F0"))
        palette.setColor(QPalette.ToolTipBase, Qt.black)
        palette.setColor(QPalette.ToolTipText, Qt.black)
        palette.setColor(QPalette.Text, Qt.black)
        palette.setColor(QPalette.Button, QColor("#FFFFFF"))
        palette.setColor(QPalette.ButtonText, Qt.black)
        palette.setColor(QPalette.Highlight, QColor("#3465A4"))
        palette.setColor(QPalette.HighlightedText, Qt.white)
        app.setPalette(palette)
        app.setStyleSheet(LIGHT_STYLESHEET)
        self.action_light.setChecked(True)

    def apply_dark_theme(self):
        app = QApplication.instance()
        app.setStyle("Fusion")
        palette = QPalette()
        palette.setColor(QPalette.Window, QColor(45, 45, 45))
        palette.setColor(QPalette.WindowText, Qt.white)
        palette.setColor(QPalette.Base, QColor(38, 38, 38))
        palette.setColor(QPalette.AlternateBase, QColor(45, 45, 45))
        palette.setColor(QPalette.ToolTipBase, Qt.white)
        palette.setColor(QPalette.ToolTipText, Qt.white)
        palette.setColor(QPalette.Text, Qt.white)
        palette.setColor(QPalette.Button, QColor(60, 60, 60))
        palette.setColor(QPalette.ButtonText, Qt.white)
        palette.setColor(QPalette.Highlight, QColor(100, 100, 250))
        palette.setColor(QPalette.HighlightedText, Qt.black)
        app.setPalette(palette)
        app.setStyleSheet(DARK_STYLESHEET)
        self.action_dark.setChecked(True)

    def load_settings(self):
        try:
            with open("settings.json") as f:
                data = json.load(f)
                last = data.get("last_folder")
                if last and os.path.isdir(last):
                    self.select_folder(last)
        except Exception:
            pass

    def save_settings(self, folder):
        with open("settings.json", "w") as f:
            json.dump({"last_folder": folder}, f)

    def toggle_model(self):
        self.controller.model = "cnn" if self.model_action.isChecked() else "hog"

    def open_context_menu(self, pos: QPoint):
        item = self.gallery_list.itemAt(pos)
        if not item:
            return
        path = item.data(Qt.UserRole)
        menu = QMenu()
        rot = menu.addAction("Rotate 90°")
        open_file = menu.addAction("Open in Explorer")
        action = menu.exec_(self.gallery_list.mapToGlobal(pos))
        if action == rot:
            try:
                img = Image.open(path)
                img = img.rotate(90, expand=True)
                img.save(path)
                thumb = self.get_thumbnail_path(path)
                if os.path.exists(thumb):
                    os.remove(thumb)
                self._load_visible_thumbnails()
            except Exception as e:
                logger.error("Rotate failed: %s", e)
        elif action == open_file:
            if os.name == "nt":
                os.startfile(os.path.dirname(path))
            elif sys.platform == "darwin":
                subprocess.call(["open", os.path.dirname(path)])
            else:
                subprocess.call(["xdg-open", os.path.dirname(path)])

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Image Folder")
        if folder:
            logger.info("Folder selected: %s", folder)
            self.clear_gallery()
            self.controller.scan_folder(folder)

    def show_thumbnails(self, image_paths):
        logger.info("Preparing %d thumbnails for lazy loading", len(image_paths))
        self.clear_gallery()
        self.all_image_paths = image_paths
        self.in_filtered_view = False
        self.btn_back.hide()

        for path in image_paths:
            if not os.path.exists(path) or not os.access(path, os.R_OK):
                self.failed_images.add(path)
                continue
            item = QListWidgetItem()
            item.setData(Qt.UserRole, path)
            item.setIcon(QIcon("placeholder.png"))
            self.gallery_list.addItem(item)
        logger.debug("Added %d items to gallery_list", self.gallery_list.count())

        QTimer.singleShot(0, self._load_visible_thumbnails)
        QTimer.singleShot(50, self.gallery_list.repaint)

    def _load_visible_thumbnails(self):
        logger.debug("Checking for visible thumbnails")
        first_visible = self.gallery_list.indexAt(
            self.gallery_list.rect().topLeft()
        ).row()
        last_visible = self.gallery_list.indexAt(
            self.gallery_list.rect().bottomRight()
        ).row()
        if first_visible < 0:
            first_visible = 0
        if last_visible < 0:
            last_visible = self.gallery_list.count() - 1

        for row in range(
            max(0, first_visible - 10),
            min(self.gallery_list.count(), last_visible + 10),
        ):
            item = self.gallery_list.item(row)
            path = item.data(Qt.UserRole)
            if path in self.failed_images:
                item.setIcon(QIcon("broken.png"))
                continue
            if item.icon().isNull() or item.icon().pixmap(QSize(100, 100)).isNull():
                thumb_path = self.get_thumbnail_path(path)
                loader = ThumbnailLoader(
                    path, thumb_path, self._thumbnail_loaded, self.failed_images
                )
                self.threadpool.start(loader)

    def _thumbnail_loaded(self, image_path, pixmap):
        for row in range(self.gallery_list.count()):
            item = self.gallery_list.item(row)
            if item and item.data(Qt.UserRole) == image_path:
                if pixmap is None:
                    item.setIcon(QIcon("broken.png"))
                else:
                    item.setIcon(QIcon(pixmap))
                break
        logger.debug("Updated thumbnail for %s", image_path)
        QTimer.singleShot(0, self.gallery_list.repaint)

    def get_thumbnail_path(self, image_path):
        hash_val = hashlib.md5(image_path.encode()).hexdigest()
        return os.path.join(self.thumbnail_dir, f"{hash_val}.jpg")

    def on_image_clicked(self, item):
        path = item.data(Qt.UserRole)
        logger.info("Image clicked: %s", path)
        try:
            pix = QPixmap(path).scaled(500, 500, Qt.KeepAspectRatio)
            if pix.isNull():
                logger.warning("Failed to load image for display: %s", path)
                self.viewer_label.setText("Failed to load image")
                return
            self.viewer_label.setPixmap(pix)
            self.face_list.clear()
            self.matching_list.clear()
            self.controller.request_faces_in_image(path)
            self.controller.request_images_with_all_faces(path)
        except Exception as e:
            logger.error("Error displaying image %s: %s", path, e)
            self.viewer_label.setText("Error loading image")

    def display_faces_in_image(self, image_faces):
        if not image_faces:
            logger.info("No faces found in image")
            self.face_list.clear()
            return

        for path, face_ids in image_faces.items():
            logger.info("Displaying %d faces for %s", len(face_ids), path)
            self.face_list.clear()
            for fid in face_ids:
                thumb = self.controller.db.get_face_thumbnail(fid)
                pix = QPixmap(thumb)
                if pix.isNull():
                    logger.warning("Failed to load face thumbnail for face ID %s", fid)
                    continue
                pix = pix.scaled(80, 80, Qt.KeepAspectRatio)
                item = QListWidgetItem()
                item.setIcon(QIcon(pix))
                item.setData(Qt.UserRole, fid)
                self.face_list.addItem(item)
            QTimer.singleShot(0, self.face_list.repaint)

    def display_images_with_all_faces(self, image_paths):
        if not image_paths:
            logger.info("No images with all faces found")
            self.matching_list.clear()
            return

        self.matching_list.clear()
        for path in image_paths:
            if not os.path.exists(path) or not os.access(path, os.R_OK):
                continue
            thumb = self.get_thumbnail_path(path)
            if not os.path.exists(thumb):
                img = Image.open(path).convert("RGB")
                img.thumbnail((80, 80), Image.Resampling.LANCZOS)
                img.save(thumb, "JPEG", quality=85)
                img.close()
            pix = QPixmap(thumb)
            it = QListWidgetItem()
            it.setIcon(QIcon(pix))
            it.setData(Qt.UserRole, path)
            self.matching_list.addItem(it)

    def on_face_clicked(self, item):
        fid = item.data(Qt.UserRole)
        logger.info("Face clicked: %s", fid)
        self.controller.request_images_for_face(fid)

    def show_images_for_face(self, face_id, paths):
        logger.info("Showing %d images for face %s: %s", len(paths), face_id, paths)
        self.clear_gallery()
        self.in_filtered_view = True
        self.btn_back.show()
        for path in paths:
            if not os.path.exists(path) or not os.access(path, os.R_OK):
                self.failed_images.add(path)
                continue
            item = QListWidgetItem()
            item.setData(Qt.UserRole, path)
            item.setIcon(QIcon("placeholder.png"))
            self.gallery_list.addItem(item)
        logger.debug(
            "Added %d items to gallery_list for face %s",
            self.gallery_list.count(),
            face_id,
        )
        QTimer.singleShot(0, self._load_visible_thumbnails)
        QTimer.singleShot(50, self.gallery_list.repaint)

    def back_to_gallery(self):
        logger.info("Returning to full gallery")
        self.show_thumbnails(self.all_image_paths)

    def clear_gallery(self):
        self.gallery_list.clear()
        self.failed_images.clear()
        logger.debug("Gallery cleared")
