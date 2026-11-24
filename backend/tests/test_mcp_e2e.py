import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
MODELS_DIR = os.path.join(REPO_ROOT, "models")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import api  # noqa: E402
from clip_index import CLIPIndex  # noqa: E402
from db import Database  # noqa: E402
from indexer import FaissIndex  # noqa: E402
from mcp_runtime import (  # noqa: E402
    is_path_within_approved_roots,
    load_policy,
    read_audit_log,
    read_runtime_info,
    save_policy,
)
from search_engine import SearchEngine  # noqa: E402


def _make_jpeg(path: str, color=(20, 120, 220), with_exif: bool = False) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = Image.new("RGB", (320, 240), color=color)
    if with_exif:
        exif = Image.Exif()
        exif[0x010F] = "TestCamera"
        img.save(path, format="JPEG", exif=exif.tobytes())
    else:
        img.save(path, format="JPEG")


class _StubClipProcessor:
    """Deterministic unit-norm 512-d text/image embeddings for fast API tests."""

    def embed_text(self, text: str) -> np.ndarray:
        vec = np.zeros(512, dtype="float32")
        if "beach" in text.lower():
            vec[0] = 1.0
        else:
            vec[1] = 1.0
        return vec

    def embed_image(self, _path: str) -> np.ndarray:
        vec = np.zeros(512, dtype="float32")
        vec[0] = 1.0
        return vec


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
            _make_jpeg(p1)
            _make_jpeg(p2)
            _make_jpeg(p3)

            # Two occurrences of face 7 inside p1 -> distinct photo count must be 1
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

            # Merge 7 -> 3; verify redirect persists and prevents resurrection
            db.merge_faces(3, [7])
            self.assertEqual(db.resolve_face_id(7), (3, True))
            self.assertTrue(db.face_exists(7))
            self.assertFalse(db.face_exists(999))

            imgs_page_1 = db.get_images_with_face(7, limit=2, offset=0)
            imgs_page_2 = db.get_images_with_face(7, limit=2, offset=2)
            self.assertEqual(len(imgs_page_1), 2)
            self.assertEqual(len(imgs_page_2), 1)
            self.assertEqual(set(imgs_page_1 + imgs_page_2), {p1, p2, p3})

            # Inserting another occurrence with stale FAISS ID 7 resolves to 3
            p4 = os.path.join(self.photos_dir, "d.jpg")
            _make_jpeg(p4)
            db.insert_occurrences_batch([(p4, 7, (0, 0, 5, 5))])
            self.assertIn(p4, db.get_images_with_face(3))
            self.assertIsNone(db.get_face_name(999))
        finally:
            db.close()

    def test_prefiltered_search_finds_person_outside_global_topk(self):
        db = Database(os.path.join(self.data_dir, "faces.db"))
        clip_idx = CLIPIndex(os.path.join(self.data_dir, "clip.index"))
        try:
            # 60 non-Priya photos with higher beach similarity (0.95)
            for i in range(60):
                p = os.path.join(self.photos_dir, f"crowd_{i}.jpg")
                _make_jpeg(p)
                img_id = db.insert_image(p)
                vec = np.zeros(512, dtype="float32")
                vec[0] = 0.95
                vec[2] = np.sqrt(max(0.0, 1.0 - 0.95**2))
                clip_idx.add(img_id, vec)
                db.mark_clip_indexed(img_id)

            # Target photo of Priya with moderate beach similarity (0.45) — outside global top-5
            priya_beach = os.path.join(self.photos_dir, "priya_beach.jpg")
            _make_jpeg(priya_beach)
            db.insert_occurrences_batch([(priya_beach, 3, (0, 0, 10, 10))])
            db.set_face_name(3, "Priya")
            priya_id = db.get_image_id(priya_beach)
            p_vec = np.zeros(512, dtype="float32")
            p_vec[0] = 0.45
            p_vec[3] = np.sqrt(1.0 - 0.45**2)
            clip_idx.add(priya_id, p_vec)
            db.mark_clip_indexed(priya_id)

            engine = SearchEngine(db, clip_idx, _StubClipProcessor())
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

        # Reloading saved indexes succeeds cleanly
        reloaded_c = CLIPIndex(os.path.join(self.data_dir, "clip.index"))
        self.assertEqual(reloaded_c.ntotal, 39)

        # Reconcile stale clip_status entry (ID 999 is not in clip.index)
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
        _make_jpeg(inside_img)
        _make_jpeg(secret_img)

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
        # Missing bearer token -> 401
        r_unauth = self.client.get("/api/stats")
        self.assertEqual(r_unauth.status_code, 401)

        # Non-loopback Host header -> 403
        r_host = self.client.get("/api/stats", headers={**self._auth(), "Host": "evil.example.com"})
        self.assertEqual(r_host.status_code, 403)

        # Disallowed external Origin -> no allow-origin header
        r_cors_bad = self.client.get(
            "/api/stats",
            headers={**self._auth(), "Origin": "https://evil.example.com"},
        )
        self.assertNotIn("access-control-allow-origin", r_cors_bad.headers)

        # Allowed loopback Origin -> echoed
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

        # MCP endpoints gated when disabled
        self.assertEqual(self.client.get("/api/mcp/folders", headers=self._auth()).status_code, 403)

        # Enable policy except previews
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

        # Unapproved folder rejected
        r_unapproved = self.client.post(
            "/api/mcp/scan",
            json={"folder_path": self.outside_dir},
            headers=self._auth(),
        )
        self.assertEqual(r_unapproved.status_code, 403)

        # Unindexed image faces returns 404
        unindexed_img = os.path.join(self.approved_dir, "unindexed.jpg")
        _make_jpeg(unindexed_img, with_exif=True)
        r_faces_404 = self.client.get(
            "/api/images/faces",
            params={"image_path": unindexed_img},
            headers=self._auth(),
        )
        self.assertEqual(r_faces_404.status_code, 404)

        # Index an image via DB, verify preview gate & EXIF stripping
        ctrl = api.controller()
        ctrl.db.insert_image(unindexed_img)
        r_faces_empty = self.client.get(
            "/api/images/faces",
            params={"image_path": unindexed_img},
            headers=self._auth(),
        )
        self.assertEqual(r_faces_empty.status_code, 200)
        self.assertEqual(r_faces_empty.json(), {"faces": []})

        # Preview denied while allow_previews is False
        self.assertEqual(
            self.client.get("/api/mcp/preview", params={"path": unindexed_img}, headers=self._auth()).status_code,
            403,
        )

        # Enable previews and verify EXIF is stripped
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
        _make_jpeg(self.photo_path, color=(255, 140, 40), with_exif=True)
        self.outside_photo = os.path.join(self.outside_dir, "secret.jpg")
        _make_jpeg(self.outside_photo, color=(10, 10, 10))
        os.symlink(self.outside_photo, os.path.join(self.approved_dir, "symlink_out.jpg"))

    def tearDown(self) -> None:
        # Ensure any headless child spawned during test is stopped before temp cleanup
        info = read_runtime_info(self.data_dir)
        if info and info.get("port") and info.get("token"):
            import http.client

            try:
                conn = http.client.HTTPConnection("127.0.0.1", int(info["port"]), timeout=2.0)
                conn.request(
                    "POST",
                    "/api/shutdown",
                    headers={"Authorization": f"Bearer {info['token']}"},
                )
                conn.getresponse().read()
                conn.close()
                time.sleep(0.4)
            except Exception:
                pass
        self.tmp.cleanup()

    def _rpc(self, proc: subprocess.Popen, payload: dict) -> dict:
        assert proc.stdin is not None and proc.stdout is not None
        proc.stdin.write(json.dumps(payload) + "\n")
        proc.stdin.flush()
        line = proc.stdout.readline()
        self.assertTrue(line, "Expected JSON-RPC response line on stdout")
        return json.loads(line)

    def test_stdio_lifecycle_and_headless_scan_search_attach_detach(self):
        proc = subprocess.Popen(
            [
                sys.executable,
                os.path.join(BACKEND_DIR, "mcp_server.py"),
                "--data-dir",
                self.data_dir,
                "--models-dir",
                MODELS_DIR,
                "--idle-timeout",
                "60",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=REPO_ROOT,
        )
        try:
            # 1. initialize & tools/list
            init_resp = self._rpc(proc, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
            self.assertEqual(init_resp["result"]["serverInfo"]["name"], "snapsort-mcp")

            list_resp = self._rpc(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
            tool_names = {t["name"] for t in list_resp["result"]["tools"]}
            self.assertEqual(len(tool_names), 10)
            self.assertIn("scan_folder", tool_names)
            self.assertIn("get_image_preview", tool_names)

            # 2. Disabled MCP -> actionable error, adapter stays alive
            r_dis = self._rpc(
                proc,
                {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_library_stats", "arguments": {}}},
            )
            self.assertTrue(r_dis["result"]["isError"])
            self.assertIn("disabled", r_dis["result"]["content"][0]["text"].lower())
            self.assertIsNone(proc.poll())

            # 3. MCP enabled, headless disabled -> Open SnapSort message, stays alive
            save_policy(self.data_dir, {"mcp_enabled": True, "headless_enabled": False})
            r_closed = self._rpc(
                proc,
                {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "get_library_stats", "arguments": {}}},
            )
            self.assertTrue(r_closed["result"]["isError"])
            self.assertIn("Open SnapSort", r_closed["result"]["content"][0]["text"])
            self.assertIsNone(proc.poll())

            # 4. Enable full headless capability + approved folder
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

            # Unapproved folder blocked even in headless mode
            r_bad_scan = self._rpc(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 5,
                    "method": "tools/call",
                    "params": {"name": "scan_folder", "arguments": {"folder": self.outside_dir}},
                },
            )
            self.assertTrue(r_bad_scan["result"]["isError"])

            # Approved folder scan auto-spawns headless backend and skips outward symlink
            r_scan = self._rpc(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 6,
                    "method": "tools/call",
                    "params": {"name": "scan_folder", "arguments": {"folder": self.approved_dir, "wait_seconds": 30}},
                },
            )
            self.assertFalse(r_scan["result"]["isError"], r_scan["result"]["content"][0]["text"])
            scan_data = json.loads(r_scan["result"]["content"][0]["text"])
            scan_id = scan_data["scan_id"]

            # Poll if still indexing
            deadline = time.monotonic() + 25.0
            while scan_data.get("status") in ("queued", "indexing") and time.monotonic() < deadline:
                time.sleep(0.25)
                r_prog = self._rpc(
                    proc,
                    {
                        "jsonrpc": "2.0",
                        "id": 7,
                        "method": "tools/call",
                        "params": {"name": "get_scan_progress", "arguments": {"scan_id": scan_id}},
                    },
                )
                prog_payload = json.loads(r_prog["result"]["content"][0]["text"])
                scan_data = prog_payload["job"]
            self.assertEqual(scan_data["status"], "completed")
            self.assertEqual(scan_data["total_images"], 1)  # symlink_out.jpg skipped

            # Verify indexed folder images & stats
            r_folder_imgs = self._rpc(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 8,
                    "method": "tools/call",
                    "params": {"name": "list_folder_images", "arguments": {"folder": self.approved_dir}},
                },
            )
            folder_imgs = json.loads(r_folder_imgs["result"]["content"][0]["text"])["images"]
            self.assertEqual(folder_imgs, [os.path.realpath(self.photo_path)])

            # Verify semantic search works in headless mode
            r_search = self._rpc(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 9,
                    "method": "tools/call",
                    "params": {"name": "search_images", "arguments": {"query": "sunset", "folder": self.approved_dir}},
                },
            )
            self.assertFalse(r_search["result"]["isError"])

            # Verify preview returns EXIF-stripped JPEG image content
            r_prev = self._rpc(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 10,
                    "method": "tools/call",
                    "params": {"name": "get_image_preview", "arguments": {"path": self.photo_path, "max_size": 256}},
                },
            )
            self.assertFalse(r_prev["result"]["isError"])
            item = r_prev["result"]["content"][0]
            self.assertEqual(item["type"], "image")
            self.assertEqual(item["mimeType"], "image/jpeg")
            raw_prev = base64.b64decode(item["data"])
            with Image.open(io.BytesIO(raw_prev)) as img_prev:
                self.assertEqual(len(img_prev.getexif()), 0)

            # Verify audit log recorded invocations
            audit = read_audit_log(self.data_dir, limit=20)
            self.assertGreaterEqual(len(audit), 4)

            # Verify desktop attach/detach handshake against running headless backend
            info = read_runtime_info(self.data_dir)
            self.assertIsNotNone(info)
            import http.client

            conn = http.client.HTTPConnection("127.0.0.1", int(info["port"]), timeout=3.0)
            headers = {"Authorization": f"Bearer {info['token']}", "Content-Type": "application/json"}
            conn.request("POST", "/api/client/attach", body=json.dumps({"desktop_pid": os.getpid()}), headers=headers)
            attach_resp = json.loads(conn.getresponse().read().decode("utf-8"))
            self.assertEqual(attach_resp["mode"], "desktop")

            conn.request("POST", "/api/client/detach", headers={"Authorization": f"Bearer {info['token']}"})
            detach_resp = json.loads(conn.getresponse().read().decode("utf-8"))
            self.assertIn(detach_resp["action"], ("continuing_headless", "shutting_down"))
            conn.close()
        finally:
            if proc.stdin:
                proc.stdin.close()
            rc = proc.wait(timeout=10)
            self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
