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

    def _extract_names(self, query: str) -> list[str]:
        """Return PERSON entity strings found in the query."""
        nlp = self._get_nlp()
        if nlp is None:
            return []
        doc = nlp(query)
        return [ent.text for ent in doc.ents if ent.label_ == "PERSON"]

    def _resolve_names(self, names: list[str]) -> dict[str, list[int]]:
        """
        Fuzzy-match each name against all named faces in the DB.
        Returns {name: [face_id, ...]} for matches with score >= 70.
        """
        if not names:
            return {}
        named_faces = self.db.get_all_named_faces()   # [(face_id, face_name), ...]
        if not named_faces:
            return {}

        face_names = [fn for _, fn in named_faces]
        name_to_fids = {}

        for query_name in names:
            hits = fuzz_process.extract(
                query_name, face_names,
                scorer=fuzz.token_sort_ratio,
                score_cutoff=70,
            )
            matched_ids = [named_faces[face_names.index(h[0])][0] for h in hits]
            if matched_ids:
                name_to_fids[query_name] = matched_ids

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
    def search(self, query: str, top_k: int = 20) -> list[tuple[str, float]]:
        """
        Full semantic search + reranking.
        Returns [(image_path, score), ...] sorted by descending score.
        """
        if self.clip_index.index.ntotal == 0:
            logger.info("CLIP index empty — no results")
            return []

        # 1. NER
        names = self._extract_names(query)
        logger.info("Search: %r  names=%s", query, names)

        # 2. CLIP text embedding
        query_emb = self.clip_processor.embed_text(query)

        # 3. FAISS: retrieve 3× top_k candidates for reranking headroom
        candidates = self.clip_index.search(query_emb, k=top_k * 3)

        # 4. Resolve names → face IDs
        name_to_fids = self._resolve_names(names)

        # 5. Rerank
        scored = []
        for image_id, clip_score in candidates:
            bonus = self._face_bonus(image_id, name_to_fids) if names else 0.0
            path  = self.db.get_image_path(image_id)
            if path:
                scored.append((path, clip_score + bonus))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]
