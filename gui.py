import logging
import os
from PyQt5.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QPushButton,
    QFileDialog, QLabel, QListWidget,
    QListWidgetItem, QSplitter
)
from PyQt5.QtCore import Qt, QSize, QTimer, QThreadPool, QRunnable
from PyQt5.QtGui import QPixmap, QIcon
from PIL import Image
import hashlib

logger = logging.getLogger(__name__)

class ThumbnailLoader(QRunnable):
    def __init__(self, image_path, thumb_path, callback, failed_images):
        super().__init__()
        self.image_path = image_path
        self.thumb_path = thumb_path
        self.callback = callback
        self.failed_images = failed_images

    def run(self):
        try:
            logger.debug('Generating thumbnail for %s', self.image_path)
            if not os.path.exists(self.image_path):
                logger.warning('Image file does not exist: %s', self.image_path)
                self.failed_images.add(self.image_path)
                self.callback(self.image_path, None)
                return
            if not os.access(self.image_path, os.R_OK):
                logger.warning('No read permission for %s', self.image_path)
                self.failed_images.add(self.image_path)
                self.callback(self.image_path, None)
                return
            stat = os.stat(self.image_path)
            if stat.st_size == 0:
                logger.warning('Image file is empty: %s', self.image_path)
                self.failed_images.add(self.image_path)
                self.callback(self.image_path, None)
                return
            if not os.path.exists(self.thumb_path):
                img = Image.open(self.image_path).convert('RGB')
                img.thumbnail((100, 100), Image.Resampling.LANCZOS)
                img.save(self.thumb_path, 'JPEG', quality=85)
                img.close()
            pix = QPixmap(self.thumb_path)
            if pix.isNull():
                logger.warning('Failed to load thumbnail for %s', self.image_path)
                self.failed_images.add(self.image_path)
                self.callback(self.image_path, None)
                return
            self.callback(self.image_path, pix)
            logger.debug('Thumbnail loaded for %s', self.image_path)
        except Exception as e:
            logger.error('Error generating thumbnail for %s: %s', self.image_path, e)
            self.failed_images.add(self.image_path)
            self.callback(self.image_path, None)

class MainWindow(QMainWindow):
    def __init__(self, controller):
        super().__init__()
        self.controller = controller
        self.all_image_paths = []
        self.in_filtered_view = False
        self.failed_images = set()
        self.thumbnail_dir = os.path.join(os.path.dirname(__file__), 'thumbnails')
        os.makedirs(self.thumbnail_dir, exist_ok=True)
        self.threadpool = QThreadPool()
        self.threadpool.setMaxThreadCount(2)
        # Connect signals
        self.controller.folder_scanned.connect(self.show_thumbnails)
        self.controller.faces_ready.connect(self.display_faces_in_image)
        self.controller.face_images_ready.connect(self.show_images_for_face)
        self.init_ui()
        logger.info('GUI initialized')

    def init_ui(self):
        self.setWindowTitle('SnapSort')
        self.setGeometry(100, 100, 1000, 700)
        splitter = QSplitter(Qt.Horizontal)

        # Left pane: folder selector + gallery
        left_widget = QWidget()
        left_layout = QVBoxLayout(left_widget)
        self.btn_select = QPushButton('Select Folder')
        self.btn_select.clicked.connect(self.select_folder)
        left_layout.addWidget(self.btn_select)

        self.btn_back = QPushButton('Back to All Images')
        self.btn_back.clicked.connect(self.back_to_gallery)
        self.btn_back.hide()
        left_layout.addWidget(self.btn_back)

        self.gallery_list = QListWidget()
        self.gallery_list.setViewMode(QListWidget.IconMode)
        self.gallery_list.setIconSize(QSize(100, 100))
        self.gallery_list.setResizeMode(QListWidget.Adjust)
        self.gallery_list.itemClicked.connect(self.on_image_clicked)
        self.gallery_list.setMinimumWidth(550)
        left_layout.addWidget(self.gallery_list)
        splitter.addWidget(left_widget)

        # Right pane: image viewer + face list
        right_split = QSplitter(Qt.Vertical)
        self.viewer_label = QLabel('Select an image')
        self.viewer_label.setAlignment(Qt.AlignCenter)
        right_split.addWidget(self.viewer_label)
        self.face_list = QListWidget()
        self.face_list.setViewMode(QListWidget.IconMode)
        self.face_list.setIconSize(QSize(80, 80))
        self.face_list.itemClicked.connect(self.on_face_clicked)
        right_split.addWidget(self.face_list)
        splitter.addWidget(right_split)

        self.setCentralWidget(splitter)

        # Load visible thumbnails when scrolling
        self.gallery_list.verticalScrollBar().valueChanged.connect(self._load_visible_thumbnails)

        # Schedule initial load
        QTimer.singleShot(100, self._load_visible_thumbnails)

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, 'Select Image Folder')
        if folder:
            logger.info('Folder selected: %s', folder)
            self.clear_gallery()
            self.controller.scan_folder(folder)

    def show_thumbnails(self, image_paths):
        logger.info('Preparing %d thumbnails for lazy loading', len(image_paths))
        self.clear_gallery()
        self.all_image_paths = image_paths
        self.in_filtered_view = False
        self.btn_back.hide()

        for path in image_paths:
            if not os.path.exists(path):
                logger.warning('Image does not exist: %s', path)
                self.failed_images.add(path)
                continue
            if not os.access(path, os.R_OK):
                logger.warning('No read permission for %s', path)
                self.failed_images.add(path)
                continue
            item = QListWidgetItem()
            item.setData(Qt.UserRole, path)
            item.setIcon(QIcon('placeholder.png'))
            self.gallery_list.addItem(item)
        logger.debug('Added %d items to gallery_list', self.gallery_list.count())

        # Schedule thumbnail loading and repaint
        QTimer.singleShot(0, self._load_visible_thumbnails)
        QTimer.singleShot(50, self.gallery_list.repaint)

    def _load_visible_thumbnails(self):
        logger.debug('Checking for visible thumbnails')
        first_visible = self.gallery_list.indexAt(self.gallery_list.rect().topLeft()).row()
        last_visible = self.gallery_list.indexAt(self.gallery_list.rect().bottomRight()).row()
        if first_visible < 0:
            first_visible = 0
        if last_visible < 0:
            last_visible = self.gallery_list.count() - 1

        for row in range(max(0, first_visible - 10), min(self.gallery_list.count(), last_visible + 10)):
            item = self.gallery_list.item(row)
            path = item.data(Qt.UserRole)
            if path in self.failed_images:
                item.setIcon(QIcon('broken.png'))
                continue
            if item.icon().isNull() or item.icon().pixmap(QSize(100, 100)).isNull():
                thumb_path = self.get_thumbnail_path(path)
                loader = ThumbnailLoader(path, thumb_path, self._thumbnail_loaded, self.failed_images)
                self.threadpool.start(loader)

    def _thumbnail_loaded(self, image_path, pixmap):
        for row in range(self.gallery_list.count()):
            item = self.gallery_list.item(row)
            if item and item.data(Qt.UserRole) == image_path:
                if pixmap is None:
                    item.setIcon(QIcon('broken.png'))
                else:
                    item.setIcon(QIcon(pixmap))
                break
        logger.debug('Updated thumbnail for %s', image_path)
        QTimer.singleShot(0, self.gallery_list.repaint)

    def get_thumbnail_path(self, image_path):
        hash_val = hashlib.md5(image_path.encode()).hexdigest()
        return os.path.join(self.thumbnail_dir, f'{hash_val}.jpg')

    def on_image_clicked(self, item):
        path = item.data(Qt.UserRole)
        logger.info('Image clicked: %s', path)
        try:
            pix = QPixmap(path).scaled(500, 500, Qt.KeepAspectRatio)
            if pix.isNull():
                logger.warning('Failed to load image for display: %s', path)
                self.viewer_label.setText('Failed to load image')
                return
            self.viewer_label.setPixmap(pix)
            self.face_list.clear()
            self.controller.request_faces_in_image(path)
        except Exception as e:
            logger.error('Error displaying image %s: %s', path, e)
            self.viewer_label.setText('Error loading image')

    def display_faces_in_image(self, image_faces):
        for path, face_ids in image_faces.items():
            logger.info('Displaying %d faces for %s', len(face_ids), path)
            self.face_list.clear()
            for fid in face_ids:
                thumb = self.controller.db.get_face_thumbnail(fid)
                pix = QPixmap(thumb)
                if pix.isNull():
                    logger.warning('Failed to load face thumbnail for face ID %s', fid)
                    continue
                pix = pix.scaled(80, 80, Qt.KeepAspectRatio)
                item = QListWidgetItem()
                item.setIcon(QIcon(pix))
                item.setData(Qt.UserRole, fid)
                self.face_list.addItem(item)
            QTimer.singleShot(0, self.face_list.repaint)

    def on_face_clicked(self, item):
        fid = item.data(Qt.UserRole)
        logger.info('Face clicked: %s', fid)
        self.controller.request_images_for_face(fid)

    def show_images_for_face(self, face_id, paths):
        logger.info('Showing %d images for face %s: %s', len(paths), face_id, paths)
        self.clear_gallery()
        self.in_filtered_view = True
        self.btn_back.show()
        for path in paths:
            if not os.path.exists(path):
                logger.warning('Image does not exist: %s', path)
                self.failed_images.add(path)
                continue
            if not os.access(path, os.R_OK):
                logger.warning('No read permission for %s', path)
                self.failed_images.add(path)
                continue
            item = QListWidgetItem()
            item.setData(Qt.UserRole, path)
            item.setIcon(QIcon('placeholder.png'))
            self.gallery_list.addItem(item)
            logger.debug('Added item for %s', path)
        logger.debug('Added %d items to gallery_list for face %s', self.gallery_list.count(), face_id)
        QTimer.singleShot(0, self._load_visible_thumbnails)
        QTimer.singleShot(50, self.gallery_list.repaint)

    def back_to_gallery(self):
        logger.info('Returning to full gallery')
        self.show_thumbnails(self.all_image_paths)

    def clear_gallery(self):
        self.gallery_list.clear()
        self.failed_images.clear()
        logger.debug('Gallery cleared')