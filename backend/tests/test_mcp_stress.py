import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from PIL import Image

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _TESTS_DIR not in sys.path:
    sys.path.insert(0, _TESTS_DIR)

from mcp_test_helpers import (  # noqa: E402
    MODELS_DIR,
    StdioMcpClient,
    http_json,
    make_corrupt_jpeg,
    make_jpeg,
    shutdown_backend_from_runtime,
    spawn_backend_process,
    wait_for_runtime_ready,
)

from clip_index import CLIPIndex  # noqa: E402
from db import Database  # noqa: E402
from mcp_runtime import is_pid_alive, read_runtime_info, save_policy  # noqa: E402


class TestMcpStressAndLifecycle(unittest.TestCase):
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

    def test_multi_client_parallel_stdio_burst_load(self):
        for i in range(4):
            make_jpeg(os.path.join(self.approved_dir, f"burst_{i}.jpg"), color=(40 * i, 120, 200))

        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "allow_agent_scan": True,
                "approved_roots": [self.approved_dir],
            },
        )

        # Warm scan first so queries hit indexed data
        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as warm:
            warm.initialize()
            res = warm.call_tool("scan_folder", {"folder": self.approved_dir, "wait_seconds": 30})
            self.assertFalse(res["isError"], res)
            scan_data = json.loads(res["content"][0]["text"])
            deadline = time.monotonic() + 30.0
            while scan_data.get("status") in ("queued", "indexing") and time.monotonic() < deadline:
                time.sleep(0.2)
                scan_data = json.loads(
                    warm.call_tool("get_scan_progress", {"scan_id": scan_data["scan_id"]})["content"][0]["text"]
                )["job"]
            self.assertEqual(scan_data["status"], "completed")

        barrier = threading.Barrier(4)
        failures: list[str] = []
        non_json: list[str] = []
        total_calls = 0
        lock = threading.Lock()

        def burst_worker(worker_idx: int):
            nonlocal total_calls
            try:
                with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as client:
                    client.initialize()
                    barrier.wait(timeout=10)
                    calls = [
                        ("get_library_stats", {}),
                        ("list_people", {"limit": 10, "offset": 0}),
                        ("list_approved_folders", {}),
                        ("list_folder_images", {"folder": self.approved_dir, "limit": 10}),
                        ("search_images", {"query": f"blue sky {worker_idx}", "folder": self.approved_dir, "top_k": 4}),
                    ]
                    for step in range(25):
                        tool, args = calls[step % len(calls)]
                        res = client.call_tool(tool, args)
                        with lock:
                            total_calls += 1
                            if res.get("isError"):
                                failures.append(f"w{worker_idx} step {step} {tool}: {res}")
                    rc = client.close()
                    with lock:
                        if rc != 0:
                            failures.append(f"w{worker_idx} exit code {rc}")
                        non_json.extend(client.non_json_stdout_lines)
            except Exception as exc:
                with lock:
                    failures.append(f"w{worker_idx} exc: {exc}")

        threads = [threading.Thread(target=burst_worker, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)

        self.assertEqual(failures, [])
        self.assertEqual(non_json, [])
        self.assertEqual(total_calls, 100)

    def test_batch_63_images_persistence_and_restart_consistency(self):
        for i in range(63):
            make_jpeg(
                os.path.join(self.approved_dir, f"batch_{i:03d}.jpg"),
                color=((i * 13) % 255, (i * 29) % 255, (i * 47) % 255),
                size=(128, 128),
            )

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
            scan_res = client.call_tool("scan_folder", {"folder": self.approved_dir, "wait_seconds": 30})
            self.assertFalse(scan_res["isError"], scan_res)
            scan_data = json.loads(scan_res["content"][0]["text"])
            deadline = time.monotonic() + 60.0
            while scan_data.get("status") in ("queued", "indexing") and time.monotonic() < deadline:
                time.sleep(0.25)
                scan_data = json.loads(
                    client.call_tool("get_scan_progress", {"scan_id": scan_data["scan_id"]})["content"][0]["text"]
                )["job"]
            self.assertEqual(scan_data["status"], "completed")
            self.assertEqual(scan_data["processed_images"], 63)

        shutdown_backend_from_runtime(self.data_dir)

        # Restart backend on a new port and verify persisted counts match 63
        proc2, port2 = spawn_backend_process(
            self.data_dir,
            MODELS_DIR,
            token="tok-63",
            instance_id="inst-63",
            headless=True,
        )
        self._procs.append(proc2)
        wait_for_runtime_ready(self.data_dir, expected_instance_id="inst-63")
        st, stats = http_json(port2, "tok-63", "GET", "/api/stats")
        self.assertEqual(st, 200)
        self.assertEqual(stats["photos"], 63)
        shutdown_backend_from_runtime(self.data_dir)
        proc2.wait(timeout=10)

        cidx = CLIPIndex(os.path.join(self.data_dir, "clip.index"))
        db = Database(os.path.join(self.data_dir, "faces.db"))
        try:
            self.assertEqual(cidx.ntotal, 63)
            self.assertEqual(db.get_stats()["photos"], 63)
            self.assertEqual(db.reconcile_clip_status(cidx.get_all_ids()), 0)
        finally:
            db.close()

    def test_corrupt_and_unsupported_file_fault_isolation(self):
        good_jpg = os.path.join(self.approved_dir, "good.jpg")
        good_png = os.path.join(self.approved_dir, "good.png")
        empty_jpg = os.path.join(self.approved_dir, "empty.jpg")
        corrupt_jpg = os.path.join(self.approved_dir, "corrupt.jpg")
        notes_txt = os.path.join(self.approved_dir, "notes.txt")

        make_jpeg(good_jpg, color=(200, 120, 40))
        Image.new("RGB", (160, 160), color=(30, 180, 90)).save(good_png, format="PNG")
        make_corrupt_jpeg(empty_jpg, empty=True)
        make_corrupt_jpeg(corrupt_jpg, empty=False)
        with open(notes_txt, "w", encoding="utf-8") as fh:
            fh.write("ignore me")

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
            res = client.call_tool("scan_folder", {"folder": self.approved_dir, "wait_seconds": 30})
            self.assertFalse(res["isError"], res)
            job = json.loads(res["content"][0]["text"])
            deadline = time.monotonic() + 30.0
            while job.get("status") in ("queued", "indexing") and time.monotonic() < deadline:
                time.sleep(0.2)
                job = json.loads(
                    client.call_tool("get_scan_progress", {"scan_id": job["scan_id"]})["content"][0]["text"]
                )["job"]
            self.assertEqual(job["status"], "completed")
            self.assertEqual(job["total_images"], 4)
            self.assertEqual(job["failed_images"], 2)

            imgs = json.loads(
                client.call_tool("list_folder_images", {"folder": self.approved_dir})["content"][0]["text"]
            )["images"]
            self.assertIn(os.path.realpath(good_jpg), imgs)
            self.assertIn(os.path.realpath(good_png), imgs)

    def test_mtime_modification_reindexing_without_duplicates(self):
        img_path = os.path.join(self.approved_dir, "editable.jpg")
        make_jpeg(img_path, color=(10, 20, 30))

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
            j1 = json.loads(
                client.call_tool("scan_folder", {"folder": self.approved_dir, "wait_seconds": 30})["content"][0]["text"]
            )
            self.assertEqual(j1["new_images"], 1)

            # Modify pixel content and bump mtime
            make_jpeg(img_path, color=(220, 200, 10))
            st = os.stat(img_path)
            os.utime(img_path, (st.st_atime, st.st_mtime + 5.0))

            j2 = json.loads(
                client.call_tool("scan_folder", {"folder": self.approved_dir, "wait_seconds": 30})["content"][0]["text"]
            )
            self.assertEqual(j2["new_images"], 1)
            deadline = time.monotonic() + 20.0
            while j2.get("status") in ("queued", "indexing") and time.monotonic() < deadline:
                time.sleep(0.2)
                j2 = json.loads(
                    client.call_tool("get_scan_progress", {"scan_id": j2["scan_id"]})["content"][0]["text"]
                )["job"]
            self.assertEqual(j2["status"], "completed")

            stats = json.loads(client.call_tool("get_library_stats")["content"][0]["text"])
            self.assertEqual(stats["photos"], 1)

        shutdown_backend_from_runtime(self.data_dir)
        cidx = CLIPIndex(os.path.join(self.data_dir, "clip.index"))
        self.assertEqual(cidx.ntotal, 1)

    def test_headless_scan_budget_guardrail(self):
        for i in range(8):
            make_jpeg(os.path.join(self.approved_dir, f"cap_{i}.jpg"))

        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "allow_agent_scan": True,
                "max_headless_scan_images": 5,
                "approved_roots": [self.approved_dir],
            },
        )

        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as client:
            client.initialize()
            res = client.call_tool("scan_folder", {"folder": self.approved_dir, "wait_seconds": 5})
            self.assertFalse(res["isError"])
            job = json.loads(res["content"][0]["text"])
            self.assertEqual(job["status"], "failed")
            self.assertIn("exceeding", job["error"].lower())

            stats = json.loads(client.call_tool("get_library_stats")["content"][0]["text"])
            self.assertEqual(stats["photos"], 0)

    def test_idle_auto_shutdown_and_zero_orphans(self):
        save_policy(self.data_dir, {"mcp_enabled": True, "headless_enabled": True})
        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=3) as client:
            client.initialize()
            res = client.call_tool("get_library_stats")
            self.assertFalse(res["isError"])
            info = read_runtime_info(self.data_dir)
            self.assertIsNotNone(info)
            backend_pid = int(info["pid"])
            self.assertTrue(is_pid_alive(backend_pid))

            # Wait past 3s idle timeout -> backend auto-exits and removes discovery file
            deadline = time.monotonic() + 12.0
            while is_pid_alive(backend_pid) and time.monotonic() < deadline:
                time.sleep(0.25)

            self.assertFalse(is_pid_alive(backend_pid))
            self.assertIsNone(read_runtime_info(self.data_dir))

    def test_desktop_pid_crash_detection(self):
        save_policy(self.data_dir, {"mcp_enabled": True, "headless_enabled": False})
        dummy_desktop = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        self._procs.append(dummy_desktop)
        try:
            proc, _ = spawn_backend_process(
                self.data_dir,
                MODELS_DIR,
                token="tok-crash",
                instance_id="inst-crash",
                headless=False,
                idle_timeout=2,
                desktop_pid=dummy_desktop.pid,
            )
            self._procs.append(proc)
            wait_for_runtime_ready(self.data_dir, expected_instance_id="inst-crash")

            # Simulate unexpected desktop crash
            dummy_desktop.kill()
            dummy_desktop.wait(timeout=5)

            # Watchdog detects dead desktop_pid and exits after idle_timeout=2
            rc = proc.wait(timeout=12)
            self.assertEqual(rc, 0)
            self.assertIsNone(read_runtime_info(self.data_dir))
        finally:
            if dummy_desktop.poll() is None:
                dummy_desktop.kill()

    def test_protocol_hygiene_and_malformed_jsonrpc_resilience(self):
        save_policy(
            self.data_dir,
            {
                "mcp_enabled": True,
                "headless_enabled": True,
                "approved_roots": [self.approved_dir],
            },
        )

        with StdioMcpClient(self.data_dir, MODELS_DIR, idle_timeout=60) as client:
            client.initialize()
            client.notify("notifications/initialized")

            ping = client.rpc("ping")
            self.assertEqual(ping["result"], {})

            bad_json = client.raw_send_and_read("{not valid json")
            self.assertEqual(bad_json["error"]["code"], -32700)

            unknown_method = client.rpc("unknown/method")
            self.assertEqual(unknown_method["error"]["code"], -32601)

            unknown_tool = client.call_tool("does_not_exist", {})
            self.assertTrue(unknown_tool["isError"])

            # Out-of-range limits clamped safely without error
            r_people = client.call_tool("list_people", {"limit": 500, "offset": 0})
            self.assertFalse(r_people["isError"])

            r_search = client.call_tool("search_images", {"query": "sunset", "top_k": 999})
            self.assertFalse(r_search["isError"])

            rc = client.close()
            self.assertEqual(rc, 0)
            self.assertEqual(client.non_json_stdout_lines, [])


if __name__ == "__main__":
    unittest.main()
