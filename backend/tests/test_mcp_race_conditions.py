import json
import os
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TESTS_DIR not in sys.path:
    sys.path.insert(0, _TESTS_DIR)

from mcp_test_helpers import (
    MODELS_DIR,
    StdioMcpClient,
    find_free_port,
    http_json,
    make_jpeg,
    shutdown_backend_from_runtime,
    spawn_backend_process,
    wait_for_runtime_ready,
)

import api  # noqa: E402
from mcp_runtime import (  # noqa: E402
    read_runtime_info,
    remove_runtime_info_if_matches,
    save_policy,
    write_runtime_info,
)


class TestMcpRaceConditions(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = os.path.join(self.tmp.name, "data")
        self.approved_dir = os.path.join(self.tmp.name, "approved")
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.approved_dir, exist_ok=True)
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

    def test_thundering_herd_headless_cold_start(self):
        save_policy(self.data_dir, {"mcp_enabled": True, "headless_enabled": True})
        barrier = threading.Barrier(3)
        results: list[dict] = []
        errors: list[Exception] = []
        lock = threading.Lock()

        def run_client():
            try:
                with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as client:
                    client.initialize()
                    barrier.wait(timeout=10)
                    res = client.call_tool("get_library_overview")
                    with lock:
                        results.append(res)
            except Exception as exc:
                with lock:
                    errors.append(exc)

        threads = [threading.Thread(target=run_client) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=40)

        self.assertEqual(errors, [])
        self.assertEqual(len(results), 3)
        for res in results:
            self.assertFalse(res["isError"], res)
            payload = json.loads(res["content"][0]["text"])
            self.assertEqual(payload["stats"]["photos"], 0)

        info = read_runtime_info(self.data_dir)
        self.assertIsNotNone(info)
        status, status_data = http_json(int(info["port"]), str(info["token"]), "GET", "/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(status_data["instance_id"], info["instance_id"])

    def test_dual_backend_lock_prevents_second_instance(self):
        save_policy(self.data_dir, {"mcp_enabled": True, "headless_enabled": True})
        proc1, port1 = spawn_backend_process(
            self.data_dir,
            MODELS_DIR,
            token="tok-1",
            instance_id="inst-1",
            headless=True,
        )
        self._procs.append(proc1)
        info1 = wait_for_runtime_ready(self.data_dir, expected_instance_id="inst-1")

        port2 = find_free_port()
        while port2 == port1:
            port2 = find_free_port()
        proc2, _ = spawn_backend_process(
            self.data_dir,
            MODELS_DIR,
            port=port2,
            token="tok-2",
            instance_id="inst-2",
            headless=True,
        )
        self._procs.append(proc2)
        rc2 = proc2.wait(timeout=15)
        self.assertNotEqual(rc2, 0)

        info_after = read_runtime_info(self.data_dir)
        self.assertIsNotNone(info_after)
        self.assertEqual(info_after["instance_id"], info1["instance_id"])
        status, _ = http_json(port1, "tok-1", "GET", "/api/status")
        self.assertEqual(status, 200)

    def test_live_search_and_reads_during_active_scan(self):
        for i in range(30):
            make_jpeg(os.path.join(self.approved_dir, f"img_{i:02d}.jpg"), color=(i * 7 % 255, 100, 180))

        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "allow_agent_scan": True,
                "approved_roots": [self.approved_dir],
            },
        )

        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as client:
            client.initialize()
            scan_res = client.call_tool("scan_folder", {"folder": self.approved_dir, "wait_seconds": 0})
            self.assertFalse(scan_res["isError"], scan_res)
            scan_data = json.loads(scan_res["content"][0]["text"])
            scan_id = scan_data["scan_id"]

            info = read_runtime_info(self.data_dir)
            self.assertIsNotNone(info)
            port = int(info["port"])
            token = str(info["token"])

            stop_event = threading.Event()
            reader_errors: list[str] = []
            lock = threading.Lock()

            def reader_worker(idx: int):
                queries = ["sunset", "ocean", "blue", "photo"]
                while not stop_event.is_set():
                    try:
                        s1, d1 = http_json(port, token, "GET", f"/api/search?q={queries[idx % 4]}&include_meta=true")
                        if s1 != 200 or "results" not in d1:
                            with lock:
                                reader_errors.append(f"search failed: {s1} {d1}")
                        s2, _ = http_json(port, token, "GET", "/api/faces")
                        if s2 != 200:
                            with lock:
                                reader_errors.append(f"faces failed: {s2}")
                        s3, _ = http_json(port, token, "GET", "/api/stats")
                        if s3 != 200:
                            with lock:
                                reader_errors.append(f"stats failed: {s3}")
                    except Exception as exc:
                        with lock:
                            reader_errors.append(str(exc))
                    time.sleep(0.05)

            readers = [threading.Thread(target=reader_worker, args=(i,)) for i in range(4)]
            for r in readers:
                r.start()

            deadline = time.monotonic() + 45.0
            while scan_data.get("status") in ("queued", "indexing") and time.monotonic() < deadline:
                time.sleep(0.2)
                prog = client.call_tool("get_scan_progress", {"scan_id": scan_id})
                scan_data = json.loads(prog["content"][0]["text"])["job"]

            stop_event.set()
            for r in readers:
                r.join(timeout=5)

            self.assertEqual(reader_errors, [])
            self.assertEqual(scan_data["status"], "completed")
            ov_res = json.loads(client.call_tool("get_library_overview")["content"][0]["text"])
            self.assertEqual(ov_res["stats"]["photos"], 30)
            self.assertFalse(ov_res["stats"]["indexing_in_progress"])

    def test_concurrent_scan_deduplication_and_serialized_queue(self):
        dir_a = os.path.join(self.approved_dir, "trip_a")
        dir_b = os.path.join(self.approved_dir, "trip_b")
        for i in range(6):
            make_jpeg(os.path.join(dir_a, f"a_{i}.jpg"), color=(10 + i * 10, 80, 120))
            make_jpeg(os.path.join(dir_b, f"b_{i}.jpg"), color=(120, 80, 10 + i * 10))

        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "allow_agent_scan": True,
                "approved_roots": [self.approved_dir],
            },
        )
        proc, port = spawn_backend_process(self.data_dir, MODELS_DIR, token="tok-queue", instance_id="inst-q")
        self._procs.append(proc)
        wait_for_runtime_ready(self.data_dir, expected_instance_id="inst-q")

        # Launch 2 concurrent scans of dir_a -> must deduplicate when both reach active/queued state
        barrier = threading.Barrier(2)
        dup_ids: list[str] = []
        lock = threading.Lock()

        def scan_a():
            barrier.wait(timeout=5)
            st, data = http_json(port, "tok-queue", "POST", "/api/mcp/scan", {"folder_path": dir_a, "wait_seconds": 0})
            self.assertEqual(st, 200)
            with lock:
                dup_ids.append(data["scan_id"])

        t1 = threading.Thread(target=scan_a)
        t2 = threading.Thread(target=scan_a)
        t1.start()
        t2.start()
        t1.join(timeout=15)
        t2.join(timeout=15)
        self.assertEqual(len(dup_ids), 2)
        self.assertEqual(dup_ids[0], dup_ids[1])

        st_b, data_b = http_json(port, "tok-queue", "POST", "/api/mcp/scan", {"folder_path": dir_b, "wait_seconds": 0})
        self.assertEqual(st_b, 200)

        deadline = time.monotonic() + 45.0
        while time.monotonic() < deadline:
            _, prog_a = http_json(port, "tok-queue", "GET", f"/api/progress?scan_id={dup_ids[0]}")
            _, prog_b = http_json(port, "tok-queue", "GET", f"/api/progress?scan_id={data_b['scan_id']}")
            if prog_a["job"]["status"] == "completed" and prog_b["job"]["status"] == "completed":
                break
            time.sleep(0.25)

        self.assertEqual(prog_a["job"]["status"], "completed")
        self.assertEqual(prog_b["job"]["status"], "completed")
        _, stats = http_json(port, "tok-queue", "GET", "/api/stats")
        self.assertEqual(stats["photos"], 12)

    def test_mid_scan_face_merge_redirect_prevents_resurrection(self):
        p1 = os.path.join(self.approved_dir, "m1.jpg")
        p2 = os.path.join(self.approved_dir, "m2.jpg")
        p3 = os.path.join(self.approved_dir, "m3.jpg")
        make_jpeg(p1)
        make_jpeg(p2)
        make_jpeg(p3)

        with patch.dict(
            os.environ,
            {
                "SNAPSORT_DATA_DIR": self.data_dir,
                "SNAPSORT_MODELS_DIR": MODELS_DIR,
                "SNAPSORT_API_TOKEN": "tok-merge",
                "SNAPSORT_INSTANCE_ID": "inst-merge",
                "SNAPSORT_HEADLESS": "0",
            },
        ):
            with TestClient(api.app) as client:
                ctrl = api.controller()
                ctrl.db.insert_occurrences_batch([(p1, 10, (0, 0, 10, 10)), (p2, 11, (0, 0, 10, 10))])
                ctrl.db.set_face_name(10, "Asha")

                headers = {"Authorization": "Bearer tok-merge"}
                r_merge = client.post(
                    "/api/faces/merge",
                    json={"primary_id": 10, "other_ids": [11]},
                    headers=headers,
                )
                self.assertEqual(r_merge.status_code, 200)

                r_imgs = client.get("/api/faces/11/images", headers=headers)
                self.assertEqual(r_imgs.status_code, 200)
                body = r_imgs.json()
                self.assertEqual(body["face_id"], 10)
                self.assertEqual(body["merged_from"], 11)
                self.assertEqual(set(body["images"]), {p1, p2})

                r_search = client.get(
                    "/api/search",
                    params={"q": "photo", "person_id": 11, "include_meta": "true"},
                    headers=headers,
                )
                self.assertEqual(r_search.status_code, 200)
                self.assertEqual(r_search.json()["query"], "photo")

                # Simulated subsequent scan encountering stale FAISS cluster 11
                ctrl.db.insert_occurrences_batch([(p3, 11, (0, 0, 10, 10))])
                self.assertIn(p3, ctrl.db.get_images_with_face(10))
                self.assertEqual(ctrl.db.get_all_faces_with_counts(), [{"id": 10, "name": "Asha", "count": 3}])

    def test_compare_and_delete_discovery_file_race(self):
        write_runtime_info(self.data_dir, {"instance_id": "instance-new", "port": 12345})
        self.assertFalse(remove_runtime_info_if_matches(self.data_dir, "instance-old"))
        self.assertIsNotNone(read_runtime_info(self.data_dir))
        self.assertTrue(remove_runtime_info_if_matches(self.data_dir, "instance-new"))
        self.assertIsNone(read_runtime_info(self.data_dir))

    def test_desktop_attach_and_detach_mid_headless_scan(self):
        for i in range(20):
            make_jpeg(os.path.join(self.approved_dir, f"d_{i:02d}.jpg"), color=(50, i * 11 % 255, 200))

        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "allow_agent_scan": True,
                "approved_roots": [self.approved_dir],
            },
        )

        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as client:
            client.initialize()
            scan_res = client.call_tool("scan_folder", {"folder": self.approved_dir, "wait_seconds": 0})
            scan_id = json.loads(scan_res["content"][0]["text"])["scan_id"]

            info = read_runtime_info(self.data_dir)
            port = int(info["port"])
            token = str(info["token"])

            st_a, attach_data = http_json(port, token, "POST", "/api/client/attach", {"desktop_pid": os.getpid()})
            self.assertEqual(st_a, 200)
            self.assertEqual(attach_data["mode"], "desktop")

            # Detach mid-scan (or with recent MCP activity) -> must continue headless
            st_d, detach_data = http_json(port, token, "POST", "/api/client/detach")
            self.assertEqual(st_d, 200)
            self.assertEqual(detach_data["action"], "continuing_headless")

            deadline = time.monotonic() + 35.0
            job_status = "indexing"
            while time.monotonic() < deadline:
                _, prog = http_json(port, token, "GET", f"/api/progress?scan_id={scan_id}")
                job_status = prog["job"]["status"]
                if job_status == "completed":
                    break
                time.sleep(0.2)
            self.assertEqual(job_status, "completed")
            _, stats = http_json(port, token, "GET", "/api/stats")
            self.assertEqual(stats["photos"], 20)

        # Idle detach on desktop-mode backend with no recent MCP activity -> shutting_down
        shutdown_backend_from_runtime(self.data_dir)
        tmp2 = tempfile.TemporaryDirectory()
        try:
            save_policy(tmp2.name, {"mcp_enabled": True, "headless_enabled": False})
            proc_d, port_d = spawn_backend_process(
                tmp2.name,
                MODELS_DIR,
                token="tok-desktop",
                instance_id="inst-desktop",
                headless=False,
            )
            self._procs.append(proc_d)
            wait_for_runtime_ready(tmp2.name, expected_instance_id="inst-desktop")
            st_idle, detach_idle = http_json(port_d, "tok-desktop", "POST", "/api/client/detach")
            self.assertEqual(st_idle, 200)
            self.assertEqual(detach_idle["action"], "shutting_down")
            self.assertEqual(proc_d.wait(timeout=10), 0)
        finally:
            tmp2.cleanup()

    def test_backend_restart_on_new_port_auto_reconnects(self):
        save_policy(self.data_dir, {"mcp_enabled": True, "headless_enabled": False})
        proc1, _ = spawn_backend_process(
            self.data_dir,
            MODELS_DIR,
            token="tok-r1",
            instance_id="inst-r1",
            headless=False,
        )
        self._procs.append(proc1)
        wait_for_runtime_ready(self.data_dir, expected_instance_id="inst-r1")

        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as client:
            client.initialize()
            adapter_pid = client.proc.pid
            r1 = client.call_tool("get_library_overview")
            self.assertFalse(r1["isError"], r1)

            # Stop backend 1, then start backend 2 on a new port/token/instance_id
            shutdown_backend_from_runtime(self.data_dir)
            proc1.wait(timeout=10)

            proc2, _ = spawn_backend_process(
                self.data_dir,
                MODELS_DIR,
                token="tok-r2",
                instance_id="inst-r2",
                headless=False,
            )
            self._procs.append(proc2)
            wait_for_runtime_ready(self.data_dir, expected_instance_id="inst-r2")

            # Same mcp_server.py process reconnects cleanly without restart
            r2 = client.call_tool("get_library_overview")
            self.assertFalse(r2["isError"], r2)
            self.assertEqual(client.proc.pid, adapter_pid)


if __name__ == "__main__":
    unittest.main()
