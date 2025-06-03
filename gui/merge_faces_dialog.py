import os
import logging
from PyQt5.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QLabel,
    QMessageBox,
    QHBoxLayout,
    QInputDialog,
)
from PyQt5.QtGui import QPixmap, QIcon
from PyQt5.QtCore import QSize, Qt

logger = logging.getLogger(__name__)


class MergeFacesDialog(QDialog):
    """
    A dialog that shows all face thumbnails in a QListWidget (icon mode),
    allows the user to select multiple faces, and merge them into one chosen ID.
    """

    def __init__(self, controller, parent=None):
        super().__init__(parent)
        self.controller = controller
        self.db = controller.db
        self.setWindowTitle("Merge Faces")
        self.setMinimumSize(600, 500)
        self._build_ui()
        self._load_all_face_items()

    def _build_ui(self):
        layout = QVBoxLayout(self)

        info_label = QLabel(
            "Select two or more faces that represent the same person, then click “Merge Selected.”"
        )
        layout.addWidget(info_label)

        # QListWidget in icon mode for face thumbnails
        self.face_list = QListWidget()
        self.face_list.setViewMode(QListWidget.IconMode)
        self.face_list.setIconSize(QSize(80, 80))
        self.face_list.setSelectionMode(QListWidget.MultiSelection)
        self.face_list.setResizeMode(QListWidget.Adjust)
        self.face_list.setWrapping(True)
        self.face_list.setGridSize(QSize(100, 100))
        layout.addWidget(self.face_list)

        btn_layout = QHBoxLayout()
        self.btn_merge = QPushButton("Merge Selected")
        self.btn_merge.clicked.connect(self.on_merge_clicked)
        btn_layout.addStretch()
        btn_layout.addWidget(self.btn_merge)
        layout.addLayout(btn_layout)

    def _load_all_face_items(self):
        """
        Query 'faces' table for all IDs (ORDER BY id). For each face_id,
        generate (or load existing) thumbnail via db.get_face_thumbnail().
        Then add to QListWidget with face_id in UserRole.
        """
        query = "SELECT id FROM faces ORDER BY id ASC"
        with self.db.lock:
            c = self.db.conn.cursor()
            c.execute(query)
            rows = c.fetchall()
        face_ids = [row[0] for row in rows]

        for fid in face_ids:
            thumb_path = self.db.get_face_thumbnail(fid)
            if not thumb_path or not os.path.exists(thumb_path):
                # If we couldn’t generate a thumbnail for this face, skip it
                continue

            pix = QPixmap(thumb_path).scaled(80, 80, Qt.KeepAspectRatio)
            item = QListWidgetItem()
            item.setIcon(QIcon(pix))
            item.setData(Qt.UserRole, fid)
            item.setToolTip(f"Face ID: {fid}")
            self.face_list.addItem(item)

    def on_merge_clicked(self):
        """
        Called when the user clicks “Merge Selected.”
        - Ensure at least two are selected.
        - Prompt user to pick the primary ID (via QInputDialog).
        - Confirm the merge, then call controller.merge_face_ids(primary_id, other_ids).
        """
        selected_items = self.face_list.selectedItems()
        if len(selected_items) < 2:
            QMessageBox.warning(
                self, "Need At Least Two", "Select at least two faces to merge."
            )
            return

        face_ids = [item.data(Qt.UserRole) for item in selected_items]
        face_id_strs = [str(fid) for fid in face_ids]

        primary_str, ok = QInputDialog.getItem(
            self,
            "Choose Primary Face ID",
            "Select which Face ID to keep as primary:",
            face_id_strs,
            editable=False,
        )
        if not ok:
            return

        primary_id = int(primary_str)
        other_ids = [fid for fid in face_ids if fid != primary_id]

        confirm = QMessageBox.question(
            self,
            "Confirm Merge",
            f"Merge {other_ids} into {primary_id}? This cannot be undone.",
            QMessageBox.Yes | QMessageBox.No,
        )
        if confirm != QMessageBox.Yes:
            return

        # Perform the merge
        self.controller.merge_face_ids(primary_id, other_ids)
        QMessageBox.information(
            self, "Merged", f"Faces {other_ids} have been merged into {primary_id}."
        )
        self.accept()
