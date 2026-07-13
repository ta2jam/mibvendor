#!/usr/bin/env python3
"""Cheap structural validation for a committed bake-off result set."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "corpus"
MANIFEST = json.loads((CORPUS / "manifest.json").read_text())
EXPECTED_VERSIONS = {
    "pysmi": "2.0.0",
    "libsmi": "0.5.0",
    "net-snmp": "5.9.4.pre2",
}


def fingerprint() -> str:
    digest = hashlib.sha256()
    for path in sorted(CORPUS.iterdir(), key=lambda item: item.name):
        if path.is_file():
            digest.update(path.name.encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    return digest.hexdigest()


def fail(message: str) -> None:
    raise SystemExit(f"result validation failed: {message}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("results_dir", type=Path)
    args = parser.parse_args()
    results_dir = args.results_dir.resolve()
    summary_path = results_dir / "summary.json"
    if not summary_path.is_file():
        fail("summary.json is missing")
    summary = json.loads(summary_path.read_text())
    if summary.get("parser_gate", {}).get("status") != "provisional":
        fail("the 9-case baseline must not claim a passed parser gate")

    expected_ids = [case["id"] for case in MANIFEST["cases"]]
    corpus_hash = fingerprint()
    aggregate = {item["candidate"]: item for item in summary.get("candidates", [])}
    if set(aggregate) != set(EXPECTED_VERSIONS):
        fail("summary candidate set differs from pins")

    for candidate, version in EXPECTED_VERSIONS.items():
        path = results_dir / f"{candidate}.json"
        if not path.is_file():
            fail(f"{path.name} is missing")
        document = json.loads(path.read_text())
        if document.get("version") != version:
            fail(f"{candidate} version is {document.get('version')!r}, expected {version!r}")
        if document.get("corpus", {}).get("sha256") != corpus_hash:
            fail(f"{candidate} corpus fingerprint is stale")
        case_ids = [case["id"] for case in document.get("cases", [])]
        if case_ids != expected_ids:
            fail(f"{candidate} case list differs from manifest")
        candidate_summary = document.get("summary", {})
        if candidate_summary.get("expectations_met") != len(expected_ids):
            fail(f"{candidate} does not meet all synthetic expectations")
        if candidate_summary.get("normalized_deterministic_cases") != len(expected_ids):
            fail(f"{candidate} normalized output is not deterministic")
        if candidate_summary.get("timeout_cases") != 0:
            fail(f"{candidate} has a timeout")
        for key, value in candidate_summary.items():
            if aggregate[candidate].get(key) != value:
                fail(f"{candidate} aggregate field {key!r} is inconsistent")

    image_sizes = [aggregate[name]["container_image_bytes"] for name in EXPECTED_VERSIONS]
    expected_container_status = "not_measured" if all(size is None for size in image_sizes) else "measured"
    if summary.get("container_measurement_status") != expected_container_status:
        fail("container measurement status is inconsistent")
    print(
        f"validated {len(EXPECTED_VERSIONS)} candidates and {len(expected_ids)} synthetic cases; "
        f"parser gate remains {summary['parser_gate']['status']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
