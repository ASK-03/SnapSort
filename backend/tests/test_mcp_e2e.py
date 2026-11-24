import base64
import io
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TESTS_DIR not in sys.path:
    sys.path.insert(0, _TESTS_DIR)

from mcp_test_helpers import (
    BACKEND_DIR,
    MODELS_DIR,
    StdioMcpClient,
    StubClipProcessor,
    http_json,
    make_jpeg,
    shutdown_backend_from_runtime,
)

import api  # noqa: E402
from clip_index import CLIPIndex  # noqa: E402
from db import Database  # noqa: E402
from indexer import FaissIndex  # noqa: E402
from mcp_runtime import (  # noqa: E402
    is_path_within_approved_roots,
    read_audit_log,
    read_runtime_info,
    save_policy,
)
from search_engine import SearchEngine  # noqa: E402


class TestMcpUnitAndConcurrency(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = os.path.join(self.tmp.name, "data")
        self.photos_dir = os.path.join(self.tmp.name, "photos")
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.photos_dir, exist_ok=True)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_db_distinct_counts_pagination_and_merge_redirects(self):
        db = Database(os.path.join(self.data_dir, "faces.db"))
        try:
            p1 = os.path.join(self.photos_dir, "a.jpg")
            p2 = os.path.join(self.photos_dir, "b.jpg")
            p3 = os.path.join(self.photos_dir, "sub", "c.jpg")
            make_jpeg(p1)
            make_jpeg(p2)
            make_jpeg(p3)

            db.insert_occurrences_batch(
                [
                    (p1, 7, (0, 0, 10, 10)),
                    (p1, 7, (20, 20, 30, 30)),
                    (p2, 3, (0, 0, 10, 10)),
                    (p3, 7, (0, 0, 10, 10)),
                ]
            )
            db.set_face_name(3, "Priya")
            db.set_face_name(7, "Priya")

            faces_all = {f["id"]: f for f in db.get_all_faces_with_counts(name_filter="priya")}
            self.assertEqual(faces_all[7]["count"], 2)
            self.assertEqual(faces_all[3]["count"], 1)

            db.merge_faces(3, [7])
            self.assertEqual(db.resolve_face_id(7), (3, True))
            self.assertTrue(db.face_exists(7))
            self.assertFalse(db.face_exists(999))

            imgs_page_1 = db.get_images_with_face(7, limit=2, offset=0)
            imgs_page_2 = db.get_images_with_face(7, limit=2, offset=2)
            self.assertEqual(len(imgs_page_1), 2)
            self.assertEqual(len(imgs_page_2), 1)
            self.assertEqual(set(imgs_page_1 + imgs_page_2), {p1, p2, p3})

            p4 = os.path.join(self.photos_dir, "d.jpg")
            make_jpeg(p4)
            db.insert_occurrences_batch([(p4, 7, (0, 0, 5, 5))])
            self.assertIn(p4, db.get_images_with_face(3))
            self.assertIsNone(db.get_face_name(999))
        finally:
            db.close()

    def test_prefiltered_search_finds_person_outside_global_topk(self):
        db = Database(os.path.join(self.data_dir, "faces.db"))
        clip_idx = CLIPIndex(os.path.join(self.data_dir, "clip.index"))
        try:
            for i in range(60):
                p = os.path.join(self.photos_dir, f"crowd_{i}.jpg")
                make_jpeg(p)
                img_id = db.insert_image(p)
                vec = np.zeros(512, dtype="float32")
                vec[0] = 0.95
                vec[2] = np.sqrt(max(0.0, 1.0 - 0.95**2))
                clip_idx.add(img_id, vec)
                db.mark_clip_indexed(img_id)

            priya_beach = os.path.join(self.photos_dir, "priya_beach.jpg")
            make_jpeg(priya_beach)
            db.insert_occurrences_batch([(priya_beach, 3, (0, 0, 10, 10))])
            db.set_face_name(3, "Priya")
            priya_id = db.get_image_id(priya_beach)
            p_vec = np.zeros(512, dtype="float32")
            p_vec[0] = 0.45
            p_vec[3] = np.sqrt(1.0 - 0.45**2)
            clip_idx.add(priya_id, p_vec)
            db.mark_clip_indexed(priya_id)

            engine = SearchEngine(db, clip_idx, StubClipProcessor())
            global_hits = [p for p, _ in engine.search("beach", top_k=5)]
            self.assertNotIn(priya_beach, global_hits)

            person_hits = [p for p, _ in engine.search("beach", top_k=5, person_id=3)]
            self.assertEqual(person_hits, [priya_beach])
        finally:
            db.close()

    def test_concurrent_faiss_operations_and_reconcile(self):
        fidx = FaissIndex(os.path.join(self.data_dir, "faces.index"))
        cidx = CLIPIndex(os.path.join(self.data_dir, "clip.index"))
        db = Database(os.path.join(self.data_dir, "faces.db"))
        errors: list[Exception] = []

        def writer():
            try:
                for i in range(1, 40):
                    emb = np.random.RandomState(i).randn(128).astype("float32")
                    fidx.find_or_add(emb)
                    cvec = np.random.RandomState(i).randn(512).astype("float32")
                    cidx.add(i, cvec)
                    if i % 10 == 0:
                        fidx.save()
                        cidx.save()
            except Exception as exc:
                errors.append(exc)

        def reader():
            try:
                q = np.ones(512, dtype="float32")
                q /= np.linalg.norm(q)
                for _ in range(30):
                    cidx.search(q, k=10)
                    cidx.search_subset(q, {1, 5, 10, 20}, k=5)
            except Exception as exc:
                errors.append(exc)

        t1 = threading.Thread(target=writer)
        t2 = threading.Thread(target=reader)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        self.assertEqual(errors, [])
        fidx.save()
        cidx.save()

        reloaded_c = CLIPIndex(os.path.join(self.data_dir, "clip.index"))
        self.assertEqual(reloaded_c.ntotal, 39)

        db.mark_clip_indexed(999)
        removed = db.reconcile_clip_status(reloaded_c.get_all_ids())
        self.assertEqual(removed, 1)
        db.close()

    def test_approved_root_and_symlink_escape_protection(self):
        goa = os.path.join(self.photos_dir, "goa")
        goa2 = os.path.join(self.photos_dir, "goa2")
        outside = os.path.join(self.tmp.name, "secret")
        os.makedirs(goa, exist_ok=True)
        os.makedirs(goa2, exist_ok=True)
        os.makedirs(outside, exist_ok=True)

        inside_img = os.path.join(goa, "sunset.jpg")
        secret_img = os.path.join(outside, "private.jpg")
        make_jpeg(inside_img)
        make_jpeg(secret_img)

        escape_link = os.path.join(goa, "escape.jpg")
        os.symlink(secret_img, escape_link)

        roots = [goa]
        self.assertTrue(is_path_within_approved_roots(inside_img, roots))
        self.assertFalse(is_path_within_approved_roots(goa2, roots))
        self.assertFalse(is_path_within_approved_roots(escape_link, roots))


class TestFastApiSecurityAndEndpoints(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = os.path.join(self.tmp.name, "data")
        self.approved_dir = os.path.join(self.tmp.name, "approved")
        self.outside_dir = os.path.join(self.tmp.name, "outside")
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.approved_dir, exist_ok=True)
        os.makedirs(self.outside_dir, exist_ok=True)

        self.token = "test-secret-token-123456"
        self.instance_id = "inst-test-001"
        self.env_patch = patch.dict(
            os.environ,
            {
                "SNAPSORT_DATA_DIR": self.data_dir,
                "SNAPSORT_MODELS_DIR": MODELS_DIR,
                "SNAPSORT_API_TOKEN": self.token,
                "SNAPSORT_INSTANCE_ID": self.instance_id,
                "SNAPSORT_HEADLESS": "0",
            },
        )
        self.env_patch.start()
        self.client_cm = TestClient(api.app)
        self.client = self.client_cm.__enter__()

    def tearDown(self) -> None:
        self.client_cm.__exit__(None, None, None)
        self.env_patch.stop()
        self.tmp.cleanup()

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def test_auth_host_and_cors_enforcement(self):
        self.assertEqual(self.client.get("/api/stats").status_code, 401)
        self.assertEqual(
            self.client.get("/api/stats", headers={**self._auth(), "Host": "evil.example.com"}).status_code,
            403,
        )
        r_cors_bad = self.client.get(
            "/api/stats",
            headers={**self._auth(), "Origin": "https://evil.example.com"},
        )
        self.assertNotIn("access-control-allow-origin", r_cors_bad.headers)

        r_cors_ok = self.client.get(
            "/api/stats",
            headers={**self._auth(), "Origin": "http://localhost:5173"},
        )
        self.assertEqual(r_cors_ok.status_code, 200)
        self.assertEqual(r_cors_ok.headers.get("access-control-allow-origin"), "http://localhost:5173")

    def test_zero_new_images_scan_and_policy_gates(self):
        empty_dir = os.path.join(self.approved_dir, "empty")
        os.makedirs(empty_dir, exist_ok=True)
        r_scan = self.client.post("/api/scan", json={"folder_path": empty_dir}, headers=self._auth())
        self.assertEqual(r_scan.status_code, 200)
        self.assertEqual(r_scan.json()["status"], "completed")
        self.assertEqual(r_scan.json()["new_images"], 0)

        r_prog = self.client.get("/api/progress", headers=self._auth())
        self.assertFalse(r_prog.json()["is_scanning"])

        self.assertEqual(self.client.get("/api/mcp/folders", headers=self._auth()).status_code, 403)

        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "allow_agent_scan": True,
                "allow_previews": False,
                "approved_roots": [self.approved_dir],
            },
        )
        self.assertEqual(self.client.post("/api/mcp/policy/sync", headers=self._auth()).status_code, 200)
        self.assertIsNotNone(read_runtime_info(self.data_dir))

        r_unapproved = self.client.post(
            "/api/mcp/scan",
            json={"folder_path": self.outside_dir},
            headers=self._auth(),
        )
        self.assertEqual(r_unapproved.status_code, 403)

        unindexed_img = os.path.join(self.approved_dir, "unindexed.jpg")
        make_jpeg(unindexed_img, with_exif=True)
        self.assertEqual(
            self.client.get("/api/images/faces", params={"image_path": unindexed_img}, headers=self._auth()).status_code,
            404,
        )

        ctrl = api.controller()
        ctrl.db.insert_image(unindexed_img)
        r_faces_empty = self.client.get(
            "/api/images/faces",
            params={"image_path": unindexed_img},
            headers=self._auth(),
        )
        self.assertEqual(r_faces_empty.status_code, 200)
        self.assertEqual(r_faces_empty.json(), {"faces": []})

        self.assertEqual(
            self.client.get("/api/mcp/preview", params={"path": unindexed_img}, headers=self._auth()).status_code,
            403,
        )

        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "allow_agent_scan": True,
                "allow_previews": True,
                "approved_roots": [self.approved_dir],
            },
        )
        r_prev = self.client.get(
            "/api/mcp/preview",
            params={"path": unindexed_img, "max_size": 256},
            headers=self._auth(),
        )
        self.assertEqual(r_prev.status_code, 200)
        with Image.open(io.BytesIO(r_prev.content)) as prev_img:
            self.assertLessEqual(max(prev_img.size), 256)
            self.assertEqual(len(prev_img.getexif()), 0)


class TestStdioMcpSubprocessHeadless(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = os.path.join(self.tmp.name, "data")
        self.approved_dir = os.path.join(self.tmp.name, "approved")
        self.outside_dir = os.path.join(self.tmp.name, "outside")
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.approved_dir, exist_ok=True)
        os.makedirs(self.outside_dir, exist_ok=True)

        self.photo_path = os.path.join(self.approved_dir, "ocean_sunset.jpg")
        make_jpeg(self.photo_path, color=(255, 140, 40), with_exif=True, with_gps=True)
        self.outside_photo = os.path.join(self.outside_dir, "secret.jpg")
        make_jpeg(self.outside_photo, color=(10, 10, 10))
        os.symlink(self.outside_photo, os.path.join(self.approved_dir, "symlink_out.jpg"))

    def tearDown(self) -> None:
        shutdown_backend_from_runtime(self.data_dir)
        self.tmp.cleanup()

    def test_stdio_lifecycle_instructions_annotations_and_headless_e2e(self):
        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as client:
            init_resp = client.initialize()
            result = init_resp["result"]
            self.assertEqual(result["serverInfo"]["name"], "snapsort-mcp")
            instructions = result.get("instructions", "")
            self.assertIn("list_people", instructions)
            self.assertIn("list_approved_folders", instructions)

            tools = client.list_tools()
            self.assertEqual(len(tools), 10)
            tools_by_name = {t["name"]: t for t in tools}
            for name, tool in tools_by_name.items():
                ann = tool.get("annotations")
                self.assertIsInstance(ann, dict, f"Missing annotations on {name}")
                self.assertFalse(ann["destructiveHint"])
                if name == "scan_folder":
                    self.assertFalse(ann["readOnlyHint"])
                else:
                    self.assertTrue(ann["readOnlyHint"])

            # Disabled MCP -> actionable error, adapter stays alive
            r_dis = client.call_tool("get_library_stats")
            self.assertTrue(r_dis["isError"])
            self.assertIn("disabled", r_dis["content"][0]["text"].lower())

            # MCP enabled, headless disabled -> Open SnapSort message, stays alive
            save_policy(self.data_dir, {"mcp_enabled": True, "headless_enabled": False})
            r_closed = client.call_tool("get_library_stats")
            self.assertTrue(r_closed["isError"])
            self.assertIn("Open SnapSort", r_closed["content"][0]["text"])

            # Enable full headless capability + approved folder
            save_policy(
                self.data_dir,
                {
                    "mcp_enabled": True,
                    "headless_enabled": True,
                    "allow_agent_scan": True,
                    "allow_previews": True,
                    "approved_roots": [self.approved_dir],
                },
            )

            r_bad_scan = client.call_tool("scan_folder", {"folder": self.outside_dir})
            self.assertTrue(r_bad_scan["isError"])

            r_scan = client.call_tool("scan_folder", {"folder": self.approved_dir, "wait_seconds": 30})
            self.assertFalse(r_scan["isError"], r_scan["content"][0]["text"])
            scan_data = json.loads(r_scan["content"][0]["text"])
            scan_id = scan_data["scan_id"]

            deadline = time.monotonic() + 25.0
            while scan_data.get("status") in ("queued", "indexing") and time.monotonic() < deadline:
                time.sleep(0.25)
                r_prog = client.call_tool("get_scan_progress", {"scan_id": scan_id})
                scan_data = json.loads(r_prog["content"][0]["text"])["job"]
            self.assertEqual(scan_data["status"], "completed")
            self.assertEqual(scan_data["total_images"], 1)

            r_folder_imgs = client.call_tool("list_folder_images", {"folder": self.approved_dir})
            folder_imgs = json.loads(r_folder_imgs["content"][0]["text"])["images"]
            self.assertEqual(folder_imgs, [os.path.realpath(self.photo_path)])

            r_search = client.call_tool("search_images", {"query": "sunset", "folder": self.approved_dir})
            self.assertFalse(r_search["isError"])

            r_prev = client.call_tool("get_image_preview", {"path": self.photo_path, "max_size": 256})
            self.assertFalse(r_prev["isError"])
            item = r_prev["content"][0]
            self.assertEqual(item["type"], "image")
            self.assertEqual(item["mimeType"], "image/jpeg")
            raw_prev = base64.b64decode(item["data"])
            with Image.open(io.BytesIO(raw_prev)) as img_prev:
                self.assertEqual(len(img_prev.getexif()), 0)

            audit = read_audit_log(self.data_dir, limit=20)
            self.assertGreaterEqual(len(audit), 4)

            info = read_runtime_info(self.data_dir)
            self.assertIsNotNone(info)
            _, attach_resp = http_json(
                int(info["port"]),
                str(info["token"]),
                "POST",
                "/api/client/attach",
                {"desktop_pid": os.getpid()},
            )
            self.assertEqual(attach_resp["mode"], "desktop")

            _, detach_resp = http_json(int(info["port"]), str(info["token"]), "POST", "/api/client/detach")
            self.assertIn(detach_resp["action"], ("continuing_headless", "shutting_down"))

            rc = client.close()
            self.assertEqual(rc, 0)
            self.assertEqual(client.non_json_stdout_lines, [])


if __name__ == "__main__":
    unittest.main()
