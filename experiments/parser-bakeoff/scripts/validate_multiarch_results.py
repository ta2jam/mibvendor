#!/usr/bin/env python3
"""Validate architecture identity and normalized parity between Linux runs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


CANDIDATES = ("pysmi", "libsmi", "net-snmp")
CASE_KEYS = (
    "id",
    "expected",
    "expectation_met",
    "success",
    "timed_out",
    "feature_checks",
    "normalized",
)
SUMMARY_KEYS = (
    "expectations_met",
    "expectations_total",
    "valid_parse_success",
    "valid_parse_total",
    "invalid_rejected",
    "invalid_total",
    "field_fidelity_passed",
    "field_fidelity_total",
    "normalized_deterministic_cases",
    "timeout_cases",
    "collision_module_qualified_preserved",
)


def fail(message: str) -> None:
    raise SystemExit(f"multi-architecture validation failed: {message}")


def load(directory: Path, candidate: str) -> dict:
    path = directory / f"{candidate}.json"
    if not path.is_file():
        fail(f"{path} is missing")
    return json.loads(path.read_text())


def projection(document: dict) -> list[dict]:
    return [
        {key: case.get(key) for key in CASE_KEYS}
        for case in document.get("cases", [])
    ]


def summary_projection(document: dict) -> dict:
    summary = document.get("summary", {})
    return {key: summary.get(key) for key in SUMMARY_KEYS}


def collision_projection(document: dict) -> dict:
    collision = document.get("collision", {})
    return {
        "success": collision.get("success"),
        "module_qualified_preserved": collision.get("module_qualified_preserved"),
        "resolved": collision.get("resolved"),
    }


def verify_host(document: dict, expected_machine: str, label: str) -> None:
    host = document.get("host", {})
    if document.get("execution_mode") != "container":
        fail(f"{label} evidence was not produced in container mode")
    if host.get("machine") != expected_machine:
        fail(f"{label} machine is {host.get('machine')!r}, expected {expected_machine!r}")
    if not str(host.get("platform", "")).startswith("Linux-"):
        fail(f"{label} platform is not Linux")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("amd64_dir", type=Path)
    parser.add_argument("arm64_dir", type=Path)
    args = parser.parse_args()

    for candidate in CANDIDATES:
        amd64 = load(args.amd64_dir.resolve(), candidate)
        arm64 = load(args.arm64_dir.resolve(), candidate)
        verify_host(amd64, "x86_64", f"amd64 {candidate}")
        verify_host(arm64, "aarch64", f"arm64 {candidate}")

        for key in ("candidate", "version", "corpus"):
            if amd64.get(key) != arm64.get(key):
                fail(f"{candidate} {key} differs across architectures")
        if collision_projection(amd64) != collision_projection(arm64):
            fail(f"{candidate} collision correctness differs across architectures")
        if projection(amd64) != projection(arm64):
            fail(f"{candidate} normalized case evidence differs across architectures")
        if summary_projection(amd64) != summary_projection(arm64):
            fail(f"{candidate} correctness summary differs across architectures")

    print("validated normalized parity for 3 candidates on Linux x86_64 and aarch64")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
