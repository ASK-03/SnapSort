import sqlite3
import threading
import time
import os
import logging
from PIL import Image

logger = logging.getLogger(__name__)

class Database:
    def __init__(self, db_path):
        logger.info('Opening database: %s', db_path)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.lock = threading.Lock()
        self._init_schema()

    def _init_schema(self):
        with self.lock:
            c = self.conn.cursor()
            c.execute('CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY, path TEXT UNIQUE, modified REAL)')
            c.execute('CREATE TABLE IF NOT EXISTS faces (id INTEGER PRIMARY KEY, last_seen REAL)')
            c.execute('CREATE TABLE IF NOT EXISTS occurrences (image_id INTEGER, face_id INTEGER, x1 INTEGER, y1 INTEGER, x2 INTEGER, y2 INTEGER)')
            self.conn.commit()

    def insert_occurrence(self, image_path, face_id, box):
        with self.lock:
            c = self.conn.cursor()
            c.execute('INSERT OR IGNORE INTO images(path, modified) VALUES(?,?)', (image_path, os.path.getmtime(image_path)))
            c.execute('SELECT id FROM images WHERE path=?', (image_path,))
            img_id = c.fetchone()[0]
            c.execute('INSERT OR IGNORE INTO faces(id, last_seen) VALUES(?,?)', (face_id, time.time()))
            c.execute('UPDATE faces SET last_seen=? WHERE id=?', (time.time(), face_id))
            c.execute('INSERT INTO occurrences VALUES(?,?,?,?,?,?)', (img_id, face_id, *box))
            self.conn.commit()

    def get_faces_in_image(self, image_path):
        if not image_path:
            return []
        
        with self.lock:
            c = self.conn.cursor()
            c.execute('SELECT id FROM images WHERE path=?', (image_path,))
            img_id = c.fetchone()[0]
            if not img_id:
                return []
            c.execute('''
                SELECT face_id
                FROM occurrences
                WHERE image_id = ?
            ''', (img_id,))
            rows = c.fetchall()
            face_ids = []
            for face_id in rows:
                face_ids.append(face_id[0])
            return face_ids
        

    def get_images_with_faces(self, face_ids):
        if not face_ids:
            return []

        placeholders = ",".join("?" for _ in face_ids)

        query = f"""
            SELECT images.path
            FROM occurrences
            JOIN images ON occurrences.image_id = images.id
            WHERE face_id IN ({placeholders})
            GROUP BY images.id
            HAVING COUNT(DISTINCT face_id) = ?
        """

        params = face_ids + [len(face_ids)]

        with self.lock:
            c = self.conn.cursor()
            c.execute(query, params)
            rows = c.fetchall()

        return [row[0] for row in rows]


    def get_face_thumbnail(self, face_id):
        thumb_dir = 'resources/thumbnails'
        os.makedirs(thumb_dir, exist_ok=True)
        path = os.path.join(thumb_dir, f'face_{face_id}.png')
        if os.path.exists(path):
            return path

        with self.lock:
            c = self.conn.cursor()
            c.execute('''
                SELECT images.path, x1, y1, x2, y2
                FROM occurrences
                JOIN images ON occurrences.image_id = images.id
                WHERE face_id = ?
                ORDER BY images.modified DESC
                LIMIT 1
            ''', (face_id,))
            row = c.fetchone()
            if not row:
                return None  # no data

            img_path, x1, y1, x2, y2 = row
            try:
                from PIL import Image
                img = Image.open(img_path).convert('RGB')
                crop = img.crop((x1, y1, x2, y2)).resize((80, 80))
                crop.save(path)
                return path
            except Exception as e:
                logger.error('Failed to generate thumbnail: %s', e)
                return None
