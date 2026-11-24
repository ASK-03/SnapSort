#!/usr/bin/env python3
"""Reusable runner for SnapSort MCP unit, race-condition, security, and stress tests."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DESKTOP_DIR = os.path.join(REPO_ROOT, "desktop")

FAST_SUITES = [
    "backend/tests/test_mcp_e2e.py",
    "backend/tests/test_mcp_security.py",
    "backend/tests/test_mcp_race_conditions.py",
]

STRESS_SUITES = [
    *FAST_SUITES,
    "backend/tests/test_mcp_stress.py",
]


def _run_stage(name: str, cmd: list[str], cwd: str = REPO_ROOT) -> bool:
    print(f"\n=== {name} ===", flush=True)
    print(f"$ {' '.join(cmd)}", flush=True)
    t0 = time.monotonic()
    res = subprocess.run(cmd, cwd=cwd)
    elapsed = time.monotonic() - t0
    status = "PASS" if res.returncode == 0 else f"FAIL (exit {res.returncode})"
    print(f"--- {name}: {status} ({elapsed:.2f}s) ---", flush=True)
    return res.returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run SnapSort MCP test suites")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--fast", action="store_true", help="Run E2E, security, and race-condition Python suites (default)")
    group.add_argument("--stress", action="store_true", help="Run all Python MCP suites including stress/lifecycle")
    group.add_argument("--all", action="store_true", help="Run all Python suites plus desktop tests, tsc, and lint")
    args = parser.parse_args()

    suites = STRESS_SUITES if (args.stress or args.all) else FAST_SUITES
    results: list[tuple[str, bool]] = []

    py_ok = _run_stage(
        "Python MCP Suites",
        [sys.executable, "-m", "unittest", *suites, "-v"],
        cwd=REPO_ROOT,
    )
    results.append(("Python MCP Suites", py_ok))

    if args.all:
        node_bin = shutil.which("node")
        npm_bin = shutil.which("npm")
        npx_bin = shutil.which("npx")
        if not node_bin or not npm_bin or not npx_bin:
            print("ERROR: node, npm, and npx are required for --all", file=sys.stderr)
            return 2

        results.append(
            (
                "Desktop MCP Client Config Tests",
                _run_stage(
                    "Desktop MCP Client Config Tests",
                    [node_bin, "--experimental-strip-types", "--test", "tests/mcpClients.test.mjs"],
                    cwd=DESKTOP_DIR,
                ),
            )
        )
        results.append(
            (
                "Desktop TypeScript Check",
                _run_stage("Desktop TypeScript Check", [npx_bin, "tsc", "--noEmit"], cwd=DESKTOP_DIR),
            )
        )
        results.append(
            (
                "Desktop Oxlint",
                _run_stage("Desktop Oxlint", [npm_bin, "run", "lint"], cwd=DESKTOP_DIR),
            )
        )

    print("\n=== Summary ===")
    all_ok = True
    for label, ok in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
        if not ok:
            all_ok = False
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
