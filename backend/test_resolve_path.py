"""Self-check for _resolve_indexed_path: run `python -m backend.test_resolve_path`."""
import os
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

import backend.api as api


def _fake_controller(known: set):
    db = SimpleNamespace(get_image_id=lambda p: 1 if p in known else None)
    return lambda: SimpleNamespace(db=db)


def _status(known, path):
    with patch.object(api, "controller", _fake_controller(known)):
        try:
            return api._resolve_indexed_path(path)
        except HTTPException as e:
            return e.status_code


def demo():
    with tempfile.NamedTemporaryFile(suffix=".jpg") as f:
        assert _status({f.name}, f.name) == f.name, "indexed + on disk should resolve"

    gone = "/media/nope/New Volume/photos/8225.jpg"
    assert _status({gone}, gone) == 404, "indexed but unmounted should 404, not 422"
    assert _status(set(), gone) == 404, "unindexed should 404"
    print("ok")


if __name__ == "__main__":
    demo()
