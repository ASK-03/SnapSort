"""
Semantic search engine: CLIP text query -> FAISS candidates -> face-name reranking.

Supports:
  - Global CLIP search + face-name reranking
  - Pre-filtered subset search by person_id and/or canonical folder path
  - Lazy CLIPProcessor resolution via callable getter
"""
import logging
import re
import numpy as np
from rapidfuzz import fuzz

logger = logging.getLogger(__name__)

# Reranking score adjustments
_BONUS_ALL = 0.30    # all named entities present
_BONUS_SOME = 0.15   # at least one named entity present
_PENALTY = -0.50     # name given but not found in image


class SearchEngine:
    def __init__(self, db, clip_index, clip_processor):
        self.db = db
        self.clip_index = clip_index
        self._clip_processor = clip_processor

    def _get_clip_processor(self):
        if callable(self._clip_processor):
            return self._clip_processor()
        return self._clip_processor

    def _extract_and_resolve_names(self, query: str) -> dict[str, list[int]]:
        """
        Directly find known database names in the query string.
        Matches exact words or slight typos (via rapidfuzz).
        Returns {face_name: [face_id, ...]}.
        """
        named_faces = self.db.get_all_named_faces()
        if not named_faces:
            return {}

        query_words = set(re.findall(r"\b\w+\b", query.lower()))
        name_to_fids: dict[str, list[int]] = {}

        for face_id, face_name in named_faces:
            face_words = set(re.findall(r"\b\w+\b", face_name.lower()))

            if face_words.intersection(query_words):
                name_to_fids.setdefault(face_name, []).append(face_id)
                continue

            matched = False
            for fw in face_words:
                if len(fw) < 3:
                    continue
                for qw in query_words:
                    if fuzz.ratio(fw, qw) >= 85:
                        name_to_fids.setdefault(face_name, []).append(face_id)
                        matched = True
                        break
                if matched:
                    break

        return name_to_fids

    def _face_bonus(self, image_id: int, name_to_fids: dict) -> float:
        """Compute score adjustment based on face-name presence in image."""
        if not name_to_fids:
            return 0.0

        face_ids_in_image = set(self.db.get_face_ids_for_image_id(image_id))
        all_names_present = True
        any_name_present = False

        for fids in name_to_fids.values():
            if any(fid in face_ids_in_image for fid in fids):
                any_name_present = True
            else:
                all_names_present = False

        if all_names_present and any_name_present:
            return _BONUS_ALL
        if any_name_present:
            return _BONUS_SOME
        return _PENALTY

    def _embed_query(self, query: str) -> np.ndarray:
        """Encode the user query directly without rewriting it into template phrases."""
        proc = self._get_clip_processor()
        return np.asarray(proc.embed_text(query.strip()), dtype="float32")

    def search_with_diagnostics(
        self,
        query: str,
        top_k: int = 20,
        min_score: float = 0.25,
        person_id: int | None = None,
        folder: str | None = None,
        offset: int = 0,
    ) -> tuple[list[tuple[str, float]], int, float | None]:
        """
        Semantic search with optional pre-candidate person/folder filtering and pagination.
        Returns ([(image_path, score), ...], total_matches, highest_below_threshold).
        """
        if self.clip_index.ntotal == 0 or not query or not query.strip():
            return [], 0, None

        safe_offset = max(0, int(offset))
        safe_top_k = max(1, int(top_k))

        allowed_ids: set[int] | None = None
        if person_id is not None:
            allowed_ids = self.db.get_image_ids_for_face(person_id)
        if folder is not None and folder.strip():
            folder_ids = self.db.get_image_ids_in_folder(folder.strip())
            allowed_ids = folder_ids if allowed_ids is None else (allowed_ids & folder_ids)

        if allowed_ids is not None and not allowed_ids:
            return [], 0, None

        use_name_rerank = person_id is None
        name_to_fids = self._extract_and_resolve_names(query) if use_name_rerank else {}
        names_found = list(name_to_fids.keys())
        logger.info(
            "Search: %r  person_id=%s folder=%s min_score=%.3f names_found=%s",
            query,
            person_id,
            folder,
            min_score,
            names_found,
        )

        query_emb = self._embed_query(query)
        k_fetch = max(50, (safe_offset + safe_top_k) * 3)

        if allowed_ids is not None:
            candidates = self.clip_index.search_subset(query_emb, allowed_ids, k=k_fetch)
        else:
            candidates = self.clip_index.search(query_emb, k=k_fetch)

        scored: list[tuple[str, float]] = []
        seen_images: set[int] = set()
        highest_below: float | None = None

        for image_id, clip_score in candidates:
            if image_id in seen_images:
                continue
            seen_images.add(image_id)

            if clip_score < min_score:
                if highest_below is None or clip_score > highest_below:
                    highest_below = float(clip_score)
                continue

            bonus = self._face_bonus(image_id, name_to_fids) if names_found else 0.0
            final_score = clip_score + bonus

            if names_found and final_score < 0.21:
                if highest_below is None or final_score > highest_below:
                    highest_below = float(final_score)
                continue

            path = self.db.get_image_path(image_id)
            if path:
                scored.append((path, float(final_score)))

        scored.sort(key=lambda x: x[1], reverse=True)
        total_matches = len(scored)
        page = scored[safe_offset : safe_offset + safe_top_k]
        return page, total_matches, (None if scored else highest_below)

    def search(
        self,
        query: str,
        top_k: int = 20,
        min_score: float = 0.25,
        person_id: int | None = None,
        folder: str | None = None,
    ) -> list[tuple[str, float]]:
        """
        Semantic search with optional pre-candidate person/folder filtering.
        Returns [(image_path, score), ...] sorted by descending score.
        """
        results, _, _ = self.search_with_diagnostics(
            query=query,
            top_k=top_k,
            min_score=min_score,
            person_id=person_id,
            folder=folder,
        )
        return results
