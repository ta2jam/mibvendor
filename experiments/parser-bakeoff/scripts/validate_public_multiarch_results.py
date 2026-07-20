#!/usr/bin/env python3
"""Validate complete public-corpus evidence on Linux amd64 and arm64."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import public_corpus_gate as corpus_gate  # noqa: E402


CANDIDATE_VERSIONS = {
    "pysmi": "2.0.0",
    "libsmi": "0.5.0",
    "net-snmp": "5.9.4.pre2",
}
ARCHITECTURES = {"x86_64": "linux-amd64", "aarch64": "linux-arm64"}
MEASUREMENT_KEYS = {
    "returncode",
    "timed_out",
    "wall_seconds",
    "user_cpu_seconds",
    "system_cpu_seconds",
    "peak_child_rss_kib_so_far",
}


def fail(message: str) -> None:
    raise SystemExit(f"public multi-architecture validation failed: {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def load_candidate(
    directory: Path,
    candidate: str,
    expected_corpus: dict[str, Any],
    expected_source_commit: str | None,
) -> dict[str, Any]:
    path = directory / f"{candidate}.json"
    require(path.is_file(), f"{path} is missing")
    document = json.loads(path.read_text(encoding="utf-8"))
    require(document.get("schema_version") == 1, f"{path} has an unsupported schema")
    require(document.get("candidate") == candidate, f"{path} has the wrong candidate")
    require(document.get("version") == CANDIDATE_VERSIONS[candidate], f"{candidate} version is not pinned")
    require(document.get("execution_mode") == "container", f"{candidate} was not run in a container")
    source_commit = document.get("source_commit")
    require(
        isinstance(source_commit, str) and re.fullmatch(r"[0-9a-f]{40}", source_commit) is not None,
        f"{candidate} source commit is missing or invalid",
    )
    if expected_source_commit is not None:
        require(source_commit == expected_source_commit, f"{candidate} source commit does not match the workflow")
    require(document.get("corpus") == expected_corpus, f"{candidate} is not bound to the active manifest")
    return document


def require_nonnegative_number(value: object, label: str) -> float:
    require(
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0,
        f"{label} is not a finite nonnegative number",
    )
    return float(value)


def validate_measurement(value: object, label: str) -> dict[str, Any]:
    require(isinstance(value, dict) and set(value) == MEASUREMENT_KEYS, f"{label} measurement shape drifted")
    require(isinstance(value["timed_out"], bool), f"{label} timeout state is invalid")
    require(not value["timed_out"], f"{label} timed out")
    require(
        isinstance(value["returncode"], int) and not isinstance(value["returncode"], bool),
        f"{label} return code is invalid",
    )
    require_nonnegative_number(value["wall_seconds"], f"{label} wall time")
    require_nonnegative_number(value["user_cpu_seconds"], f"{label} user CPU")
    require_nonnegative_number(value["system_cpu_seconds"], f"{label} system CPU")
    require(
        isinstance(value["peak_child_rss_kib_so_far"], int)
        and not isinstance(value["peak_child_rss_kib_so_far"], bool)
        and value["peak_child_rss_kib_so_far"] >= 0,
        f"{label} peak RSS is invalid",
    )
    return value


def case_measurements(candidate: str, run: dict[str, Any], label: str) -> list[dict[str, Any]]:
    measurement = run.get("measurement")
    if candidate == "libsmi":
        require(
            isinstance(measurement, dict) and set(measurement) == {"lint", "dump"},
            f"{label} must contain separate lint and dump measurements",
        )
        return [
            validate_measurement(measurement[phase], f"{label}/{phase}")
            for phase in ("lint", "dump")
        ]
    return [validate_measurement(measurement, label)]


def validate_architecture(
    directory: Path,
    machine: str,
    manifest: dict[str, Any],
    expected_corpus: dict[str, Any],
    expected_source_commit: str | None,
) -> dict[str, dict[str, Any]]:
    expected_ids = [case["id"] for case in manifest["cases"]]
    expected_modules = {case["id"]: case["module"] for case in manifest["cases"]}
    expected_features = {
        case["id"]: {
            feature
            for feature in case["features"]
            if feature in corpus_gate.OBSERVABLE_FEATURE_FIELDS
        }
        for case in manifest["cases"]
    }
    documents: dict[str, dict[str, Any]] = {}
    for candidate in CANDIDATE_VERSIONS:
        document = load_candidate(directory, candidate, expected_corpus, expected_source_commit)
        host = document.get("host", {})
        require(isinstance(host, dict), f"{candidate} host evidence is invalid")
        require(host.get("machine") == machine, f"{candidate} machine is not {machine}")
        require(str(host.get("platform", "")).startswith("Linux-"), f"{candidate} host is not Linux")
        cases = document.get("cases")
        require(isinstance(cases, list), f"{candidate} cases are missing")
        require([case.get("id") for case in cases] == expected_ids, f"{candidate} case order differs from manifest")
        for case in cases:
            case_id = case["id"]
            require(case.get("module") == expected_modules[case_id], f"{candidate} module drifted for {case_id}")
            require(isinstance(case.get("success"), bool), f"{candidate} success is not observed for {case_id}")
            require(case.get("timed_out") is False, f"{candidate} timed out for {case_id}")
            require(case.get("normalized_output_deterministic") is True,
                    f"{candidate} normalized output is nondeterministic for {case_id}")
            digest = case.get("normalized_sha256")
            require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest) is not None,
                    f"{candidate} normalized hash is invalid for {case_id}")
            checks = case.get("feature_checks")
            require(
                isinstance(checks, dict)
                and set(checks) == expected_features[case_id]
                and all(isinstance(value, bool) for value in checks.values()),
                f"{candidate} feature checks are invalid for {case_id}",
            )
            diagnostic_hash = case.get("diagnostic_sha256")
            require(isinstance(diagnostic_hash, str) and re.fullmatch(r"[0-9a-f]{64}", diagnostic_hash) is not None,
                    f"{candidate} diagnostic hash is invalid for {case_id}")
            require(isinstance(case.get("diagnostic_bytes"), int) and case["diagnostic_bytes"] >= 0,
                    f"{candidate} diagnostic size is invalid for {case_id}")
            runs = case.get("runs")
            require(
                isinstance(runs, list)
                and len(runs) == 2
                and all(isinstance(run, dict) for run in runs),
                f"{candidate} did not run {case_id} twice",
            )
            require(
                all(run.get("success") is case["success"] for run in runs),
                f"{candidate} run success states differ for {case_id}",
            )
            require(all(run.get("normalized_sha256") == digest for run in runs),
                    f"{candidate} run hashes differ for {case_id}")
            for repetition, run in enumerate(runs, start=1):
                observed = case_measurements(candidate, run, f"{candidate}/{case_id}/run-{repetition}")
                if case["success"]:
                    require(
                        all(measurement["returncode"] == 0 for measurement in observed),
                        f"{candidate} successful run has a nonzero status for {case_id}",
                    )
        summary = document.get("summary", {})
        require(isinstance(summary, dict), f"{candidate} summary is invalid")
        require(summary.get("cases") == 100, f"{candidate} summary case count drifted")
        require(summary.get("timeout_cases") == 0, f"{candidate} summary contains timeouts")
        require(summary.get("normalized_deterministic_cases") == 100,
                f"{candidate} summary overstates determinism")
        require(summary.get("parse_success") == sum(case["success"] for case in cases),
                f"{candidate} parse-success summary drifted")
        all_checks = [value for case in cases for value in case["feature_checks"].values()]
        require(summary.get("feature_checks_passed") == sum(all_checks),
                f"{candidate} passed-feature summary drifted")
        require(summary.get("feature_checks_total") == len(all_checks),
                f"{candidate} total-feature summary drifted")
        observed_measurements = [
            measurement
            for case in cases
            for repetition, run in enumerate(case["runs"], start=1)
            for measurement in case_measurements(
                candidate,
                run,
                f"{candidate}/{case['id']}/run-{repetition}",
            )
        ]
        for field in ("total_measured_wall_seconds", "total_user_cpu_seconds", "total_system_cpu_seconds"):
            source_field = {
                "total_measured_wall_seconds": "wall_seconds",
                "total_user_cpu_seconds": "user_cpu_seconds",
                "total_system_cpu_seconds": "system_cpu_seconds",
            }[field]
            expected_total = round(sum(float(item[source_field]) for item in observed_measurements), 6)
            require(summary.get(field) == expected_total, f"{candidate} {field} summary drifted")
        expected_peak = max(item["peak_child_rss_kib_so_far"] for item in observed_measurements)
        require(summary.get("peak_child_rss_kib") == expected_peak, f"{candidate} peak-RSS summary drifted")
        for field in ("installed_footprint_bytes", "container_image_bytes"):
            require(
                isinstance(summary.get(field), int)
                and not isinstance(summary[field], bool)
                and summary[field] > 0,
                f"{candidate} {field} is missing or invalid",
            )
        documents[candidate] = document
    return documents


def parity_projection(document: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": case["id"],
            "module": case["module"],
            "success": case["success"],
            "normalized_sha256": case["normalized_sha256"],
            "feature_checks": case.get("feature_checks", {}),
        }
        for case in document["cases"]
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-source-commit")
    parser.add_argument("amd64_dir", type=Path)
    parser.add_argument("arm64_dir", type=Path)
    args = parser.parse_args()

    catalog_bytes = corpus_gate.CATALOG_PATH.read_bytes()
    catalog = json.loads(catalog_bytes)
    manifest_bytes = corpus_gate.DEFAULT_MANIFEST.read_bytes()
    manifest = json.loads(manifest_bytes)
    corpus_gate.validate_document(manifest, catalog, catalog_bytes)
    if args.expected_source_commit is not None:
        require(
            re.fullmatch(r"[0-9a-f]{40}", args.expected_source_commit) is not None,
            "expected source commit is invalid",
        )
    expected_corpus = {
        "id": manifest["corpus_id"],
        "sha256": manifest["corpus_sha256"],
        "manifest_sha256": corpus_gate.sha256_bytes(manifest_bytes),
        "catalog_sha256": manifest["catalog_sha256"],
        "catalog_data_release": manifest["catalog_data_release"],
        "cases": len(manifest["cases"]),
        "expectation": "observe",
    }
    amd64 = validate_architecture(
        args.amd64_dir.resolve(),
        "x86_64",
        manifest,
        expected_corpus,
        args.expected_source_commit,
    )
    arm64 = validate_architecture(
        args.arm64_dir.resolve(),
        "aarch64",
        manifest,
        expected_corpus,
        args.expected_source_commit,
    )
    source_commits = {
        document["source_commit"]
        for documents in (amd64, arm64)
        for document in documents.values()
    }
    require(len(source_commits) == 1, "candidate evidence comes from different source commits")
    for candidate in CANDIDATE_VERSIONS:
        require(
            parity_projection(amd64[candidate]) == parity_projection(arm64[candidate]),
            f"{candidate} observed output differs across architectures",
        )
    print(
        json.dumps(
            {
                "public_bakeoff_evidence_gate": "passed",
                "cases": 100,
                "candidates": len(CANDIDATE_VERSIONS),
                "architectures": sorted(ARCHITECTURES.values()),
                "source_commit": next(iter(source_commits)),
                "manifest_sha256": expected_corpus["manifest_sha256"],
                "catalog_sha256": expected_corpus["catalog_sha256"],
                "canonical_parser_gate": "not-evaluated",
                "selection_input": "eligible",
                "limitations": [
                    "positive public breadth is separate from the CC0 malformed and revision-shape suite",
                    "candidate-specific thresholds and the selection decision are evaluated separately",
                ],
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
