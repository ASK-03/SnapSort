"""Zero-dependency stdio MCP adapter for SnapSort.

Reads MCP JSON-RPC 2.0 messages from stdin, writes JSON-RPC responses strictly
to stdout, sends all diagnostics to stderr, and proxies requests to the
single-owner SnapSort FastAPI backend (auto-starting headless mode when enabled).
"""

from __future__ import annotations

import argparse
import base64
import http.client
import json
import logging
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from typing import Any

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from mcp_runtime import (
    APP_VERSION,
    STARTUP_LOCK_FILENAME,
    append_audit_log,
    file_lock,
    load_policy,
    read_runtime_info,
)

logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="[snapsort-mcp] %(levelname)s %(message)s",
)
logger = logging.getLogger("snapsort-mcp")


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _write_stdout(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


class BackendConnectionError(RuntimeError):
    """Raised when the backend is unavailable or closed."""


class SnapSortMCPBridge:
    def __init__(
        self,
        data_dir: str,
        models_dir: str,
        backend_bin: str | None = None,
        idle_timeout: int = 300,
    ):
        self.data_dir = os.path.abspath(data_dir)
        self.models_dir = os.path.abspath(models_dir)
        self.backend_bin = backend_bin
        self.idle_timeout = int(idle_timeout)

    def _probe_runtime(self, info: dict[str, Any]) -> bool:
        port = info.get("port")
        token = info.get("token")
        instance_id = info.get("instance_id")
        if not port or not token or not instance_id:
            return False
        try:
            conn = http.client.HTTPConnection("127.0.0.1", int(port), timeout=2.0)
            conn.request(
                "GET",
                "/api/status",
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-SnapSort-Client": "mcp",
                },
            )
            resp = conn.getresponse()
            body = resp.read()
            conn.close()
            if resp.status != 200:
                return False
            data = json.loads(body.decode("utf-8"))
            if not data.get("initialised"):
                return False
            if data.get("instance_id") != instance_id:
                return False
            expected_dir = os.path.realpath(self.data_dir)
            actual_dir = os.path.realpath(data.get("data_dir", ""))
            return expected_dir == actual_dir
        except Exception:
            return False

    def _spawn_headless_backend(self) -> dict[str, Any]:
        port = _find_free_port()
        instance_id = str(uuid.uuid4())
        token = secrets.token_urlsafe(32)

        if self.backend_bin:
            cmd = [self.backend_bin]
        else:
            api_script = os.path.join(_BACKEND_DIR, "api.py")
            cmd = [sys.executable, api_script]

        cmd.extend(
            [
                "--headless",
                "--idle-timeout",
                str(self.idle_timeout),
                "--port",
                str(port),
                "--data-dir",
                self.data_dir,
                "--models-dir",
                self.models_dir,
                "--instance-id",
                instance_id,
            ]
        )

        env = os.environ.copy()
        env["SNAPSORT_API_TOKEN"] = token
        env["SNAPSORT_DATA_DIR"] = self.data_dir
        env["SNAPSORT_MODELS_DIR"] = self.models_dir
        env["SNAPSORT_HEADLESS"] = "1"
        env["SNAPSORT_IDLE_TIMEOUT"] = str(self.idle_timeout)
        env["SNAPSORT_INSTANCE_ID"] = instance_id
        env["SNAPSORT_PORT"] = str(port)

        os.makedirs(self.data_dir, exist_ok=True)
        log_path = os.path.join(self.data_dir, "backend.log")
        log_fh = open(log_path, "a", encoding="utf-8")

        popen_kwargs: dict[str, Any] = {
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": log_fh,
            "env": env,
            "cwd": os.path.dirname(_BACKEND_DIR),
        }
        if os.name == "nt":
            DETACHED_PROCESS = 0x00000008
            CREATE_NEW_PROCESS_GROUP = 0x00000200
            popen_kwargs["creationflags"] = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        else:
            popen_kwargs["start_new_session"] = True

        logger.info("Spawning headless backend on port %d", port)
        proc = subprocess.Popen(cmd, **popen_kwargs)
        log_fh.close()

        deadline = time.monotonic() + 25.0
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise BackendConnectionError(
                    f"Headless backend exited early (code {proc.returncode}). Check {log_path}."
                )
            info = read_runtime_info(self.data_dir)
            if info and self._probe_runtime(info):
                threading.Thread(target=proc.wait, daemon=True).start()
                return info
            time.sleep(0.2)

        threading.Thread(target=proc.wait, daemon=True).start()
        raise BackendConnectionError("Timed out waiting for headless SnapSort backend readiness.")

    def _ensure_backend(self) -> dict[str, Any]:
        policy = load_policy(self.data_dir)
        if not policy["mcp_enabled"]:
            raise BackendConnectionError("SnapSort MCP access is disabled in Settings.")

        info = read_runtime_info(self.data_dir)
        if info and self._probe_runtime(info):
            return info

        if not policy["headless_enabled"]:
            raise BackendConnectionError("Open SnapSort to search this library")

        lock_path = os.path.join(self.data_dir, STARTUP_LOCK_FILENAME)
        with file_lock(lock_path):
            info = read_runtime_info(self.data_dir)
            if info and self._probe_runtime(info):
                return info
            return self._spawn_headless_backend()

    def request(
        self,
        method: str,
        path: str,
        json_body: dict[str, Any] | None = None,
        timeout: float = 35.0,
    ) -> tuple[int, bytes, str]:
        last_exc: Exception | None = None
        for attempt in range(2):
            info = self._ensure_backend()
            try:
                conn = http.client.HTTPConnection("127.0.0.1", int(info["port"]), timeout=timeout)
                headers = {
                    "Authorization": f"Bearer {info['token']}",
                    "X-SnapSort-Client": "mcp",
                }
                body_bytes: bytes | None = None
                if json_body is not None:
                    headers["Content-Type"] = "application/json"
                    body_bytes = json.dumps(json_body).encode("utf-8")
                conn.request(method, path, body=body_bytes, headers=headers)
                resp = conn.getresponse()
                raw = resp.read()
                ctype = resp.getheader("Content-Type", "application/json")
                conn.close()
                if resp.status == 401 and attempt == 0:
                    continue
                return resp.status, raw, ctype
            except (OSError, http.client.HTTPException) as exc:
                last_exc = exc
                if attempt == 0:
                    continue
        raise BackendConnectionError(f"Open SnapSort to search this library ({last_exc})")

    def request_json(
        self,
        method: str,
        path: str,
        json_body: dict[str, Any] | None = None,
        timeout: float = 35.0,
    ) -> dict[str, Any] | list[Any]:
        status, raw, _ = self.request(method, path, json_body=json_body, timeout=timeout)
        text = raw.decode("utf-8", errors="replace")
        try:
            data = json.loads(text) if text else {}
        except ValueError:
            data = {"detail": text}
        if status >= 400:
            detail = data.get("detail") if isinstance(data, dict) else text
            raise RuntimeError(detail or f"HTTP {status}")
        return data


SERVER_INSTRUCTIONS = (
    "SnapSort indexes and searches a local on-device photo library. "
    "Follow these rules strictly:\n"
    "1. STRICT PRIVACY RULE: Never view, open, or inspect any image bytes—neither via get_image_preview "
    "nor via any local file-reading or vision tool (such as read_file, view_file, or shell commands)—unless "
    "the user explicitly grants permission in this conversation AND allow_previews is enabled in Settings. "
    "Return indexed file paths and metadata only.\n"
    "2. MINIMIZE TOOL CALLS (1-2 calls max): Pass person_name directly into search_images(query=..., person_name=...) "
    "to resolve the person and search in a single call instead of chaining list_people + get_library_stats + search_images.\n"
    "3. PERSON-ONLY REQUESTS: Call list_people then get_person_images so photos without CLIP embeddings are included.\n"
    "4. DO NOT LOOP ON EMPTY RESULTS: If search_images returns empty with a hint, make at most ONE broader retry "
    "(or lower min_score once, e.g. 0.18), then report the result directly to the user.\n"
    "5. MISSING OR EMPTY APPROVED FOLDERS: If list_approved_folders or list_folder_images returns action_required "
    "(for example no_approved_folders or empty_folder), stop immediately and relay that exact instruction to the user.\n"
    "6. SCANNING: Use scan_folder with wait_seconds (max 30) on approved folders and poll get_scan_progress(scan_id) if needed.\n"
    "7. PREVIEWS: Only call get_image_preview when the user explicitly asks to inspect an image, passing user_confirmed_preview=true."
)

_READ_ONLY_ANNOTATIONS: dict[str, bool] = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": False,
}

_SCAN_ANNOTATIONS: dict[str, bool] = {
    "readOnlyHint": False,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": False,
}

TOOLS_SCHEMA: list[dict[str, Any]] = [
    {
        "name": "list_people",
        "description": "List indexed face clusters with assigned names and distinct photo counts.",
        "annotations": _READ_ONLY_ANNOTATIONS,
        "inputSchema": {
            "type": "object",
            "properties": {
                "name_filter": {"type": "string", "description": "Optional substring filter on assigned person name."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                "offset": {"type": "integer", "minimum": 0, "default": 0},
            },
        },
    },
    {
        "name": "get_person_images",
        "description": "Get paginated indexed image paths containing a person cluster ID (includes photos without CLIP embeddings).",
        "annotations": _READ_ONLY_ANNOTATIONS,
        "inputSchema": {
            "type": "object",
            "properties": {
                "person_id": {"type": "integer", "description": "Face cluster ID from list_people."},
                "folder": {"type": "string", "description": "Optional folder prefix filter."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                "offset": {"type": "integer", "minimum": 0, "default": 0},
            },
            "required": ["person_id"],
        },
    },
    {
        "name": "search_images",
        "description": (
            "Semantic CLIP search across indexed photos in one call. "
            "Supports optional person_name (auto-resolved), person_id, and folder filters applied before ranking, "
            "and returns status/hint diagnostics when empty."
        ),
        "annotations": _READ_ONLY_ANNOTATIONS,
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Natural-language scene or description query."},
                "person_name": {"type": "string", "description": "Optional person name to resolve and filter before ranking (avoids extra list_people calls)."},
                "person_id": {"type": "integer", "description": "Optional face cluster ID applied before candidate selection."},
                "folder": {"type": "string", "description": "Optional folder prefix applied before candidate selection."},
                "top_k": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                "min_score": {"type": "number", "minimum": 0.0, "maximum": 1.0, "description": "Optional cosine similarity cutoff (defaults to 0.22, or 0.20 with person filter)."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_image_faces",
        "description": "List face cluster IDs and assigned names detected in an indexed image.",
        "annotations": _READ_ONLY_ANNOTATIONS,
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Indexed image file path."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "get_library_stats",
        "description": "Get photo count, face cluster count, named-people count, and active indexing status.",
        "annotations": _READ_ONLY_ANNOTATIONS,
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_approved_folders",
        "description": "List user-approved library root folders and their indexed image counts.",
        "annotations": _READ_ONLY_ANNOTATIONS,
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_folder_images",
        "description": "List paginated indexed image paths inside an approved folder.",
        "annotations": _READ_ONLY_ANNOTATIONS,
        "inputSchema": {
            "type": "object",
            "properties": {
                "folder": {"type": "string", "description": "Approved folder path."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                "offset": {"type": "integer", "minimum": 0, "default": 0},
            },
            "required": ["folder"],
        },
    },
    {
        "name": "scan_folder",
        "description": "Scan and index new or modified photos inside a user-approved folder.",
        "annotations": _SCAN_ANNOTATIONS,
        "inputSchema": {
            "type": "object",
            "properties": {
                "folder": {"type": "string", "description": "Folder path inside an approved library root."},
                "wait_seconds": {"type": "number", "minimum": 0, "maximum": 30, "default": 0},
            },
            "required": ["folder"],
        },
    },
    {
        "name": "get_scan_progress",
        "description": "Check progress and status of an indexing job.",
        "annotations": _READ_ONLY_ANNOTATIONS,
        "inputSchema": {
            "type": "object",
            "properties": {
                "scan_id": {"type": "string", "description": "Optional scan_id returned by scan_folder."},
            },
        },
    },
    {
        "name": "get_image_preview",
        "description": (
            "Fetch a downscaled EXIF-stripped JPEG preview of an indexed image ONLY when the user explicitly "
            "gives permission in this conversation AND allow_previews is enabled in Settings."
        ),
        "annotations": _READ_ONLY_ANNOTATIONS,
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Indexed image path."},
                "user_confirmed_preview": {
                    "type": "boolean",
                    "description": "MUST be true ONLY after the user explicitly asked or gave permission in this conversation to view the image. Never set to true on your own.",
                },
                "max_size": {"type": "integer", "minimum": 64, "maximum": 1024, "default": 1024},
            },
            "required": ["path", "user_confirmed_preview"],
        },
    },
]


def _execute_tool(bridge: SnapSortMCPBridge, name: str, args: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if name == "list_people":
        params: dict[str, Any] = {
            "limit": min(100, max(1, int(args.get("limit", 20)))),
            "offset": max(0, int(args.get("offset", 0))),
        }
        if args.get("name_filter"):
            params["name"] = str(args["name_filter"])
        qs = urllib.parse.urlencode(params)
        data = bridge.request_json("GET", f"/api/faces?{qs}")
        return [{"type": "text", "text": json.dumps(data)}], {"count": len(data.get("faces", [])) if isinstance(data, dict) else 0}

    if name == "get_person_images":
        person_id = int(args["person_id"])
        params = {
            "limit": min(100, max(1, int(args.get("limit", 20)))),
            "offset": max(0, int(args.get("offset", 0))),
        }
        if args.get("folder"):
            params["folder"] = str(args["folder"])
        qs = urllib.parse.urlencode(params)
        data = bridge.request_json("GET", f"/api/faces/{person_id}/images?{qs}")
        return [{"type": "text", "text": json.dumps(data)}], {"person_id": person_id, "count": len(data.get("images", [])) if isinstance(data, dict) else 0}

    if name == "search_images":
        params = {
            "q": str(args["query"]),
            "limit": min(100, max(1, int(args.get("top_k", 20)))),
            "include_meta": "true",
        }
        if args.get("person_name"):
            params["person_name"] = str(args["person_name"])
        if args.get("person_id") is not None:
            params["person_id"] = int(args["person_id"])
        if args.get("folder"):
            params["folder"] = str(args["folder"])
        if args.get("min_score") is not None:
            params["min_score"] = max(0.0, min(1.0, float(args["min_score"])))
        qs = urllib.parse.urlencode(params)
        data = bridge.request_json("GET", f"/api/search?{qs}")
        return [{"type": "text", "text": json.dumps(data)}], {"query": params["q"], "count": len(data.get("results", [])) if isinstance(data, dict) else 0}

    if name == "get_image_faces":
        qs = urllib.parse.urlencode({"image_path": str(args["path"])})
        data = bridge.request_json("GET", f"/api/images/faces?{qs}")
        return [{"type": "text", "text": json.dumps(data)}], {"path": str(args["path"])}

    if name == "get_library_stats":
        data = bridge.request_json("GET", "/api/stats")
        return [{"type": "text", "text": json.dumps(data)}], {}

    if name == "list_approved_folders":
        data = bridge.request_json("GET", "/api/mcp/folders")
        return [{"type": "text", "text": json.dumps(data)}], {"folders": len(data.get("folders", [])) if isinstance(data, dict) else 0}

    if name == "list_folder_images":
        params = {
            "folder": str(args["folder"]),
            "limit": min(100, max(1, int(args.get("limit", 20)))),
            "offset": max(0, int(args.get("offset", 0))),
        }
        qs = urllib.parse.urlencode(params)
        data = bridge.request_json("GET", f"/api/mcp/folders/images?{qs}")
        return [{"type": "text", "text": json.dumps(data)}], {"folder": params["folder"], "count": len(data.get("images", [])) if isinstance(data, dict) else 0}

    if name == "scan_folder":
        wait_s = max(0.0, min(30.0, float(args.get("wait_seconds", 0.0))))
        data = bridge.request_json(
            "POST",
            "/api/mcp/scan",
            json_body={"folder_path": str(args["folder"]), "wait_seconds": wait_s},
            timeout=max(35.0, wait_s + 10.0),
        )
        return [{"type": "text", "text": json.dumps(data)}], {"folder": str(args["folder"]), "status": data.get("status") if isinstance(data, dict) else None}

    if name == "get_scan_progress":
        qs = urllib.parse.urlencode({"scan_id": str(args["scan_id"])}) if args.get("scan_id") else ""
        suffix = f"?{qs}" if qs else ""
        data = bridge.request_json("GET", f"/api/progress{suffix}")
        return [{"type": "text", "text": json.dumps(data)}], {"scan_id": args.get("scan_id")}

    if name == "get_image_preview":
        if args.get("user_confirmed_preview") is not True:
            raise RuntimeError(
                "Permission required: Do not view or open any image (via get_image_preview or any local "
                "file-reading tool) until the user explicitly grants permission in this conversation."
            )
        policy = load_policy(bridge.data_dir)
        if not policy["allow_previews"]:
            raise RuntimeError(
                "Visual previews are disabled in SnapSort Settings. Do NOT open or read this image path "
                "with any local file or vision tool; ask the user to enable 'Allow Visual Previews' in "
                "SnapSort Settings if they want you to inspect photos."
            )
        max_size = max(64, min(1024, int(args.get("max_size", 1024))))
        qs = urllib.parse.urlencode({"path": str(args["path"]), "max_size": max_size})
        status, raw, ctype = bridge.request("GET", f"/api/mcp/preview?{qs}")
        if status >= 400:
            try:
                err = json.loads(raw.decode("utf-8", errors="replace")).get("detail", f"HTTP {status}")
            except ValueError:
                err = f"HTTP {status}"
            raise RuntimeError(err)
        encoded = base64.b64encode(raw).decode("ascii")
        return [{"type": "image", "data": encoded, "mimeType": ctype.split(";")[0] or "image/jpeg"}], {"path": str(args["path"]), "bytes": len(raw)}

    raise ValueError(f"Unknown tool: {name}")


def serve_stdio(bridge: SnapSortMCPBridge) -> int:
    """Run the JSON-RPC 2.0 MCP loop until stdin hits EOF."""
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id: Any = None
        try:
            msg = json.loads(line)
            req_id = msg.get("id")
            method = msg.get("method")
            params = msg.get("params") or {}
        except ValueError as exc:
            _write_stdout(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": f"Parse error: {exc}"},
                }
            )
            continue

        if method == "notifications/initialized" or req_id is None:
            continue

        if method == "initialize":
            client_proto = str(params.get("protocolVersion") or "2024-11-05")
            _write_stdout(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": client_proto,
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": {"name": "snapsort-mcp", "version": APP_VERSION},
                        "instructions": SERVER_INSTRUCTIONS,
                    },
                }
            )
        elif method == "ping":
            _write_stdout({"jsonrpc": "2.0", "id": req_id, "result": {}})
        elif method == "tools/list":
            _write_stdout({"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS_SCHEMA}})
        elif method == "tools/call":
            tool_name = str(params.get("name") or "")
            tool_args = params.get("arguments") or {}
            try:
                content, summary = _execute_tool(bridge, tool_name, tool_args)
                append_audit_log(bridge.data_dir, tool_name, summary, ok=True)
                _write_stdout(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {"content": content, "isError": False},
                    }
                )
            except Exception as exc:
                append_audit_log(
                    bridge.data_dir,
                    tool_name,
                    {"keys": sorted(tool_args.keys()) if isinstance(tool_args, dict) else []},
                    ok=False,
                    error=str(exc),
                )
                _write_stdout(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{"type": "text", "text": str(exc)}],
                            "isError": True,
                        },
                    }
                )
        else:
            _write_stdout(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                }
            )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="SnapSort stdio MCP adapter")
    parser.add_argument(
        "--data-dir",
        default=os.path.join(_BACKEND_DIR, "..", "data"),
        help="SnapSort library data directory",
    )
    parser.add_argument(
        "--models-dir",
        default=os.path.join(_BACKEND_DIR, "..", "models"),
        help="SnapSort ONNX models directory",
    )
    parser.add_argument("--backend-bin", default=None, help="Optional packaged snapsort backend executable")
    parser.add_argument("--idle-timeout", type=int, default=300, help="Headless backend idle timeout in seconds")
    args = parser.parse_args()

    bridge = SnapSortMCPBridge(
        data_dir=args.data_dir,
        models_dir=args.models_dir,
        backend_bin=args.backend_bin,
        idle_timeout=args.idle_timeout,
    )
    return serve_stdio(bridge)


if __name__ == "__main__":
    raise SystemExit(main())
