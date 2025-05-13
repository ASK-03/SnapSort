import logging
import os
from PyQt5.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QPushButton,
    QFileDialog, QLabel, QScrollArea, QGridLayout,
    QListWidget, QListWidgetItem, QSplitter
)
from PyQt5.QtCore import Qt, QSize
from PyQt5.QtGui import QPixmap, QIcon

logger = logging.getLogger(__name__)

class MainWindow(QMainWindow):
    def __init__(self, controller):
        super().__init__()
        self.controller = controller
        self.all_image_paths = []
        self.in_filtered_view = False
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
        self.btn_back.hide()  # Initially hidden
        left_layout.addWidget(self.btn_back)

        self.gallery_scroll = QScrollArea()
        self.gallery_container = QWidget()
        self.gallery_layout = QGridLayout(self.gallery_container)
        self.gallery_scroll.setWidget(self.gallery_container)
        self.gallery_scroll.setWidgetResizable(True)
        left_layout.addWidget(self.gallery_scroll)
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

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, 'Select Image Folder')
        if folder:
            logger.info('Folder selected: %s', folder)
            self.clear_gallery()
            self.controller.scan_folder(folder)

    def show_thumbnails(self, image_paths):
        logger.info('Displaying %d thumbnails', len(image_paths))
        self.clear_gallery()
        self.all_image_paths = image_paths
        self.in_filtered_view = False
        self.btn_back.hide()
        for idx, path in enumerate(image_paths):
            pix = QPixmap(path).scaled(120, 120, Qt.KeepAspectRatio)
            lbl = QLabel()
            lbl.setPixmap(pix)
            lbl.mousePressEvent = self._make_image_click_handler(path)
            row, col = divmod(idx, 5)
            self.gallery_layout.addWidget(lbl, row, col)

    def _make_image_click_handler(self, path):
        def handler(event):
            logger.info('Image clicked: %s', path)
            pix = QPixmap(path).scaled(500, 500, Qt.KeepAspectRatio)
            self.viewer_label.setPixmap(pix)
            self.face_list.clear()
            self.controller.request_faces_in_image(path)
        return handler

    def display_faces_in_image(self, image_faces):
        # image_faces: {path: [face_ids]}
        for path, face_ids in image_faces.items():
            logger.info('Displaying %d faces for %s', len(face_ids), path)
            self.face_list.clear()
            for fid in face_ids:
                thumb = self.controller.db.get_face_thumbnail(fid)
                pix = QPixmap(thumb).scaled(80, 80, Qt.KeepAspectRatio)
                item = QListWidgetItem()
                item.setIcon(QIcon(pix))
                item.setData(Qt.UserRole, fid)
                self.face_list.addItem(item)

    def on_face_clicked(self, item):
        fid = item.data(Qt.UserRole)
        logger.info('Face clicked: %s', fid)
        self.controller.request_images_for_face(fid)

    def show_images_for_face(self, face_id, paths):
        logger.info('Showing %d images for face %s', len(paths), face_id)
        self.clear_gallery()
        self.in_filtered_view = True
        self.btn_back.show()
        for idx, path in enumerate(paths):
            pix = QPixmap(path).scaled(120, 120, Qt.KeepAspectRatio)
            lbl = QLabel()
            lbl.setPixmap(pix)
            lbl.mousePressEvent = self._make_image_click_handler(path)
            row, col = divmod(idx, 5)
            self.gallery_layout.addWidget(lbl, row, col)

    def back_to_gallery(self):
        logger.info('Returning to full gallery')
        self.show_thumbnails(self.all_image_paths)

    def clear_gallery(self):
        for i in reversed(range(self.gallery_layout.count())):
            widget = self.gallery_layout.itemAt(i).widget()
            if widget:
                widget.setParent(None)
