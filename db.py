import sqlite3
import threading
import time
import os
import logging
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
                "  last_seen REAL)"
            )
            c.execute(
                "CREATE TABLE IF NOT EXISTS occurrences ("
                "  image_id INTEGER, "
                "  face_id INTEGER, "
                "  x1 INTEGER, y1 INTEGER, x2 INTEGER, y2 INTEGER)"
            )
            self.conn.commit()

    def insert_occurrence(self, image_path, face_id, box):
        """
        Insert a face occurrence:
         1) Ensure 'images' has (path, modified)
         2) Ensure 'faces' has (id, last_seen)
         3) Insert into 'occurrences'
        """
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
        query = (
            "SELECT images.path "
            "FROM occurrences "
            "JOIN images ON occurrences.image_id = images.id "
            f"WHERE face_id IN ({placeholders}) "
            "GROUP BY images.id "
            "HAVING COUNT(DISTINCT face_id) = ?"
        )
        params = face_ids + [len(face_ids)]

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
            img = Image.open(img_path).convert("RGB")
            crop = img.crop((x1, y1, x2, y2)).resize((80, 80))
            crop.save(path)
            return path
        except Exception as e:
            logger.error("Failed to generate thumbnail for face %d: %s", face_id, e)
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
