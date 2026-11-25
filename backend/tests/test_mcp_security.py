import io
import json
import os
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TESTS_DIR not in sys.path:
    sys.path.insert(0, _TESTS_DIR)

from mcp_test_helpers import (  # noqa: E402
    MODELS_DIR,
    StdioMcpClient,
    http_json,
    make_jpeg,
    shutdown_backend_from_runtime,
    spawn_backend_process,
    wait_for_runtime_ready,
)

import api  # noqa: E402
import mcp_runtime  # noqa: E402
import mcp_server  # noqa: E402
from mcp_runtime import (  # noqa: E402
    append_audit_log,
    audit_file_path,
    load_policy,
    policy_file_path,
    read_audit_log,
    read_runtime_info,
    runtime_file_path,
    save_policy,
)


class TestMcpSecurityAndPrivacy(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = os.path.join(self.tmp.name, "data")
        self.approved_root = os.path.join(self.tmp.name, "approved")
        self.goa_dir = os.path.join(self.approved_root, "goa")
        self.goa2_dir = os.path.join(self.approved_root, "goa2")
        self.outside_dir = os.path.join(self.tmp.name, "outside")
        for d in (self.data_dir, self.goa_dir, self.goa2_dir, self.outside_dir):
            os.makedirs(d, exist_ok=True)
        self.token = "super-secret-bearer-token-xyz"
        self.instance_id = "inst-sec-001"
        self._procs: list = []

    def tearDown(self) -> None:
        shutdown_backend_from_runtime(self.data_dir)
        for p in self._procs:
            try:
                if p.poll() is None:
                    p.terminate()
                    p.wait(timeout=5)
            except Exception:
                pass
            for stream in (p.stdout, p.stderr):
                try:
                    if stream:
                        stream.close()
                except Exception:
                    pass
        self.tmp.cleanup()

    def _test_client(self) -> tuple[patch, TestClient]:
        env_patch = patch.dict(
            os.environ,
            {
                "SNAPSORT_DATA_DIR": self.data_dir,
                "SNAPSORT_MODELS_DIR": MODELS_DIR,
                "SNAPSORT_API_TOKEN": self.token,
                "SNAPSORT_INSTANCE_ID": self.instance_id,
                "SNAPSORT_HEADLESS": "0",
            },
        )
        env_patch.start()
        tc = TestClient(api.app)
        tc.__enter__()
        return env_patch, tc

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def test_auth_host_and_cors_matrix(self):
        env_patch, client = self._test_client()
        try:
            self.assertEqual(client.get("/api/stats").status_code, 401)
            self.assertEqual(client.get("/api/stats", headers={"Authorization": "Basic abc"}).status_code, 401)
            self.assertEqual(client.get("/api/stats", headers={"Authorization": "Bearer wrong"}).status_code, 401)
            self.assertEqual(client.get("/media/image", params={"path": "/tmp/x.jpg"}).status_code, 401)

            r_bad_host = client.get("/api/stats", headers={**self._auth(), "Host": "attacker.com"})
            self.assertEqual(r_bad_host.status_code, 403)

            r_bad_origin = client.get("/api/stats", headers={**self._auth(), "Origin": "https://evil.com"})
            self.assertNotIn("access-control-allow-origin", r_bad_origin.headers)

            r_ok_origin = client.get("/api/stats", headers={**self._auth(), "Origin": "http://localhost:5173"})
            self.assertEqual(r_ok_origin.status_code, 200)
            self.assertEqual(r_ok_origin.headers.get("access-control-allow-origin"), "http://localhost:5173")

            r_preflight = client.options(
                "/api/stats",
                headers={
                    "Origin": "http://localhost:5173",
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "Authorization",
                },
            )
            self.assertEqual(r_preflight.status_code, 200)
        finally:
            client.__exit__(None, None, None)
            env_patch.stop()

    def test_owner_only_file_permissions(self):
        save_policy(self.data_dir, {"mcp_enabled": True, "approved_roots": [self.goa_dir]})
        append_audit_log(self.data_dir, "get_library_stats", {}, ok=True)
        env_patch, client = self._test_client()
        try:
            self.assertEqual(client.post("/api/mcp/policy/sync", headers=self._auth()).status_code, 200)
            if os.name == "posix":
                for p in (
                    policy_file_path(self.data_dir),
                    runtime_file_path(self.data_dir),
                    audit_file_path(self.data_dir),
                ):
                    mode = stat.S_IMODE(os.stat(p).st_mode)
                    self.assertEqual(mode, 0o600, f"Expected 0600 on {p}, got {oct(mode)}")
        finally:
            client.__exit__(None, None, None)
            env_patch.stop()

    def test_policy_immutability_over_http_and_mcp(self):
        tool_names = {t["name"] for t in mcp_server.TOOLS_SCHEMA}
        for forbidden in ("set_policy", "add_approved_folder", "update_policy", "delete_file", "rename_face", "merge_faces"):
            self.assertNotIn(forbidden, tool_names)

        save_policy(self.data_dir, {"mcp_enabled": False, "approved_roots": [self.goa_dir]})
        env_patch, client = self._test_client()
        try:
            r = client.post(
                "/api/mcp/policy/sync",
                json={"mcp_enabled": True, "approved_roots": [self.outside_dir]},
                headers=self._auth(),
            )
            self.assertEqual(r.status_code, 200)
            persisted = load_policy(self.data_dir)
            self.assertFalse(persisted["mcp_enabled"])
            self.assertEqual(persisted["approved_roots"], [os.path.realpath(self.goa_dir)])
        finally:
            client.__exit__(None, None, None)
            env_patch.stop()

    def test_path_traversal_sibling_prefix_and_symlink_escapes(self):
        outside_img = os.path.join(self.outside_dir, "secret.jpg")
        goa2_img = os.path.join(self.goa2_dir, "sibling.jpg")
        make_jpeg(outside_img)
        make_jpeg(goa2_img)

        nested_dir_link = os.path.join(self.goa_dir, "linked_outside_dir")
        file_link = os.path.join(self.goa_dir, "linked_secret.jpg")
        os.symlink(self.outside_dir, nested_dir_link)
        os.symlink(outside_img, file_link)

        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "allow_agent_scan": True,
                "allow_previews": True,
                "approved_roots": [self.goa_dir],
            },
        )

        env_patch, client = self._test_client()
        try:
            ctrl = api.controller()
            ctrl.db.insert_image(outside_img)
            ctrl.db.insert_image(goa2_img)

            traversal = os.path.join(self.goa_dir, "..", "..", "outside")
            for bad_folder in (traversal, self.goa2_dir, nested_dir_link, self.outside_dir):
                self.assertEqual(
                    client.get("/api/mcp/folders/images", params={"folder": bad_folder}, headers=self._auth()).status_code,
                    403,
                )
                self.assertEqual(
                    client.post("/api/mcp/scan", json={"folder_path": bad_folder}, headers=self._auth()).status_code,
                    403,
                )

            for bad_img in (outside_img, goa2_img, file_link):
                r_prev = client.get("/api/mcp/preview", params={"path": bad_img}, headers=self._auth())
                self.assertIn(r_prev.status_code, (403, 404))
        finally:
            client.__exit__(None, None, None)
            env_patch.stop()

    def test_exif_gps_stripping_size_clamp_and_preview_rate_limit(self):
        big_img = os.path.join(self.goa_dir, "gps_big.jpg")
        make_jpeg(big_img, size=(2400, 1600), with_exif=True, with_gps=True)
        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "allow_previews": True,
                "approved_roots": [self.goa_dir],
            },
        )

        env_patch, client = self._test_client()
        try:
            ctrl = api.controller()
            ctrl.db.insert_image(big_img)

            r_prev = client.get(
                "/api/mcp/preview",
                params={"path": big_img, "max_size": 4096},
                headers=self._auth(),
            )
            self.assertEqual(r_prev.status_code, 200)
            with Image.open(io.BytesIO(r_prev.content)) as prev_img:
                self.assertLessEqual(max(prev_img.size), 1024)
                self.assertEqual(len(prev_img.getexif()), 0)

            # Default max_preview_images is 5 within 60s -> 6th call is rate-limited (429)
            for _ in range(4):
                self.assertEqual(
                    client.get("/api/mcp/preview", params={"path": big_img, "max_size": 512}, headers=self._auth()).status_code,
                    200,
                )
            r_429 = client.get("/api/mcp/preview", params={"path": big_img, "max_size": 512}, headers=self._auth())
            self.assertEqual(r_429.status_code, 429)
            self.assertIn("max 5 images", r_429.json()["detail"])
        finally:
            client.__exit__(None, None, None)
            env_patch.stop()

    def test_missing_file_and_unmounted_folder_handling(self):
        img = os.path.join(self.goa_dir, "disappearing.jpg")
        make_jpeg(img)
        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "allow_agent_scan": True,
                "allow_previews": True,
                "approved_roots": [self.goa_dir],
            },
        )

        env_patch, client = self._test_client()
        try:
            ctrl = api.controller()
            ctrl.db.insert_image(img)
            os.unlink(img)

            self.assertEqual(client.get("/media/image", params={"path": img}, headers=self._auth()).status_code, 404)
            self.assertEqual(client.get("/media/preview", params={"path": img}, headers=self._auth()).status_code, 404)
            self.assertEqual(client.get("/api/mcp/preview", params={"path": img}, headers=self._auth()).status_code, 404)

            missing_sub = os.path.join(self.goa_dir, "unmounted_drive")
            r_unmounted = client.post("/api/mcp/scan", json={"folder_path": missing_sub}, headers=self._auth())
            self.assertEqual(r_unmounted.status_code, 400)
            self.assertEqual(client.get("/api/stats", headers=self._auth()).json()["photos"], 1)
        finally:
            client.__exit__(None, None, None)
            env_patch.stop()

    def test_audit_log_hygiene_and_rotation(self):
        with patch.object(mcp_runtime, "AUDIT_MAX_BYTES", 300):
            for i in range(12):
                append_audit_log(
                    self.data_dir,
                    "search_images",
                    {"query": f"sunset_{i}", "count": i},
                    ok=True,
                )
        log_path = audit_file_path(self.data_dir)
        rotated_path = f"{log_path}.1"
        self.assertTrue(os.path.exists(log_path))
        self.assertTrue(os.path.exists(rotated_path))

        raw_log = open(log_path, "r", encoding="utf-8").read()
        self.assertNotIn(self.token, raw_log)
        self.assertNotIn("data:image", raw_log)
        entries = read_audit_log(self.data_dir, limit=10)
        self.assertGreaterEqual(len(entries), 1)
        self.assertEqual(entries[0]["tool"], "search_images")

    def test_instant_revoke_invalidates_token_and_stops_headless(self):
        save_policy(self.data_dir, {"mcp_enabled": True, "headless_enabled": True})
        proc, port = spawn_backend_process(
            self.data_dir,
            MODELS_DIR,
            token="revoke-me-token",
            instance_id="inst-revoke",
            headless=True,
        )
        self._procs.append(proc)
        wait_for_runtime_ready(self.data_dir, expected_instance_id="inst-revoke")

        st_ok, _ = http_json(port, "revoke-me-token", "GET", "/api/status")
        self.assertEqual(st_ok, 200)

        st_rev, rev_data = http_json(port, "revoke-me-token", "POST", "/api/mcp/revoke")
        self.assertEqual(st_rev, 200)
        self.assertEqual(rev_data["status"], "stopping_headless")

        rc = proc.wait(timeout=10)
        self.assertEqual(rc, 0)
        self.assertIsNone(read_runtime_info(self.data_dir))

    def test_preview_requires_explicit_user_confirmation_and_forbids_local_fallback(self):
        img = os.path.join(self.goa_dir, "private_photo.jpg")
        make_jpeg(img)
        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "allow_previews": True,
                "approved_roots": [self.goa_dir],
            },
        )
        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as client:
            client.initialize()

            r_missing = client.call_tool("get_image_preview", {"path": img})
            self.assertTrue(r_missing["isError"])
            self.assertIn("Permission required", r_missing["content"][0]["text"])

            r_false = client.call_tool("get_image_preview", {"path": img, "user_confirmed_preview": False})
            self.assertTrue(r_false["isError"])
            self.assertIn("Permission required", r_false["content"][0]["text"])

            # Even when user_confirmed_preview is True, disabled Settings blocks preview & forbids local read
            save_policy(
                self.data_dir,
                {
                    "mcp_enabled": True,
                    "headless_enabled": True,
                    "allow_previews": False,
                    "approved_roots": [self.goa_dir],
                },
            )
            r_disabled = client.call_tool("get_image_preview", {"path": img, "user_confirmed_preview": True})
            self.assertTrue(r_disabled["isError"])
            self.assertIn("Do NOT open or read this image path", r_disabled["content"][0]["text"])

    def test_approved_folders_empty_and_missing_guidance(self):
        save_policy(self.data_dir, {"mcp_enabled": True, "approved_roots": []})
        env_patch, client = self._test_client()
        try:
            r_none = client.get("/api/mcp/folders", headers=self._auth())
            self.assertEqual(r_none.status_code, 200)
            d_none = r_none.json()
            self.assertEqual(d_none["status"], "no_approved_folders")
            self.assertIn("Add Folder", d_none["action_required"])

            empty_dir = os.path.join(self.goa_dir, "empty_sub")
            os.makedirs(empty_dir, exist_ok=True)
            save_policy(self.data_dir, {"mcp_enabled": True, "approved_roots": [empty_dir]})

            r_empty = client.get("/api/mcp/folders", headers=self._auth())
            self.assertEqual(r_empty.status_code, 200)
            d_empty = r_empty.json()
            self.assertEqual(d_empty["status"], "no_images_in_approved_folders")
            self.assertTrue(d_empty["action_required"])

            r_imgs = client.get("/api/mcp/folders/images", params={"folder": empty_dir}, headers=self._auth())
            self.assertEqual(r_imgs.status_code, 200)
            d_imgs = r_imgs.json()
            self.assertEqual(d_imgs["images"], [])
            self.assertEqual(d_imgs["status"], "empty_folder")
            self.assertTrue(d_imgs["action_required"])
        finally:
            client.__exit__(None, None, None)
            env_patch.stop()

    def test_viewer_open_security_gates_and_launch_policy(self):
        img = os.path.join(self.goa_dir, "viewer_photo.jpg")
        outside_img = os.path.join(self.outside_dir, "outside.jpg")
        make_jpeg(img)
        make_jpeg(outside_img)

        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "allow_viewer_open": False,
                "allow_launch_desktop": False,
                "approved_roots": [self.goa_dir],
            },
        )
        env_patch, client = self._test_client()
        try:
            ctrl = api.controller()
            ctrl.db.insert_image(img)
            ctrl.db.insert_image(outside_img)

            r_disabled = client.post(
                "/api/mcp/viewer/open",
                json={"paths": [img], "query": "test"},
                headers=self._auth(),
            )
            self.assertEqual(r_disabled.status_code, 403)

            save_policy(
                self.data_dir,
                {
                    "mcp_enabled": True,
                    "headless_enabled": True,
                    "allow_viewer_open": True,
                    "allow_launch_desktop": False,
                    "approved_roots": [self.goa_dir],
                },
            )
            r_outside = client.post(
                "/api/mcp/viewer/open",
                json={"paths": [outside_img]},
                headers=self._auth(),
            )
            self.assertEqual(r_outside.status_code, 403)

            r_too_many = client.post(
                "/api/mcp/viewer/open",
                json={"paths": [img] * 21},
                headers=self._auth(),
            )
            self.assertEqual(r_too_many.status_code, 400)
        finally:
            client.__exit__(None, None, None)
            env_patch.stop()

        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as mcp:
            mcp.initialize()
            r_launch_denied = mcp.call_tool(
                "open_in_viewer",
                {"paths": [img], "query": "test", "launch_app": True},
            )
            self.assertTrue(r_launch_denied["isError"])
            self.assertIn("disabled", r_launch_denied["content"][0]["text"].lower())


if __name__ == "__main__":
    unittest.main()
