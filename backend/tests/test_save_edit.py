import os
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_TESTS_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

MODELS_DIR = os.path.join(os.path.dirname(_BACKEND_DIR), "models")

import api  # noqa: E402


class TestSaveEditedImage(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = os.path.join(self.tmp.name, "data")
        self.photos_dir = os.path.join(self.tmp.name, "photos")
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.photos_dir, exist_ok=True)

        self.orig_path = os.path.join(self.photos_dir, "mountain.jpg")
        img = Image.new("RGB", (200, 100), color=(40, 120, 200))
        exif = img.getexif()
        exif[271] = "SnapCam"
        exif[306] = "2026:10:12 08:30:00"
        img.save(self.orig_path, format="JPEG", exif=exif.tobytes(), quality=95)

        self.token = "test-save-edit-token"
        self.env_patch = patch.dict(
            os.environ,
            {
                "SNAPSORT_DATA_DIR": self.data_dir,
                "SNAPSORT_MODELS_DIR": MODELS_DIR,
                "SNAPSORT_API_TOKEN": self.token,
                "SNAPSORT_INSTANCE_ID": "test-save-edit",
                "SNAPSORT_HEADLESS": "0",
            },
        )
        self.env_patch.start()
        self.client = TestClient(api.app)
        self.client.__enter__()

        ctrl = api.controller()
        self.orig_id = ctrl.db.insert_image(self.orig_path)

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self.env_patch.stop()
        self.tmp.cleanup()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def test_save_as_copy_preserves_exif_and_registers_db(self) -> None:
        res = self.client.post(
            "/api/images/save-copy",
            headers=self._headers(),
            json={
                "source_path": self.orig_path,
                "mode": "copy",
                "crop": {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5},
                "rotate_deg": 90,
                "flip_h": False,
                "flip_v": False,
                "straighten_deg": 0.0,
                "filter_preset": "mono",
                "adjustments": {"light": 10, "contrast": 5, "saturation": 0, "warmth": 0},
            },
        )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["mode"], "copy")
        saved_path = body["saved_path"]
        self.assertTrue(saved_path.endswith("mountain_edited.jpg"))
        self.assertTrue(os.path.exists(saved_path))
        self.assertTrue(os.path.exists(self.orig_path))

        # Copy is indexed in DB while original remains untouched at 200x100
        ctrl = api.controller()
        self.assertIsNotNone(ctrl.db.get_image_id(saved_path))
        with Image.open(self.orig_path) as orig_img:
            self.assertEqual(orig_img.size, (200, 100))

        with Image.open(saved_path) as edited_img:
            # 200x100 rotated 90 deg -> 100x200; cropped to 50%x50% -> 50x100
            self.assertEqual(edited_img.size, (50, 100))
            exif = edited_img.getexif()
            self.assertEqual(exif.get(271), "SnapCam")
            self.assertEqual(exif.get(306), "2026:10:12 08:30:00")
            # Monochrome preset yields equal R/G/B channels on neutral source
            r, g, b = edited_img.getpixel((25, 50))
            self.assertLessEqual(max(abs(r - g), abs(g - b)), 2)

        # Second save increments suffix rather than clobbering
        res2 = self.client.post(
            "/api/images/save-copy",
            headers=self._headers(),
            json={"source_path": self.orig_path, "mode": "copy"},
        )
        self.assertEqual(res2.status_code, 200, res2.text)
        self.assertTrue(res2.json()["saved_path"].endswith("mountain_edited_2.jpg"))

    def test_replace_original_updates_file_in_place_and_preserves_exif(self) -> None:
        res = self.client.post(
            "/api/images/save-copy",
            headers=self._headers(),
            json={
                "source_path": self.orig_path,
                "mode": "replace",
                "crop": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0},
                "rotate_deg": 0,
                "flip_h": True,
                "flip_v": False,
                "straighten_deg": 0.0,
                "filter_preset": "vivid",
                "adjustments": {"light": 0, "contrast": 10, "saturation": 20, "warmth": 15},
            },
        )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["mode"], "replace")
        self.assertEqual(body["saved_path"], self.orig_path)

        with Image.open(self.orig_path) as replaced_img:
            self.assertEqual(replaced_img.size, (100, 100))
            exif = replaced_img.getexif()
            self.assertEqual(exif.get(271), "SnapCam")
            self.assertEqual(exif.get(306), "2026:10:12 08:30:00")


if __name__ == "__main__":
    unittest.main()
