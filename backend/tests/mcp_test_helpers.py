"""Shared helpers, fixtures, and subprocess wrappers for SnapSort MCP tests."""

from __future__ import annotations

import http.client
import json
import os
import socket
import subprocess
import sys
import time
from typing import Any

import numpy as np
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
MODELS_DIR = os.path.join(REPO_ROOT, "models")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from mcp_runtime import is_pid_alive, read_runtime_info  # noqa: E402


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def make_jpeg(
    path: str,
    color: tuple[int, int, int] = (20, 120, 220),
    size: tuple[int, int] = (320, 240),
    with_exif: bool = False,
    with_gps: bool = False,
) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = Image.new("RGB", size, color=color)
    if with_exif or with_gps:
        exif = Image.Exif()
        exif[0x010F] = "SnapSortTestCam"
        exif[0x0110] = "Model-X"
        if with_gps:
            # GPS IFD pointer + basic lat/lon tags
            exif[0x8825] = {
                1: "N",
                2: (15.0, 30.0, 0.0),
                3: "E",
                4: (73.0, 49.0, 0.0),
            }
        img.save(path, format="JPEG", exif=exif.tobytes())
    else:
        img.save(path, format="JPEG")


def make_corrupt_jpeg(path: str, empty: bool = False) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        if not empty:
            fh.write(b"\xff\xd8\xff\xe0not-a-valid-jpeg-payload-0000")


class StubClipProcessor:
    """Deterministic unit-norm 512-d text/image embeddings for fast tests."""

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


def http_json(
    port: int,
    token: str,
    method: str,
    req_path: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 5.0,
) -> tuple[int, Any]:
    conn = http.client.HTTPConnection("127.0.0.1", int(port), timeout=timeout)
    req_headers: dict[str, str] = {"Authorization": f"Bearer {token}"}
    if headers:
        req_headers.update(headers)
    raw_body: bytes | None = None
    if body is not None:
        req_headers["Content-Type"] = "application/json"
        raw_body = json.dumps(body).encode("utf-8")
    try:
        conn.request(method, req_path, body=raw_body, headers=req_headers)
        resp = conn.getresponse()
        raw = resp.read()
        text = raw.decode("utf-8", errors="replace")
        try:
            parsed = json.loads(text) if text else None
        except ValueError:
            parsed = text
        return resp.status, parsed
    finally:
        conn.close()


def shutdown_backend_from_runtime(data_dir: str, timeout: float = 8.0) -> None:
    """Gracefully stop any backend registered in data_dir/mcp-runtime.json."""
    info = read_runtime_info(data_dir)
    if not info:
        return
    port = info.get("port")
    token = info.get("token")
    pid = info.get("pid")
    if port and token:
        try:
            http_json(int(port), str(token), "POST", "/api/shutdown", timeout=2.0)
        except Exception:
            pass
    deadline = time.monotonic() + timeout
    while pid and is_pid_alive(int(pid)) and time.monotonic() < deadline:
        time.sleep(0.1)


def wait_for_runtime_ready(
    data_dir: str,
    expected_instance_id: str | None = None,
    timeout: float = 20.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        info = read_runtime_info(data_dir)
        if info and (expected_instance_id is None or info.get("instance_id") == expected_instance_id):
            try:
                status, data = http_json(int(info["port"]), str(info["token"]), "GET", "/api/status", timeout=1.5)
                if status == 200 and isinstance(data, dict) and data.get("initialised"):
                    return info
            except Exception:
                pass
        time.sleep(0.15)
    raise TimeoutError(f"Backend did not become ready in {data_dir}")


def spawn_backend_process(
    data_dir: str,
    models_dir: str = MODELS_DIR,
    port: int | None = None,
    token: str = "test-backend-token",
    instance_id: str = "test-instance",
    headless: bool = True,
    idle_timeout: int = 60,
    desktop_pid: int | None = None,
) -> tuple[subprocess.Popen[str], int]:
    """Spawn backend/api.py directly as a subprocess for lock/restart tests."""
    chosen_port = port or find_free_port()
    cmd = [
        sys.executable,
        os.path.join(BACKEND_DIR, "api.py"),
        "--port",
        str(chosen_port),
        "--data-dir",
        data_dir,
        "--models-dir",
        models_dir,
        "--idle-timeout",
        str(idle_timeout),
        "--instance-id",
        instance_id,
    ]
    if headless:
        cmd.append("--headless")

    env = os.environ.copy()
    env["SNAPSORT_API_TOKEN"] = token
    env["SNAPSORT_DATA_DIR"] = data_dir
    env["SNAPSORT_MODELS_DIR"] = models_dir
    env["SNAPSORT_INSTANCE_ID"] = instance_id
    env["SNAPSORT_PORT"] = str(chosen_port)
    env["SNAPSORT_IDLE_TIMEOUT"] = str(idle_timeout)
    env["SNAPSORT_HEADLESS"] = "1" if headless else "0"
    if desktop_pid is not None:
        env["SNAPSORT_DESKTOP_PID"] = str(desktop_pid)

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        cwd=REPO_ROOT,
    )
    return proc, chosen_port


class StdioMcpClient:
    """Context manager wrapping a live backend/mcp_server.py stdio subprocess."""

    def __init__(
        self,
        data_dir: str,
        models_dir: str = MODELS_DIR,
        idle_timeout: int = 60,
    ):
        self.data_dir = data_dir
        self.models_dir = models_dir
        self.idle_timeout = idle_timeout
        self._next_id = 1
        self.proc: subprocess.Popen[str] | None = None
        self.non_json_stdout_lines: list[str] = []

    def __enter__(self) -> "StdioMcpClient":
        self.proc = subprocess.Popen(
            [
                sys.executable,
                os.path.join(BACKEND_DIR, "mcp_server.py"),
                "--data-dir",
                self.data_dir,
                "--models-dir",
                self.models_dir,
                "--idle-timeout",
                str(self.idle_timeout),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=REPO_ROOT,
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    def close(self) -> int | None:
        if self.proc is None:
            return None
        proc = self.proc
        self.proc = None
        if proc.stdin and not proc.stdin.closed:
            proc.stdin.close()
        rc = proc.wait(timeout=10)
        if proc.stdout:
            leftover = proc.stdout.read()
            for line in leftover.splitlines():
                if line.strip():
                    try:
                        json.loads(line)
                    except ValueError:
                        self.non_json_stdout_lines.append(line)
            proc.stdout.close()
        if proc.stderr:
            proc.stderr.close()
        return rc

    def _alloc_id(self) -> int:
        val = self._next_id
        self._next_id += 1
        return val

    def raw_send_and_read(self, raw_line: str) -> dict[str, Any]:
        assert self.proc and self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(raw_line.rstrip("\n") + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            stderr_tail = self.proc.stderr.read() if self.proc.stderr else ""
            raise AssertionError(f"Expected JSON-RPC response on stdout; got EOF. stderr={stderr_tail!r}")
        try:
            parsed = json.loads(line)
        except ValueError as exc:
            self.non_json_stdout_lines.append(line)
            raise AssertionError(f"Non-JSON line written to stdout: {line!r}") from exc
        return parsed

    def rpc(self, method: str, params: dict[str, Any] | None = None, req_id: int | None = None) -> dict[str, Any]:
        rid = req_id if req_id is not None else self._alloc_id()
        return self.raw_send_and_read(
            json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}})
        )

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        assert self.proc and self.proc.stdin
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method, "params": params or {}}) + "\n")
        self.proc.stdin.flush()

    def initialize(self, protocol_version: str = "2024-11-05") -> dict[str, Any]:
        return self.rpc("initialize", {"protocolVersion": protocol_version})

    def list_tools(self) -> list[dict[str, Any]]:
        resp = self.rpc("tools/list")
        return resp["result"]["tools"]

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        resp = self.rpc("tools/call", {"name": name, "arguments": arguments or {}})
        return resp["result"]
