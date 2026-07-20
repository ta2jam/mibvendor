#!/usr/bin/env python3
"""Run the pinned parser adapters against the 100-file public breadth corpus."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import public_corpus_gate as corpus_gate  # noqa: E402
import run_bakeoff as harness  # noqa: E402


ROOT = corpus_gate.ROOT
DEFAULT_RESULTS = ROOT / "experiments/parser-bakeoff/results/public-latest"
CANDIDATES = ("pysmi", "libsmi", "net-snmp")


def fail(message: str) -> None:
    raise SystemExit(f"public bake-off failed: {message}")


def compact_measurement(value: dict[str, Any]) -> dict[str, Any]:
    if "lint" in value and "dump" in value:
        return {key: compact_measurement(value[key]) for key in ("lint", "dump")}
    keys = (
        "returncode",
        "timed_out",
        "wall_seconds",
        "user_cpu_seconds",
        "system_cpu_seconds",
        "peak_child_rss_kib_so_far",
    )
    return {key: value.get(key) for key in keys}


def measurements(value: dict[str, Any]) -> list[dict[str, Any]]:
    return list(value.values()) if "lint" in value and "dump" in value else [value]


def feature_checks(normalized: dict[str, Any], source_features: list[str]) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    for source_feature, normalized_field in corpus_gate.OBSERVABLE_FEATURE_FIELDS.items():
        if source_feature in source_features:
            checks[source_feature] = bool(normalized.get(normalized_field))
    return checks


def load_valid_manifest() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    catalog_bytes = corpus_gate.CATALOG_PATH.read_bytes()
    catalog = json.loads(catalog_bytes)
    manifest_bytes = corpus_gate.DEFAULT_MANIFEST.read_bytes()
    manifest = json.loads(manifest_bytes)
    corpus_gate.validate_document(manifest, catalog, catalog_bytes)
    binding = {
        "id": manifest["corpus_id"],
        "sha256": manifest["corpus_sha256"],
        "manifest_sha256": corpus_gate.sha256_bytes(manifest_bytes),
        "catalog_sha256": manifest["catalog_sha256"],
        "catalog_data_release": manifest["catalog_data_release"],
        "cases": len(manifest["cases"]),
        "expectation": "observe",
    }
    return catalog, manifest, binding


def stage_catalog(catalog: dict[str, Any], destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    seen_modules: set[str] = set()
    for row in catalog["modules"]:
        module = row["id"]
        if module in seen_modules:
            fail(f"duplicate catalog module while staging: {module}")
        seen_modules.add(module)
        source, _relative = corpus_gate.resolve_catalog_path(row["raw_path"], module)
        if corpus_gate.sha256_file(source) != row["artifact_sha256"]:
            fail(f"catalog dependency hash drifted: {module}")
        shutil.copyfile(source, destination / f"{module}.mib")


def adapter_case(case: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": case["id"],
        "module": case["module"],
        "file": f"{case['module']}.mib",
        "identity": case["probe_symbol"],
        "detail_symbols": case["detail_symbols"],
    }


def run_candidate(
    candidate: str,
    results_dir: Path,
    catalog: dict[str, Any],
    manifest: dict[str, Any],
    corpus_binding: dict[str, Any],
) -> dict[str, Any]:
    binary = harness.find_binary(candidate)
    if not binary:
        fail(f"{candidate} binary not found; set the matching BAKEOFF_* environment variable")
    with tempfile.TemporaryDirectory(prefix="mibvendor-public-bakeoff-") as temporary:
        temporary_path = Path(temporary)
        staged_corpus = temporary_path / "corpus"
        stage_catalog(catalog, staged_corpus)
        work = temporary_path / "work" / candidate
        work.mkdir(parents=True)
        harness.CORPUS = staged_corpus
        adapter_class = {
            "pysmi": harness.PysmiAdapter,
            "libsmi": harness.LibsmiAdapter,
            "net-snmp": harness.NetsnmpAdapter,
        }[candidate]
        adapter = adapter_class(binary.resolve(), work)
        started = datetime.now(timezone.utc)
        case_results: list[dict[str, Any]] = []
        total_wall = 0.0
        total_user = 0.0
        total_system = 0.0
        peak_rss = 0
        for public_case in manifest["cases"]:
            case = adapter_case(public_case)
            runs = [adapter.run_once(case, 1), adapter.run_once(case, 2)]
            for run in runs:
                for measurement in measurements(run["measurement"]):
                    total_wall += measurement["wall_seconds"]
                    total_user += measurement["user_cpu_seconds"]
                    total_system += measurement["system_cpu_seconds"]
                    peak_rss = max(peak_rss, measurement["peak_child_rss_kib_so_far"])
            first = runs[0]
            timed_out = any(
                measurement["timed_out"]
                for run in runs
                for measurement in measurements(run["measurement"])
            )
            checks = feature_checks(first["normalized"], public_case["features"]) if first["success"] else {
                key: False
                for key in feature_checks({}, public_case["features"])
            }
            case_results.append(
                {
                    "id": public_case["id"],
                    "module": public_case["module"],
                    "success": first["success"],
                    "timed_out": timed_out,
                    "normalized_output_deterministic": runs[0]["normalized_sha256"] == runs[1]["normalized_sha256"],
                    "normalized_sha256": runs[0]["normalized_sha256"],
                    "feature_checks": checks,
                    "diagnostic_bytes": len(first["diagnostics"].encode()),
                    "diagnostic_sha256": harness.sha256(first["diagnostics"].encode()),
                    "runs": [
                        {
                            "success": run["success"],
                            "measurement": compact_measurement(run["measurement"]),
                            "normalized_sha256": run["normalized_sha256"],
                        }
                        for run in runs
                    ],
                }
            )

    checks = [passed for case in case_results for passed in case["feature_checks"].values()]
    result = {
        "schema_version": 1,
        "candidate": candidate,
        "version": adapter.version(),
        "execution_mode": os.environ.get("BAKEOFF_EXECUTION_MODE", "local"),
        "started_at": started.isoformat(),
        "host": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "source_commit": os.environ.get("BAKEOFF_SOURCE_COMMIT"),
        "corpus": corpus_binding,
        "summary": {
            "cases": len(case_results),
            "parse_success": sum(case["success"] for case in case_results),
            "timeout_cases": sum(case["timed_out"] for case in case_results),
            "normalized_deterministic_cases": sum(
                case["normalized_output_deterministic"] for case in case_results
            ),
            "feature_checks_passed": sum(checks),
            "feature_checks_total": len(checks),
            "total_measured_wall_seconds": round(total_wall, 6),
            "total_user_cpu_seconds": round(total_user, 6),
            "total_system_cpu_seconds": round(total_system, 6),
            "peak_child_rss_kib": peak_rss,
            "installed_footprint_bytes": harness.dir_size_bytes(adapter.footprint_root()),
            "container_image_bytes": None,
        },
        "cases": case_results,
    }
    results_dir.mkdir(parents=True, exist_ok=True)
    (results_dir / f"{candidate}.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return result


def aggregate(
    results_dir: Path,
    manifest: dict[str, Any],
    corpus_binding: dict[str, Any],
) -> dict[str, Any]:
    candidates = []
    for candidate in CANDIDATES:
        path = results_dir / f"{candidate}.json"
        if path.is_file():
            document = json.loads(path.read_text(encoding="utf-8"))
            if document.get("corpus") != corpus_binding:
                fail(f"{candidate} result is not bound to the active public manifest")
            candidates.append({"candidate": candidate, "version": document["version"], **document["summary"]})
    if not candidates:
        fail(f"no candidate results found in {results_dir}")
    summary = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "corpus_id": manifest["corpus_id"],
        "public_bakeoff_evidence_gate": "awaiting-linux-amd64-and-arm64-validation",
        "canonical_parser_gate": {
            "status": "open",
            "reasons": manifest["scope"]["open_reasons"],
        },
        "candidates": candidates,
    }
    (results_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", choices=[*CANDIDATES, "all"], default="all")
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--aggregate-only", action="store_true")
    args = parser.parse_args()
    results_dir = args.results_dir.resolve()
    catalog, manifest, corpus_binding = load_valid_manifest()
    if not args.aggregate_only:
        if args.candidate == "all":
            for candidate in CANDIDATES:
                subprocess.run(
                    [
                        sys.executable,
                        str(Path(__file__).resolve()),
                        "--candidate",
                        candidate,
                        "--results-dir",
                        str(results_dir),
                    ],
                    check=True,
                    env=os.environ.copy(),
                )
        else:
            run_candidate(args.candidate, results_dir, catalog, manifest, corpus_binding)
    aggregate(results_dir, manifest, corpus_binding)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
