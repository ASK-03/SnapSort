"""
Semantic search engine: CLIP text query → FAISS candidates → face-name reranking.

Pipeline:
  1. spaCy NER: extract PERSON entities from the query
  2. CLIP text encode: 512-d query embedding
  3. FAISS search: top-K candidates (image_ids + cosine scores)
  4. Face-name rerank:
       - fuzzy-match entity names → face_ids (via rapidfuzz)
       - boost images containing matched faces: +0.30 (all), +0.15 (some)
       - penalise if names given but none found: -0.50
  5. Return ranked [(image_path, score), ...]
"""
import logging
import numpy as np
from rapidfuzz import process as fuzz_process, fuzz

logger = logging.getLogger(__name__)

# Reranking score adjustments
_BONUS_ALL  =  0.30   # all named entities present
_BONUS_SOME =  0.15   # at least one named entity present
_PENALTY    = -0.50   # name given but not found in image


class SearchEngine:
    def __init__(self, db, clip_index, clip_processor):
        self.db             = db
        self.clip_index     = clip_index
        self.clip_processor = clip_processor
        self._nlp           = None   # lazy spaCy load

    # ------------------------------------------------------------------
    def _get_nlp(self):
        if self._nlp is None:
            import spacy
            try:
                self._nlp = spacy.load("en_core_web_sm")
                logger.info("spaCy NER loaded")
            except OSError:
                logger.warning("spaCy model not found — NER disabled")
                self._nlp = False
        return self._nlp if self._nlp else None

    def _extract_and_resolve_names(self, query: str) -> dict[str, list[int]]:
        """
        Directly find known database names in the query string (bypassing spaCy NER).
        Matches exact words or slight typos (via rapidfuzz).
        Returns {face_name: [face_id, ...]}
        """
        named_faces = self.db.get_all_named_faces()
        if not named_faces:
            return {}

        import re
        query_words = set(re.findall(r'\b\w+\b', query.lower()))
        name_to_fids = {}

        for face_id, face_name in named_faces:
            face_words = set(re.findall(r'\b\w+\b', face_name.lower()))
            
            # 1. Exact word overlap (e.g. "Aditya" in query matches "Aditya Dubey" in DB)
            if face_words.intersection(query_words):
                name_to_fids.setdefault(face_name, []).append(face_id)
                continue
                
            # 2. Slight typo matching for words >= 3 chars
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
        any_name_present  = False

        for fids in name_to_fids.values():
            if any(fid in face_ids_in_image for fid in fids):
                any_name_present = True
            else:
                all_names_present = False

        if all_names_present and any_name_present:
            return _BONUS_ALL
        if any_name_present:
            return _BONUS_SOME
        return _PENALTY   # name given, none found

    # ------------------------------------------------------------------
    def search(self, query: str, top_k: int = 20, min_score: float = 0.18) -> list[tuple[str, float]]:
        """
        Full semantic search + reranking.
        Returns [(image_path, score), ...] sorted by descending score.
        """
        if self.clip_index.index.ntotal == 0:
            logger.info("CLIP index empty — no results")
            return []

        # 1. Direct Name Resolution
        name_to_fids = self._extract_and_resolve_names(query)
        names_found = list(name_to_fids.keys())
        logger.info("Search: %r  names_found=%s", query, names_found)

        # 2. CLIP text embedding
        query_emb = self.clip_processor.embed_text(query)

        # 3. FAISS: retrieve 3× top_k candidates for reranking headroom
        candidates = self.clip_index.search(query_emb, k=top_k * 3)

        # 4. Rerank
        scored = []
        seen_images = set()
        for image_id, clip_score in candidates:
            if image_id in seen_images:
                continue
            seen_images.add(image_id)

            # ViT-B/32 cosine similarity < 0.21 usually means no semantic match
            if clip_score < min_score:
                continue
                
            bonus = self._face_bonus(image_id, name_to_fids) if names_found else 0.0
            final_score = clip_score + bonus
            
            # If penalized heavily (e.g. specific person requested but not found), skip
            if final_score < 0.15:
                continue
                
            path  = self.db.get_image_path(image_id)
            if path:
                scored.append((path, final_score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]
