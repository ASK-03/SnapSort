import logging
import os
import sqlite3
import threading
import time
from PIL import Image

logger = logging.getLogger(__name__)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _folder_match_clause(folder: str) -> tuple[str, list[str]]:
    """Build a SQL WHERE clause matching exact folder path or descendants."""
    variants: list[str] = []
    for candidate in (os.path.abspath(folder), os.path.realpath(folder)):
        cleaned = candidate.rstrip(os.sep) or candidate
        if cleaned not in variants:
            variants.append(cleaned)

    clauses: list[str] = []
    params: list[str] = []
    for root in variants:
        prefix = (root if root.endswith(os.sep) else root + os.sep)
        clauses.append("(images.path = ? OR images.path LIKE ? ESCAPE '\\')")
        params.extend([root, f"{_escape_like(prefix)}%"])
    return "(" + " OR ".join(clauses) + ")", params


class Database:
    def __init__(self, db_path: str):
        logger.info("Opening database: %s", db_path)
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.lock = threading.RLock()
        self._configure_pragmas()
        self._init_schema()

    def _configure_pragmas(self):
        with self.lock:
            c = self.conn.cursor()
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA busy_timeout=5000")
            c.execute("PRAGMA synchronous=NORMAL")
            self.conn.commit()

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
            # Tracks merged cluster redirects so stale FAISS IDs never resurrect
            c.execute(
                "CREATE TABLE IF NOT EXISTS face_merges ("
                "  old_id INTEGER PRIMARY KEY, "
                "  primary_id INTEGER NOT NULL)"
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_occ_face  ON occurrences(image_id, face_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_occ_image ON occurrences(face_id, image_id)")
            # Migrate: add name column if it doesn't exist yet
            try:
                c.execute("ALTER TABLE faces ADD COLUMN name TEXT DEFAULT NULL")
            except Exception:
                pass  # column already exists
            self.conn.commit()

    def close(self):
        with self.lock:
            if self.conn is not None:
                self.conn.close()
                self.conn = None  # type: ignore

    # ------------------------------------------------------------------
    # Face merge redirects
    # ------------------------------------------------------------------

    def resolve_face_id(self, face_id: int) -> tuple[int, bool]:
        """Follow face_merges redirects; return (canonical_id, was_merged)."""
        with self.lock:
            c = self.conn.cursor()
            current = int(face_id)
            visited: set[int] = set()
            was_merged = False
            while current not in visited:
                visited.add(current)
                c.execute("SELECT primary_id FROM face_merges WHERE old_id = ?", (current,))
                row = c.fetchone()
                if not row:
                    break
                current = int(row[0])
                was_merged = True
            return current, was_merged

    def face_exists(self, face_id: int) -> bool:
        """Return True if face_id (or its merged canonical target) exists in faces."""
        canonical_id, _ = self.resolve_face_id(face_id)
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT 1 FROM faces WHERE id = ?", (canonical_id,))
            return c.fetchone() is not None

    def insert_occurrences_batch(self, items: list[tuple[str, int, tuple]]):
        """Insert all faces for one or more images in a single transaction."""
        if not items:
            return

        with self.lock:
            c = self.conn.cursor()
            now = time.time()
            for image_path, raw_face_id, box in items:
                face_id, _ = self.resolve_face_id(raw_face_id)

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
    # Image ID helpers (needed by CLIPIndex and mtime re-indexing)
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

    def update_image_mtime(self, image_id: int, modified: float) -> None:
        with self.lock:
            c = self.conn.cursor()
            c.execute("UPDATE images SET modified = ? WHERE id = ?", (modified, image_id))
            self.conn.commit()

    def clear_occurrences_for_image(self, image_id: int) -> None:
        with self.lock:
            c = self.conn.cursor()
            c.execute("DELETE FROM occurrences WHERE image_id = ?", (image_id,))
            self.conn.commit()

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

    def reconcile_clip_status(self, indexed_clip_ids: set[int]) -> int:
        """Remove clip_status rows whose IDs are missing from clip.index."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT image_id FROM clip_status WHERE indexed = 1")
            db_ids = {int(r[0]) for r in c.fetchall()}
            stale = sorted(db_ids - set(indexed_clip_ids))
            if not stale:
                return 0
            placeholders = ",".join("?" for _ in stale)
            c.execute(f"DELETE FROM clip_status WHERE image_id IN ({placeholders})", stale)
            self.conn.commit()
            logger.warning("Reconciled %d stale clip_status rows missing from clip.index", len(stale))
            return len(stale)

    # ------------------------------------------------------------------
    # Face naming (for search reranking & MCP people lookup)
    # ------------------------------------------------------------------

    def set_face_name(self, face_id: int, name: str | None):
        """Assign or clear a human-readable name for a face cluster."""
        canonical_id, _ = self.resolve_face_id(face_id)
        with self.lock:
            c = self.conn.cursor()
            c.execute("UPDATE faces SET name = ? WHERE id = ?", (name, canonical_id))
            self.conn.commit()

    def get_face_name(self, face_id: int) -> str | None:
        canonical_id, _ = self.resolve_face_id(face_id)
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT name FROM faces WHERE id = ?", (canonical_id,))
            row = c.fetchone()
            return row[0] if row else None

    def get_all_named_faces(self) -> list[tuple[int, str]]:
        """Return [(face_id, name), ...] for all faces that have a name."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT id, name FROM faces WHERE name IS NOT NULL AND name != ''")
            return c.fetchall()

    def get_all_faces_with_counts(
        self,
        name_filter: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[dict]:
        """Return faces with names and distinct photo counts, with optional filtering/pagination."""
        with self.lock:
            c = self.conn.cursor()
            params: list[object] = []
            where_sql = ""
            if name_filter is not None and name_filter.strip():
                where_sql = "WHERE LOWER(f.name) LIKE LOWER(?) ESCAPE '\\' "
                params.append(f"%{_escape_like(name_filter.strip())}%")

            limit_sql = ""
            if limit is not None:
                limit_sql = "LIMIT ? OFFSET ?"
                params.extend([int(limit), max(0, int(offset))])

            c.execute(
                f"""
                SELECT f.id, f.name, COUNT(DISTINCT o.image_id) AS photo_count
                FROM faces f
                LEFT JOIN occurrences o ON f.id = o.face_id
                {where_sql}
                GROUP BY f.id
                ORDER BY f.id
                {limit_sql}
                """,
                params,
            )
            return [{"id": r[0], "name": r[1], "count": r[2]} for r in c.fetchall()]

    def get_faces_in_image(self, image_path: str):
        """Return a list of distinct face_ids found in 'image_path'."""
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
                "SELECT DISTINCT face_id FROM occurrences WHERE image_id = ? ORDER BY face_id",
                (img_id,),
            )
            return [r[0] for r in c.fetchall()]

    def get_images_with_face(
        self,
        face_id: int,
        folder: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[str]:
        """Return distinct image paths containing 'face_id' in stable order."""
        if face_id is None:
            return []
        canonical_id, _ = self.resolve_face_id(face_id)

        with self.lock:
            c = self.conn.cursor()
            clauses = ["occurrences.face_id = ?"]
            params: list[object] = [canonical_id]

            if folder is not None and folder.strip():
                folder_sql, folder_params = _folder_match_clause(folder.strip())
                clauses.append(folder_sql)
                params.extend(folder_params)

            limit_sql = ""
            if limit is not None:
                limit_sql = "LIMIT ? OFFSET ?"
                params.extend([int(limit), max(0, int(offset))])

            where_sql = " AND ".join(clauses)
            c.execute(
                f"""
                SELECT DISTINCT images.path
                FROM occurrences
                JOIN images ON occurrences.image_id = images.id
                WHERE {where_sql}
                ORDER BY images.id
                {limit_sql}
                """,
                params,
            )
            return [r[0] for r in c.fetchall()]

    def get_image_ids_for_face(self, face_id: int) -> set[int]:
        """Return all distinct image IDs containing face_id (after merge resolution)."""
        canonical_id, _ = self.resolve_face_id(face_id)
        with self.lock:
            c = self.conn.cursor()
            c.execute(
                "SELECT DISTINCT image_id FROM occurrences WHERE face_id = ?",
                (canonical_id,),
            )
            return {int(r[0]) for r in c.fetchall()}

    def get_image_ids_in_folder(self, folder: str) -> set[int]:
        """Return all indexed image IDs under folder."""
        folder_sql, folder_params = _folder_match_clause(folder)
        with self.lock:
            c = self.conn.cursor()
            c.execute(f"SELECT id FROM images WHERE {folder_sql}", folder_params)
            return {int(r[0]) for r in c.fetchall()}

    def get_images_in_folder_paginated(
        self,
        folder: str,
        limit: int = 20,
        offset: int = 0,
    ) -> list[str]:
        """Return paginated indexed image paths under folder."""
        folder_sql, folder_params = _folder_match_clause(folder)
        with self.lock:
            c = self.conn.cursor()
            c.execute(
                f"SELECT path FROM images WHERE {folder_sql} ORDER BY id LIMIT ? OFFSET ?",
                [*folder_params, int(limit), max(0, int(offset))],
            )
            return [r[0] for r in c.fetchall()]

    def count_images_in_folder(self, folder: str) -> int:
        folder_sql, folder_params = _folder_match_clause(folder)
        with self.lock:
            c = self.conn.cursor()
            c.execute(f"SELECT COUNT(*) FROM images WHERE {folder_sql}", folder_params)
            return int(c.fetchone()[0])

    def get_processed_images(self) -> set[str]:
        """Return a set of paths for all images already recorded in images."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT path FROM images")
            return {r[0] for r in c.fetchall()}

    def get_processed_images_with_mtime(self) -> dict[str, float]:
        """Return {path: modified_mtime} for all indexed images."""
        with self.lock:
            c = self.conn.cursor()
            c.execute("SELECT path, COALESCE(modified, 0.0) FROM images")
            return {r[0]: float(r[1]) for r in c.fetchall()}

    def get_all_images_paginated(self, offset: int = 0, limit: int = 50) -> list[str]:
        """Return a paginated list of image paths from the database, ordered by ID."""
        query = "SELECT path FROM images ORDER BY id LIMIT ? OFFSET ?"
        with self.lock:
            c = self.conn.cursor()
            c.execute(query, (limit, offset))
            return [r[0] for r in c.fetchall()]

    def get_stats(self):
        with self.lock:
            c = self.conn.cursor()
            total_images = c.execute("SELECT COUNT(*) FROM images").fetchone()[0]
            total_faces = c.execute("SELECT COUNT(DISTINCT id) FROM faces").fetchone()[0]
            total_people = c.execute(
                "SELECT COUNT(DISTINCT name) FROM faces WHERE name IS NOT NULL AND name != ''"
            ).fetchone()[0]
            return {
                "photos": total_images,
                "faces": total_faces,
                "people": total_people,
            }

    def get_face_thumbnail(self, face_id: int):
        """Return path to the 80x80 thumbnail PNG for face_id (generating lazily)."""
        canonical_id, _ = self.resolve_face_id(face_id)
        data_dir = os.environ.get("SNAPSORT_DATA_DIR", "data")
        thumb_dir = os.path.join(data_dir, "thumbnails")
        os.makedirs(thumb_dir, exist_ok=True)
        path = os.path.join(thumb_dir, f"face_{canonical_id}.png")

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
                (canonical_id,),
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
            logger.error("Failed to generate thumbnail for face %d: %s", canonical_id, e)
            return None

    def merge_faces(self, primary_id: int, other_ids: list[int]):
        """
        Merge every ID in other_ids into primary_id:
         1) Resolve primary_id and filter out self-merges
         2) Persist face_merges redirects (updating chained redirects too)
         3) Redirect occurrences.face_id -> canonical primary_id
         4) Delete merged-out face rows from faces
        """
        if not other_ids:
            return

        canonical_primary, _ = self.resolve_face_id(primary_id)
        cleaned_others = sorted({int(fid) for fid in other_ids if int(fid) != canonical_primary})
        if not cleaned_others:
            return

        placeholders = ",".join("?" for _ in cleaned_others)
        with self.lock:
            c = self.conn.cursor()

            # 1) Redirect occurrences -> canonical_primary
            c.execute(
                f"UPDATE occurrences SET face_id = ? WHERE face_id IN ({placeholders})",
                [canonical_primary, *cleaned_others],
            )

            # 2) Update any prior redirects that pointed into cleaned_others
            c.execute(
                f"UPDATE face_merges SET primary_id = ? WHERE primary_id IN ({placeholders})",
                [canonical_primary, *cleaned_others],
            )

            # 3) Record new redirects
            for old_id in cleaned_others:
                c.execute(
                    "INSERT OR REPLACE INTO face_merges(old_id, primary_id) VALUES(?, ?)",
                    (old_id, canonical_primary),
                )

            # 4) Remove merged-out face rows from 'faces' table
            c.execute(f"DELETE FROM faces WHERE id IN ({placeholders})", cleaned_others)

            self.conn.commit()
        logger.info("DB: Merged faces %s into %d", cleaned_others, canonical_primary)
