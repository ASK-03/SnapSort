import sqlite3
import threading
import time
import os
import logging
import warnings
from PIL import Image

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, db_path):
        logger.info("Opening database: %s", db_path)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.lock = threading.Lock()
        self._init_schema()

    def _init_schema(self):
        with self.lock:
            c = self.conn.cursor()
            c.execute(
                "CREATE TABLE IF NOT EXISTS images ("
                "  id INTEGER PRIMARY KEY, "
                "  path TEXT UNIQUE, "
                "  modified REAL)"
            )
            c.execute(
                "CREATE TABLE IF NOT EXISTS faces ("
                "  id INTEGER PRIMARY KEY, "
                "  last_seen REAL, "
                "  name TEXT DEFAULT NULL)"
            )
            c.execute(
                "CREATE TABLE IF NOT EXISTS occurrences ("
                "  image_id INTEGER, "
                "  face_id INTEGER, "
                "  x1 INTEGER, y1 INTEGER, x2 INTEGER, y2 INTEGER)"
            )
            # Tracks which images have a CLIP embedding in the FAISS index
            c.execute(
                "CREATE TABLE IF NOT EXISTS clip_status ("
                "  image_id INTEGER PRIMARY KEY, "
                "  indexed INTEGER DEFAULT 0, "
                "  FOREIGN KEY (image_id) REFERENCES images(id))"
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_occ_face  ON occurrences(image_id, face_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_occ_image ON occurrences(face_id, image_id)")
            # Migrate: add name column if it doesn't exist yet
            try:
                c.execute("ALTER TABLE faces ADD COLUMN name TEXT DEFAULT NULL")
            except Exception:
                pass  # column already exists
            self.conn.commit()

    def insert_occurrence(self, image_path, face_id, box):
        """
        Insert a face occurrence (Deprecated: use insert_occurrences_batch instead).
        """
        warnings.warn("insert_occurrence is deprecated, use insert_occurrences_batch instead", DeprecationWarning, stacklevel=2)
        with self.lock:
            c = self.conn.cursor()
            # 1) images table
            c.execute(
                "INSERT OR IGNORE INTO images(path, modified) VALUES(?, ?)",
                (image_path, os.path.getmtime(image_path)),
            )
            c.execute("SELECT id FROM images WHERE path = ?", (image_path,))
            img_id = c.fetchone()[0]

            # 2) faces table
            c.execute(
                "INSERT OR IGNORE INTO faces(id, last_seen) VALUES(?, ?)",
                (face_id, time.time()),
            )
            # Always update last_seen timestamp
            c.execute(
                "UPDATE faces SET last_seen = ? WHERE id = ?",
                (time.time(), face_id),
            )

            # 3) occurrences table
            x1, y1, x2, y2 = box
            c.execute(
                "INSERT INTO occurrences(image_id, face_id, x1, y1, x2, y2) "
                "VALUES(?, ?, ?, ?, ?, ?)",
                (img_id, face_id, x1, y1, x2, y2),
            )
            self.conn.commit()

    def insert_occurrences_batch(self, items: list[tuple[str, int, tuple]]):
        """Insert all faces for one or more images in a single transaction."""
        if not items:
            return

        with self.lock:
            c = self.conn.cursor()
            now = time.time()
            for image_path, face_id, box in items:
                # 1) images table
                c.execute(
                    "INSERT OR IGNORE INTO images(path, modified) VALUES(?, ?)",
                    (image_path, os.path.getmtime(image_path)),
                )
                c.execute("SELECT id FROM images WHERE path = ?", (image_path,))
                img_id = c.fetchone()[0]

                # 2) faces table
                c.execute(
                    "INSERT OR IGNORE INTO faces(id, last_seen) VALUES(?, ?)",
                    (face_id, now),
                )
                # Always update last_seen timestamp
                c.execute(
                    "UPDATE faces SET last_seen = ? WHERE id = ?",
                    (now, face_id),
                )

                # 3) occurrences table
                x1, y1, x2, y2 = box
                c.execute(
                    "INSERT INTO occurrences(image_id, face_id, x1, y1, x2, y2) "
                    "VALUES(?, ?, ?, ?, ?, ?)",
                    (img_id, face_id, x1, y1, x2, y2),
                )
            self.conn.commit()  # ONE commit for entire batch

    # ------------------------------------------------------------------
    # Image ID helpers (needed by CLIPIndex)
    # ------------------------------------------------------------------

    def insert_image(self, image_path: str) -> int:
        """Insert an image if it doesn't exist, returning its ID."""
        with self.lock:
            c = self.conn.cursor()
            c.execute(
                "INSERT OR IGNORE INTO images(path, modified) VALUES(?, ?)",
                (image_path, os.path.getmtime(image_path)),
            )
            self.conn.commit()
            c.execute("SELECT id FROM images WHERE path = ?", (image_path,))
            return c.fetchone()[0]

    def get_image_id(self, image_path: str) -> int | None:
        """Return the SQLite id for an image path, or None if not found."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT id FROM images WHERE path = ?", (image_path,))
            row = c.fetchone()
            return row[0] if row else None

    def get_image_path(self, image_id: int) -> str | None:
        """Return the path for an image id, or None if not found."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT path FROM images WHERE id = ?", (image_id,))
            row = c.fetchone()
            return row[0] if row else None

    def get_face_ids_for_image_id(self, image_id: int) -> list[int]:
        """Return all face_ids in an image by numeric image_id."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT DISTINCT face_id FROM occurrences WHERE image_id = ?", (image_id,))
            return [r[0] for r in c.fetchall()]

    def mark_clip_indexed(self, image_id: int):
        """Record that image_id has been added to the CLIP FAISS index."""
        with self.lock:
            c = self.conn.cursor()
            c.execute(
                "INSERT OR REPLACE INTO clip_status(image_id, indexed) VALUES(?, 1)",
                (image_id,),
            )
            self.conn.commit()

    # ------------------------------------------------------------------
    # Face naming (for search reranking)
    # ------------------------------------------------------------------

    def set_face_name(self, face_id: int, name: str | None):
        """Assign or clear a human-readable name for a face cluster."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("UPDATE faces SET name = ? WHERE id = ?", (name, face_id))
            self.conn.commit()

    def get_face_name(self, face_id: int) -> str | None:
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT name FROM faces WHERE id = ?", (face_id,))
            row = c.fetchone()
            return row[0] if row else None

    def get_all_named_faces(self) -> list[tuple[int, str]]:
        """Return [(face_id, name), ...] for all faces that have a name."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT id, name FROM faces WHERE name IS NOT NULL AND name != ''")
            return c.fetchall()

    def get_all_face_ids(self) -> list[int]:
        """Return all face IDs (ordered by id) for the People view."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT DISTINCT id FROM faces ORDER BY id")
            return [r[0] for r in c.fetchall()]

    def get_faces_in_image(self, image_path):
        """
        Return a list of face_ids found in 'image_path'.
        """
        if not image_path:
            return []

        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT id FROM images WHERE path = ?", (image_path,))
            row = c.fetchone()
            if not row:
                return []
            img_id = row[0]

            c.execute(
                "SELECT face_id FROM occurrences WHERE image_id = ?",
                (img_id,),
            )
            rows = c.fetchall()
            return [r[0] for r in rows]

    def get_images_with_face(self, face_id):
        """
        Return all distinct image paths that contain 'face_id'.
        """
        if face_id is None:
            return []

        with self.lock:
            c = self.conn.cursor()
            c.execute(
                "SELECT DISTINCT images.path "
                "FROM occurrences "
                "JOIN images ON occurrences.image_id = images.id "
                "WHERE face_id = ?",
                (face_id,),
            )
            rows = c.fetchall()
            return [r[0] for r in rows]

    def get_images_with_faces(self, face_ids):
        """
        Return all image paths containing *all* of the face_ids in the given list.
        Uses GROUP BY ... HAVING COUNT(DISTINCT face_id) = len(face_ids).
        """
        if not face_ids:
            return []

        placeholders = ",".join("?" for _ in face_ids)

        query = f"""
            SELECT images.path
            FROM occurrences
            JOIN images ON occurrences.image_id = images.id
            WHERE face_id IN ({placeholders})
            GROUP BY images.id
            HAVING COUNT(DISTINCT face_id) > 1
        """

        params = face_ids

        with self.lock:
            c = self.conn.cursor()
            c.execute(query, params)
            rows = c.fetchall()
            return [r[0] for r in rows]

    def get_processed_images(self):
        """
        Returns a set of paths for all images that have at least one occurrence inserted.
        """
        query = (
            "SELECT DISTINCT images.path "
            "FROM occurrences "
            "JOIN images ON occurrences.image_id = images.id"
        )
        with self.lock:
            c = self.conn.cursor()
            c.execute(query)
            rows = c.fetchall()
            return {r[0] for r in rows}

    def get_face_thumbnail(self, face_id):
        """
        Return the path to the 80×80 thumbnail PNG for face_id.
        If it doesn’t exist yet, find the most recent occurrence → crop → save.
        """
        thumb_dir = os.path.join("resources", "thumbnails")
        os.makedirs(thumb_dir, exist_ok=True)
        path = os.path.join(thumb_dir, f"face_{face_id}.png")

        if os.path.exists(path):
            return path

        with self.lock:
            c = self.conn.cursor()
            c.execute(
                "SELECT images.path, x1, y1, x2, y2 "
                "FROM occurrences "
                "JOIN images ON occurrences.image_id = images.id "
                "WHERE face_id = ? "
                "ORDER BY images.modified DESC "
                "LIMIT 1",
                (face_id,),
            )
            row = c.fetchone()
            if not row:
                return None

            img_path, x1, y1, x2, y2 = row

        try:
            from PIL import ImageOps
            img = Image.open(img_path).convert("RGB")
            img = ImageOps.exif_transpose(img)
            w, h = img.size
            face_w = x2 - x1
            face_h = y2 - y1
            
            # Pad by 30% of face width/height on each side to show hair/context
            pad_w = int(face_w * 0.3)
            pad_h = int(face_h * 0.3)
            
            nx1 = max(0, x1 - pad_w)
            ny1 = max(0, y1 - int(pad_h * 1.5))  # extra padding on top for hair
            nx2 = min(w, x2 + pad_w)
            ny2 = min(h, y2 + pad_h)
            
            crop = img.crop((nx1, ny1, nx2, ny2)).resize((80, 80))
            crop.save(path)
            return path
        except Exception as e:
            logger.error("Failed to generate thumbnail for face %d: %s", face_id, e)
            return None
    def get_face_thumbnail_from_image(self, face_id, image_path):
        """
        Return the path to an 80x80 thumbnail PNG for face_id *specifically* from image_path.
        This prevents false merges from showing the wrong person's face.
        """
        import hashlib
        thumb_dir = os.path.join("resources", "thumbnails")
        os.makedirs(thumb_dir, exist_ok=True)
        # Unique name per face occurrence in a specific image
        path_hash = hashlib.md5(image_path.encode()).hexdigest()
        path = os.path.join(thumb_dir, f"face_{face_id}_{path_hash}.png")

        if os.path.exists(path):
            return path

        with self.lock:
            c = self.conn.cursor()
            c.execute(
                "SELECT x1, y1, x2, y2 "
                "FROM occurrences "
                "JOIN images ON occurrences.image_id = images.id "
                "WHERE face_id = ? AND images.path = ? "
                "LIMIT 1",
                (face_id, image_path),
            )
            row = c.fetchone()
            if not row:
                return None
            x1, y1, x2, y2 = row

        try:
            from PIL import ImageOps
            img = Image.open(image_path).convert("RGB")
            img = ImageOps.exif_transpose(img)
            w, h = img.size
            face_w = x2 - x1
            face_h = y2 - y1
            
            # Pad by 30% of face width/height on each side
            pad_w = int(face_w * 0.3)
            pad_h = int(face_h * 0.3)
            
            nx1 = max(0, x1 - pad_w)
            ny1 = max(0, y1 - int(pad_h * 1.5))
            nx2 = min(w, x2 + pad_w)
            ny2 = min(h, y2 + pad_h)
            
            crop = img.crop((nx1, ny1, nx2, ny2)).resize((80, 80))
            crop.save(path)
            return path
        except Exception as e:
            logger.error("Failed to generate specific thumbnail for face %d in %s: %s", face_id, image_path, e)
            return None

    def merge_faces(self, primary_id, other_ids):
        """
        Merge every ID in other_ids into primary_id:
         1) occurrences.face_id = primary_id WHERE face_id IN other_ids
         2) DELETE rows in 'faces' table for other_ids
        """
        if not other_ids:
            return

        placeholders = ",".join("?" for _ in other_ids)
        with self.lock:
            c = self.conn.cursor()

            # 1) Redirect occurrences → primary_id
            update_sql = (
                f"UPDATE occurrences "
                f"SET face_id = ? "
                f"WHERE face_id IN ({placeholders})"
            )
            c.execute(update_sql, [primary_id] + other_ids)

            # 2) Remove merged-out face rows from 'faces' table
            del_sql = f"DELETE FROM faces WHERE id IN ({placeholders})"
            c.execute(del_sql, other_ids)

            self.conn.commit()
        logger.info("DB: Merged faces %s into %d", other_ids, primary_id)
