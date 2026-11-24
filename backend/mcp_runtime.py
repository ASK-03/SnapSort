"""Shared stdlib-only runtime, policy, OS locking, and audit helpers for SnapSort MCP.

Keep this module free of heavy dependencies (FastAPI, FAISS, ONNX, PIL) so
backend/mcp_server.py can import it with near-zero startup latency.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)

APP_VERSION = "3.1.0"
PROTOCOL_VERSION = 1

RUNTIME_FILENAME = "mcp-runtime.json"
POLICY_FILENAME = "mcp-policy.json"
AUDIT_FILENAME = "mcp-audit.log"
BACKEND_LOCK_FILENAME = "backend.lock"
STARTUP_LOCK_FILENAME = "startup.lock"

AUDIT_MAX_BYTES = 2 * 1024 * 1024

DEFAULT_POLICY: dict[str, Any] = {
    "version": 1,
    "mcp_enabled": False,
    "headless_enabled": False,
    "allow_agent_scan": False,
    "allow_previews": False,
    "max_headless_scan_images": 5000,
    "approved_roots": [],
}


def runtime_file_path(data_dir: str) -> str:
    return os.path.join(os.path.abspath(data_dir), RUNTIME_FILENAME)


def policy_file_path(data_dir: str) -> str:
    return os.path.join(os.path.abspath(data_dir), POLICY_FILENAME)


def audit_file_path(data_dir: str) -> str:
    return os.path.join(os.path.abspath(data_dir), AUDIT_FILENAME)


def _set_private_permissions(path: str) -> None:
    """Restrict file permissions to the current user on POSIX systems."""
    if os.name == "posix":
        try:
            os.chmod(path, 0o600)
        except OSError as exc:
            logger.debug("chmod 0600 failed on %s: %s", path, exc)


def write_json_atomic_private(path: str, data: dict[str, Any]) -> None:
    """Atomically write JSON with owner-only permissions (0600 on POSIX)."""
    abs_path = os.path.abspath(path)
    parent = os.path.dirname(abs_path)
    os.makedirs(parent, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=parent)
    try:
        _set_private_permissions(tmp_path)
        payload = json.dumps(data, indent=2)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, abs_path)
        _set_private_permissions(abs_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def read_runtime_info(data_dir: str) -> dict[str, Any] | None:
    """Read mcp-runtime.json if present and valid JSON."""
    path = runtime_file_path(data_dir)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def write_runtime_info(data_dir: str, info: dict[str, Any]) -> None:
    """Write mcp-runtime.json atomically with restricted permissions."""
    write_json_atomic_private(runtime_file_path(data_dir), info)


def remove_runtime_info_if_matches(data_dir: str, instance_id: str) -> bool:
    """Delete mcp-runtime.json only if its instance_id matches this instance."""
    path = runtime_file_path(data_dir)
    info = read_runtime_info(data_dir)
    if not info or info.get("instance_id") != instance_id:
        return False
    try:
        os.unlink(path)
        return True
    except OSError:
        return False


def _normalize_roots(roots: Any) -> list[str]:
    if not isinstance(roots, list):
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for item in roots:
        if not isinstance(item, str) or not item.strip():
            continue
        real = os.path.realpath(item.strip())
        key = os.path.normcase(real)
        if key not in seen:
            seen.add(key)
            normalized.append(real)
    return normalized


def normalize_policy(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Merge a policy dict with safe defaults and canonicalize roots."""
    policy = dict(DEFAULT_POLICY)
    if isinstance(raw, dict):
        policy["mcp_enabled"] = bool(raw.get("mcp_enabled", False))
        policy["headless_enabled"] = bool(raw.get("headless_enabled", False))
        policy["allow_agent_scan"] = bool(raw.get("allow_agent_scan", False))
        policy["allow_previews"] = bool(raw.get("allow_previews", False))
        cap = raw.get("max_headless_scan_images", DEFAULT_POLICY["max_headless_scan_images"])
        try:
            policy["max_headless_scan_images"] = max(1, min(100000, int(cap)))
        except (TypeError, ValueError):
            policy["max_headless_scan_images"] = DEFAULT_POLICY["max_headless_scan_images"]
        policy["approved_roots"] = _normalize_roots(raw.get("approved_roots", []))
    return policy


def load_policy(data_dir: str) -> dict[str, Any]:
    """Load mcp-policy.json from data_dir, falling back to safe defaults."""
    path = policy_file_path(data_dir)
    if not os.path.exists(path):
        return normalize_policy(None)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        return normalize_policy(raw)
    except (OSError, ValueError):
        return normalize_policy(None)


def save_policy(data_dir: str, raw_policy: dict[str, Any]) -> dict[str, Any]:
    """Normalize and atomically save mcp-policy.json."""
    policy = normalize_policy(raw_policy)
    write_json_atomic_private(policy_file_path(data_dir), policy)
    return policy


def is_path_within_approved_roots(target_path: str, approved_roots: list[str]) -> bool:
    """Return True iff realpath(target_path) lies inside at least one approved root."""
    if not target_path or not approved_roots:
        return False
    real_target = os.path.normcase(os.path.realpath(target_path))
    for root in approved_roots:
        if not root:
            continue
        real_root = os.path.normcase(os.path.realpath(root))
        try:
            if os.path.commonpath([real_target, real_root]) == real_root:
                return True
        except ValueError:
            continue
    return False


def append_audit_log(
    data_dir: str,
    tool: str,
    summary: dict[str, Any],
    ok: bool,
    error: str | None = None,
) -> None:
    """Append a single JSONL audit entry (rotating at AUDIT_MAX_BYTES)."""
    path = audit_file_path(data_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        if os.path.exists(path) and os.path.getsize(path) >= AUDIT_MAX_BYTES:
            rotated = f"{path}.1"
            os.replace(path, rotated)
    except OSError:
        pass

    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tool": tool,
        "summary": summary,
        "ok": ok,
        "error": error,
    }
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")
        _set_private_permissions(path)
    except OSError as exc:
        logger.debug("Failed to write audit log: %s", exc)


def read_audit_log(data_dir: str, limit: int = 50) -> list[dict[str, Any]]:
    """Return the most recent audit entries (newest first)."""
    path = audit_file_path(data_dir)
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            lines = fh.readlines()
    except OSError:
        return []

    entries: list[dict[str, Any]] = []
    for line in reversed(lines[-max(1, limit):]):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                entries.append(obj)
        except ValueError:
            continue
    return entries


def is_pid_alive(pid: int | None) -> bool:
    """Cross-platform check whether a process ID is alive."""
    if not pid or pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            process_query_limited = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(process_query_limited, False, int(pid))
            if not handle:
                return False
            try:
                exit_code = ctypes.c_ulong()
                if ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                    return exit_code.value == 259  # STILL_ACTIVE
                return True
            finally:
                ctypes.windll.kernel32.CloseHandle(handle)
        except Exception:
            return False
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


class FileLockError(RuntimeError):
    """Raised when a non-blocking OS file lock is already held."""


@contextmanager
def file_lock(lock_path: str, non_blocking: bool = False):
    """Advisory exclusive OS file lock across POSIX and Windows."""
    abs_path = os.path.abspath(lock_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    fh = open(abs_path, "a+b")
    try:
        if os.name == "nt":
            import msvcrt

            mode = msvcrt.LK_NBLCK if non_blocking else msvcrt.LK_LOCK
            fh.seek(0)
            try:
                msvcrt.locking(fh.fileno(), mode, 1)
            except OSError as exc:
                raise FileLockError(f"Lock held: {abs_path}") from exc
        else:
            import fcntl

            flags = fcntl.LOCK_EX | (fcntl.LOCK_NB if non_blocking else 0)
            try:
                fcntl.flock(fh.fileno(), flags)
            except OSError as exc:
                raise FileLockError(f"Lock held: {abs_path}") from exc
        yield fh
    finally:
        try:
            if os.name == "nt":
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        fh.close()
