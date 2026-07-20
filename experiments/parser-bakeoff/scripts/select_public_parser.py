#!/usr/bin/env python3
"""Select the canonical parser from validated public and CC0 evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import subprocess
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import public_corpus_gate as corpus_gate  # noqa: E402
import validate_public_multiarch_results as multiarch  # noqa: E402


CANDIDATES = tuple(multiarch.CANDIDATE_VERSIONS)
PUBLIC_PARSE_THRESHOLD = 0.90
PUBLIC_FEATURE_THRESHOLD = 0.90
EDGE_EXPECTATIONS = 9
EDGE_FIELDS = 10


def fail(message: str) -> None:
    raise SystemExit(f"parser selection failed: {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def load_json(path: Path) -> dict[str, Any]:
    require(path.is_file(), f"{path} is missing")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"{path} is not valid JSON: {error}")
    require(isinstance(value, dict), f"{path} must contain an object")
    return value


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def edge_candidates(directory: Path) -> dict[str, dict[str, Any]]:
    validation = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "validate_results.py"), str(directory)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        text=True,
    )
    require(
        validation.returncode == 0,
        f"{directory} failed CC0 result validation: {(validation.stderr or validation.stdout).strip()}",
    )
    summary_path = directory / "summary.json"
    summary = load_json(summary_path)
    require(summary.get("parser_gate", {}).get("status") == "provisional",
            f"{summary_path} must remain historical provisional evidence")
    rows = summary.get("candidates")
    require(isinstance(rows, list), f"{summary_path} candidates are missing")
    candidates = {row.get("candidate"): row for row in rows if isinstance(row, dict)}
    require(set(candidates) == set(CANDIDATES), f"{summary_path} candidate set drifted")
    for candidate, version in multiarch.CANDIDATE_VERSIONS.items():
        row = candidates[candidate]
        require(row.get("version") == version, f"{summary_path} {candidate} version drifted")
        require(row.get("expectations_total") == EDGE_EXPECTATIONS,
                f"{summary_path} {candidate} edge-case count drifted")
        require(row.get("field_fidelity_total") == EDGE_FIELDS,
                f"{summary_path} {candidate} field count drifted")
    return candidates


def feature_breakdown(document: dict[str, Any]) -> dict[str, dict[str, float | int]]:
    values: dict[str, list[bool]] = {}
    for case in document["cases"]:
        for feature, passed in case["feature_checks"].items():
            values.setdefault(feature, []).append(passed)
    return {
        feature: {
            "passed": sum(checks),
            "total": len(checks),
            "rate": round(sum(checks) / len(checks), 6),
        }
        for feature, checks in sorted(values.items())
    }


def run_measurement(candidate: str, run: dict[str, Any]) -> dict[str, float | int]:
    measurement = run["measurement"]
    phases = [measurement[phase] for phase in ("lint", "dump")] if candidate == "libsmi" else [measurement]
    return {
        "wall_seconds": sum(float(phase["wall_seconds"]) for phase in phases),
        "user_cpu_seconds": sum(float(phase["user_cpu_seconds"]) for phase in phases),
        "system_cpu_seconds": sum(float(phase["system_cpu_seconds"]) for phase in phases),
        "peak_child_rss_kib_so_far": max(int(phase["peak_child_rss_kib_so_far"]) for phase in phases),
    }


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * fraction) - 1)
    return ordered[index]


def process_isolated_metrics(candidate: str, document: dict[str, Any]) -> dict[str, Any]:
    samples = [run_measurement(candidate, run) for case in document["cases"] for run in case["runs"]]
    wall = [float(sample["wall_seconds"]) for sample in samples]
    return {
        "process_model": "one-bounded-artifact-per-adapter-envelope",
        "cases": len(document["cases"]),
        "repetitions": len(document["cases"][0]["runs"]),
        "artifact_run_samples": len(samples),
        "wall_seconds": {
            "median": round(statistics.median(wall), 6),
            "p95": round(percentile(wall, 0.95), 6),
            "maximum": round(max(wall), 6),
            "sum": round(sum(wall), 6),
        },
        "artifact_runs_per_measured_wall_second": round(len(samples) / sum(wall), 6),
        "total_user_cpu_seconds": document["summary"]["total_user_cpu_seconds"],
        "total_system_cpu_seconds": document["summary"]["total_system_cpu_seconds"],
        "peak_child_rss_kib": document["summary"]["peak_child_rss_kib"],
        "installed_footprint_bytes": document["summary"]["installed_footprint_bytes"],
        "container_image_bytes": document["summary"]["container_image_bytes"],
    }


def public_metrics(document: dict[str, Any]) -> dict[str, Any]:
    summary = document["summary"]
    cases = summary["cases"]
    checks = summary["feature_checks_total"]
    return {
        "parse_success": summary["parse_success"],
        "cases": cases,
        "parse_rate": round(summary["parse_success"] / cases, 6),
        "feature_checks_passed": summary["feature_checks_passed"],
        "feature_checks_total": checks,
        "feature_rate": round(summary["feature_checks_passed"] / checks, 6),
        "timeout_cases": summary["timeout_cases"],
        "normalized_deterministic_cases": summary["normalized_deterministic_cases"],
        "features": feature_breakdown(document),
    }


def edge_metrics(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: row[key]
        for key in (
            "expectations_met",
            "expectations_total",
            "field_fidelity_passed",
            "field_fidelity_total",
            "collision_module_qualified_preserved",
            "valid_parse_success",
            "valid_parse_total",
            "invalid_rejected",
            "invalid_total",
            "normalized_deterministic_cases",
            "timeout_cases",
        )
    }


def qualification_failures(
    candidate: str,
    public_by_arch: dict[str, dict[str, Any]],
    edge_by_arch: dict[str, dict[str, Any]],
) -> list[str]:
    failures: list[str] = []
    for architecture, document in public_by_arch.items():
        metrics = public_metrics(document)
        if metrics["parse_rate"] < PUBLIC_PARSE_THRESHOLD:
            failures.append(f"{architecture}:public-parse-rate")
        if metrics["feature_rate"] < PUBLIC_FEATURE_THRESHOLD:
            failures.append(f"{architecture}:public-feature-rate")
        if metrics["timeout_cases"] != 0:
            failures.append(f"{architecture}:public-timeout")
        if metrics["normalized_deterministic_cases"] != metrics["cases"]:
            failures.append(f"{architecture}:public-nondeterminism")
        if any(feature["passed"] == 0 for feature in metrics["features"].values()):
            failures.append(f"{architecture}:missing-feature-class")
    for architecture, row in edge_by_arch.items():
        if row["expectations_met"] != row["expectations_total"] or row["expectations_total"] != EDGE_EXPECTATIONS:
            failures.append(f"{architecture}:edge-expectations")
        if row["field_fidelity_passed"] != row["field_fidelity_total"] or row["field_fidelity_total"] != EDGE_FIELDS:
            failures.append(f"{architecture}:edge-field-fidelity")
        if row["collision_module_qualified_preserved"] is not True:
            failures.append(f"{architecture}:edge-collision")
        if row["valid_parse_success"] != row["valid_parse_total"]:
            failures.append(f"{architecture}:edge-valid-parse")
        if row["invalid_rejected"] != row["invalid_total"]:
            failures.append(f"{architecture}:edge-invalid-rejection")
        if row["normalized_deterministic_cases"] != EDGE_EXPECTATIONS:
            failures.append(f"{architecture}:edge-nondeterminism")
        if row["timeout_cases"] != 0:
            failures.append(f"{architecture}:edge-timeout")
    return sorted(failures)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-source-commit", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("amd64_public", type=Path)
    parser.add_argument("arm64_public", type=Path)
    parser.add_argument("amd64_edge", type=Path)
    parser.add_argument("arm64_edge", type=Path)
    args = parser.parse_args()

    require(len(args.expected_source_commit) == 40
            and all(character in "0123456789abcdef" for character in args.expected_source_commit),
            "expected source commit must be a full lowercase Git digest")

    catalog_bytes = corpus_gate.CATALOG_PATH.read_bytes()
    catalog = json.loads(catalog_bytes)
    manifest_bytes = corpus_gate.DEFAULT_MANIFEST.read_bytes()
    manifest = json.loads(manifest_bytes)
    corpus_gate.validate_document(manifest, catalog, catalog_bytes)
    expected_corpus = {
        "id": manifest["corpus_id"],
        "sha256": manifest["corpus_sha256"],
        "manifest_sha256": corpus_gate.sha256_bytes(manifest_bytes),
        "catalog_sha256": manifest["catalog_sha256"],
        "catalog_data_release": manifest["catalog_data_release"],
        "cases": len(manifest["cases"]),
        "expectation": "observe",
    }
    public = {
        "linux-amd64": multiarch.validate_architecture(
            args.amd64_public.resolve(), "x86_64", manifest, expected_corpus, args.expected_source_commit
        ),
        "linux-arm64": multiarch.validate_architecture(
            args.arm64_public.resolve(), "aarch64", manifest, expected_corpus, args.expected_source_commit
        ),
    }
    for candidate in CANDIDATES:
        require(
            multiarch.parity_projection(public["linux-amd64"][candidate])
            == multiarch.parity_projection(public["linux-arm64"][candidate]),
            f"{candidate} public output differs across architectures",
        )

    edge = {
        "linux-amd64": edge_candidates(args.amd64_edge.resolve()),
        "linux-arm64": edge_candidates(args.arm64_edge.resolve()),
    }
    candidates: dict[str, Any] = {}
    qualified: list[str] = []
    for candidate in CANDIDATES:
        public_by_arch = {architecture: documents[candidate] for architecture, documents in public.items()}
        edge_by_arch = {architecture: rows[candidate] for architecture, rows in edge.items()}
        failures = qualification_failures(candidate, public_by_arch, edge_by_arch)
        if not failures:
            qualified.append(candidate)
        candidates[candidate] = {
            "version": multiarch.CANDIDATE_VERSIONS[candidate],
            "qualified": not failures,
            "failed_thresholds": failures,
            "public": {
                architecture: public_metrics(document)
                for architecture, document in public_by_arch.items()
            },
            "cc0_edge": {
                architecture: edge_metrics(row)
                for architecture, row in edge_by_arch.items()
            },
            "process_isolated_measurements": {
                architecture: process_isolated_metrics(candidate, document)
                for architecture, document in public_by_arch.items()
            },
        }
    require(len(qualified) == 1, f"expected exactly one qualifying parser, found {qualified}")

    evidence_files: dict[str, str] = {}
    for label, directory in (
        ("public_linux_amd64", args.amd64_public),
        ("public_linux_arm64", args.arm64_public),
        ("edge_linux_amd64", args.amd64_edge),
        ("edge_linux_arm64", args.arm64_edge),
    ):
        for filename in ("summary.json", "pysmi.json", "libsmi.json", "net-snmp.json"):
            evidence_files[f"{label}/{filename}"] = sha256_file(directory / filename)

    selected = qualified[0]
    result = {
        "schema_version": 1,
        "status": "passed",
        "canonical_parser": selected,
        "canonical_parser_version": multiarch.CANDIDATE_VERSIONS[selected],
        "source_commit": args.expected_source_commit,
        "corpus": expected_corpus,
        "execution_contract": {
            "unit": "one bounded immutable artifact to one parser-adapter envelope",
            "process_isolation": "one parser CLI process per artifact and repetition",
            "network": "disabled",
            "repetitions": 2,
            "warm_shared_process_benchmark": "not-applicable-to-selected-contract",
        },
        "thresholds": {
            "public_parse_rate_minimum": PUBLIC_PARSE_THRESHOLD,
            "public_feature_rate_minimum": PUBLIC_FEATURE_THRESHOLD,
            "public_timeout_cases": 0,
            "public_normalized_determinism": 1.0,
            "public_each_feature_class_minimum_passes": 1,
            "cc0_expectations": EDGE_EXPECTATIONS,
            "cc0_field_fidelity": EDGE_FIELDS,
            "cc0_module_qualified_collision_required": True,
        },
        "selection_rule": "exactly-one-candidate-meets-all-thresholds",
        "candidates": candidates,
        "evidence_sha256": dict(sorted(evidence_files.items())),
        "limitations": [
            "The public corpus measures positive breadth, not real proprietary malformed inputs.",
            "The adapter contract intentionally measures process-isolated artifacts, not a shared warm parser process.",
            "A passing aggregate feature threshold does not erase the recorded per-feature and per-file failures.",
        ],
    }
    serialized = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
