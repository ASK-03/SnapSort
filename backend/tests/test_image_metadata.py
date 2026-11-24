import os
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_TESTS_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

MODELS_DIR = os.path.join(os.path.dirname(_BACKEND_DIR), "models")

import api  # noqa: E402


class TestImageMetadata(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = os.path.join(self.tmp.name, "data")
        self.photos_dir = os.path.join(self.tmp.name, "photos")
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.photos_dir, exist_ok=True)

        self.exif_jpg = os.path.join(self.photos_dir, "exif_gps.jpg")
        img = Image.new("RGB", (400, 300), color=(90, 140, 180))
        exif = img.getexif()
        exif[271] = "Fujifilm"
        exif[272] = "X-T5"
        exif[274] = 6  # Rotated 90 deg CW -> metadata width/height should reflect oriented 300x400
        exif_ifd = exif.get_ifd(0x8769)
        exif_ifd[36867] = "2026:09:14 17:42:10"
        exif_ifd[42036] = "XF 23mm F1.4"
        exif_ifd[37386] = IFDRational(23, 1)
        exif_ifd[33437] = IFDRational(18, 10)
        exif_ifd[33434] = IFDRational(1, 250)
        exif_ifd[34855] = 400
        gps_ifd = exif.get_ifd(0x8825)
        gps_ifd[1] = "N"
        gps_ifd[2] = (IFDRational(37, 1), IFDRational(46, 1), IFDRational(2964, 100))
        gps_ifd[3] = "W"
        gps_ifd[4] = (IFDRational(122, 1), IFDRational(25, 1), IFDRational(984, 100))
        img.save(self.exif_jpg, format="JPEG", exif=exif.tobytes(), quality=95)

        self.plain_png = os.path.join(self.photos_dir, "plain.png")
        Image.new("RGBA", (120, 80), color=(20, 30, 40, 255)).save(self.plain_png, format="PNG")

        self.token = "test-metadata-token"
        self.env_patch = patch.dict(
            os.environ,
            {
                "SNAPSORT_DATA_DIR": self.data_dir,
                "SNAPSORT_MODELS_DIR": MODELS_DIR,
                "SNAPSORT_API_TOKEN": self.token,
                "SNAPSORT_INSTANCE_ID": "test-meta",
                "SNAPSORT_HEADLESS": "0",
            },
        )
        self.env_patch.start()
        self.client = TestClient(api.app)
        self.client.__enter__()

        ctrl = api.controller()
        ctrl.db.insert_image(self.exif_jpg)
        ctrl.db.insert_image(self.plain_png)

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self.env_patch.stop()
        self.tmp.cleanup()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def test_metadata_parses_exif_and_gps(self) -> None:
        res = self.client.get("/api/images/metadata", headers=self._headers(), params={"path": self.exif_jpg})
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["filename"], "exif_gps.jpg")
        self.assertEqual(data["format"], "JPEG")
        self.assertEqual(data["width"], 300)
        self.assertEqual(data["height"], 400)
        self.assertGreater(data["file_size_bytes"], 0)
        self.assertEqual(data["date_taken"], "2026:09:14 17:42:10")
        self.assertEqual(data["camera"], "Fujifilm X-T5")
        self.assertEqual(data["lens"], "XF 23mm F1.4")
        self.assertEqual(data["focal_length"], "23 mm")
        self.assertEqual(data["aperture"], "f/1.8")
        self.assertEqual(data["shutter_speed"], "1/250 s")
        self.assertEqual(data["iso"], 400)
        self.assertAlmostEqual(data["latitude"], 37.7749, places=3)
        self.assertAlmostEqual(data["longitude"], -122.4194, places=3)
        self.assertIn("N", data["location_label"])
        self.assertIn("W", data["location_label"])

    def test_metadata_handles_plain_png_without_exif(self) -> None:
        res = self.client.get("/api/images/metadata", headers=self._headers(), params={"path": self.plain_png})
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["filename"], "plain.png")
        self.assertEqual(data["format"], "PNG")
        self.assertEqual(data["width"], 120)
        self.assertEqual(data["height"], 80)
        self.assertIsNone(data["camera"])
        self.assertIsNone(data["latitude"])
        self.assertIsNone(data["location_label"])


if __name__ == "__main__":
    unittest.main()
