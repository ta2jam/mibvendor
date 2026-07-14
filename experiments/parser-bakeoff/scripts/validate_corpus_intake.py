#!/usr/bin/env python3
"""Validate a private 100-case corpus without emitting MIB contents."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from datetime import date
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parents[1]
DEFAULT_RIGHTS_MATRIX = REPOSITORY / "docs/research/rights/rights-matrix.csv"
CATEGORY_COUNTS = {
    "ietf-iana": 20,
    "vendor-valid": 20,
    "vendor-broken": 20,
    "revision-pair": 20,
    "collision-import": 20,
}
MANIFEST_KEYS = {"schema_version", "corpus_id", "cases"}
CASE_KEYS = {
    "id",
    "category",
    "module",
    "file",
    "expected",
    "source_id",
    "source_url",
    "acquired_at",
    "sha256",
    "rights",
    "comparison_group",
}
RIGHTS_KEYS = {
    "testing_status",
    "evidence_ref",
    "evidence_sha256",
    "redistribution_status",
}
MIB_SUFFIXES = {".mib", ".my", ".smiv1", ".smiv2"}
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_CORPUS_BYTES = 200 * 1024 * 1024
MAX_EVIDENCE_BYTES = 5 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024


def fail(message: str) -> None:
    raise SystemExit(f"corpus intake validation failed: {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def known_sources(path: Path) -> dict[str, str]:
    with path.open(newline="") as source:
        rows = list(csv.DictReader(source))
    require(rows, "rights matrix is empty")
    return {row["source_id"]: row["source_vendor"] for row in rows}


def parse_date(value: object, label: str) -> date:
    require(isinstance(value, str), f"{label} must be an ISO date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        fail(f"{label} must be an ISO date")
    require(parsed <= date.today(), f"{label} is in the future")
    return parsed


def validate_url(value: object, label: str) -> None:
    require(isinstance(value, str) and len(value) <= 2048, f"{label} must be an HTTPS URL")
    parsed = urlparse(value)
    require(parsed.scheme == "https" and bool(parsed.netloc), f"{label} must be an HTTPS URL")
    require(not parsed.username and not parsed.password, f"{label} must not contain credentials")


def resolve_case_file(corpus_dir: Path, value: object, case_id: str) -> Path:
    require(isinstance(value, str) and 1 <= len(value) <= 500, f"{case_id} has no usable file path")
    relative = PurePosixPath(value)
    require(not relative.is_absolute() and ".." not in relative.parts, f"{case_id} file escapes corpus root")
    require(
        all(bool(re.fullmatch(r"[A-Za-z0-9._-]{1,128}", part)) for part in relative.parts),
        f"{case_id} file path contains unsupported characters",
    )
    require(relative.suffix.lower() in MIB_SUFFIXES, f"{case_id} has an unsupported file suffix")
    path = corpus_dir.joinpath(*relative.parts)
    require(path.is_file() and not path.is_symlink(), f"{case_id} file is missing or is a symlink")
    try:
        path.resolve().relative_to(corpus_dir.resolve())
    except ValueError:
        fail(f"{case_id} file escapes corpus root")
    return path


def resolve_evidence_file(evidence_dir: Path, value: object, case_id: str) -> Path:
    require(
        isinstance(value, str) and 1 <= len(value) <= 500,
        f"{case_id} has no usable rights evidence reference",
    )
    relative = PurePosixPath(value)
    require(
        not relative.is_absolute() and ".." not in relative.parts,
        f"{case_id} rights evidence escapes evidence root",
    )
    require(
        all(bool(re.fullmatch(r"[A-Za-z0-9._-]{1,128}", part)) for part in relative.parts),
        f"{case_id} rights evidence path contains unsupported characters",
    )
    path = evidence_dir.joinpath(*relative.parts)
    require(path.is_file() and not path.is_symlink(), f"{case_id} rights evidence is missing or is a symlink")
    try:
        path.resolve().relative_to(evidence_dir.resolve())
    except ValueError:
        fail(f"{case_id} rights evidence escapes evidence root")
    require(
        0 < path.stat().st_size <= MAX_EVIDENCE_BYTES,
        f"{case_id} rights evidence size is outside the 1 byte-5 MiB limit",
    )
    return path


def validate_case(
    case: object,
    corpus_dir: Path,
    evidence_dir: Path,
    evidence_hashes: dict[Path, str],
    sources: dict[str, str],
) -> tuple[str, str, str, int, str | None]:
    require(isinstance(case, dict), "every case must be an object")
    unknown = set(case) - CASE_KEYS
    require(not unknown, f"case contains unsupported fields: {sorted(unknown)}")
    required = CASE_KEYS - {"comparison_group"}
    missing = required - set(case)
    require(not missing, f"case is missing fields: {sorted(missing)}")

    case_id = case["id"]
    require(
        isinstance(case_id, str) and bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{2,79}", case_id)),
        "case id must be a 3-80 character lowercase slug",
    )
    category = case["category"]
    require(category in CATEGORY_COUNTS, f"{case_id} has an invalid category")
    module = case["module"]
    require(
        isinstance(module, str) and bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,127}", module)),
        f"{case_id} has an invalid module name",
    )
    expected = case["expected"]
    require(expected in {"success", "failure"}, f"{case_id} has an invalid expected result")
    if category in {"ietf-iana", "vendor-valid", "revision-pair"}:
        require(expected == "success", f"{case_id} category requires expected=success")
    if category == "vendor-broken":
        require(expected == "failure", f"{case_id} category requires expected=failure")

    source_id = case["source_id"]
    require(source_id in sources, f"{case_id} source_id is absent from the rights matrix")
    source_vendor = sources[source_id].lower()
    if category == "ietf-iana":
        require("ietf" in source_vendor or "iana" in source_vendor, f"{case_id} is not an IETF/IANA source")
    if category in {"vendor-valid", "vendor-broken"}:
        require("ietf" not in source_vendor and "iana" not in source_vendor, f"{case_id} is not a vendor source")

    validate_url(case["source_url"], f"{case_id} source_url")
    parse_date(case["acquired_at"], f"{case_id} acquired_at")
    declared_hash = case["sha256"]
    require(
        isinstance(declared_hash, str) and bool(re.fullmatch(r"[0-9a-f]{64}", declared_hash)),
        f"{case_id} has an invalid SHA-256",
    )

    rights = case["rights"]
    require(isinstance(rights, dict), f"{case_id} rights must be an object")
    require(set(rights) == RIGHTS_KEYS, f"{case_id} rights fields must be exactly {sorted(RIGHTS_KEYS)}")
    require(rights["testing_status"] == "approved", f"{case_id} has no approved testing scope")
    require(
        rights["redistribution_status"] in {"approved", "denied", "unknown"},
        f"{case_id} has an invalid redistribution status",
    )
    evidence_path = resolve_evidence_file(evidence_dir, rights["evidence_ref"], case_id)
    evidence_declared_hash = rights["evidence_sha256"]
    require(
        isinstance(evidence_declared_hash, str)
        and bool(re.fullmatch(r"[0-9a-f]{64}", evidence_declared_hash)),
        f"{case_id} has an invalid rights evidence SHA-256",
    )
    if evidence_path not in evidence_hashes:
        evidence_hashes[evidence_path] = sha256_file(evidence_path)
    evidence_actual_hash = evidence_hashes[evidence_path]
    require(
        evidence_actual_hash == evidence_declared_hash,
        f"{case_id} rights evidence SHA-256 does not match its file",
    )

    comparison_group = case.get("comparison_group")
    if category == "revision-pair":
        require(
            isinstance(comparison_group, str)
            and bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{2,79}", comparison_group)),
            f"{case_id} revision case has no comparison_group",
        )
    elif comparison_group is not None:
        require(
            isinstance(comparison_group, str)
            and bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{2,79}", comparison_group)),
            f"{case_id} has an invalid comparison_group",
        )

    path = resolve_case_file(corpus_dir, case["file"], case_id)
    size = path.stat().st_size
    require(0 < size <= MAX_FILE_BYTES, f"{case_id} file size is outside the 1 byte-10 MiB limit")
    actual_hash = sha256_file(path)
    require(actual_hash == declared_hash, f"{case_id} SHA-256 does not match its file")
    return case_id, str(case["file"]), declared_hash, size, comparison_group


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--corpus-dir", type=Path, required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--rights-matrix", type=Path, default=DEFAULT_RIGHTS_MATRIX)
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    corpus_dir = args.corpus_dir.resolve()
    evidence_dir = args.evidence_dir.resolve()
    require(manifest_path.is_file(), "manifest is missing")
    require(0 < manifest_path.stat().st_size <= MAX_MANIFEST_BYTES, "manifest exceeds the 1 MiB limit")
    require(corpus_dir.is_dir(), "corpus directory is missing")
    require(evidence_dir.is_dir(), "rights evidence directory is missing")
    document = json.loads(manifest_path.read_text())
    require(isinstance(document, dict), "manifest must be an object")
    require(set(document) == MANIFEST_KEYS, f"manifest fields must be exactly {sorted(MANIFEST_KEYS)}")
    require(document["schema_version"] == 1, "unsupported schema_version")
    require(
        isinstance(document["corpus_id"], str)
        and bool(re.fullmatch(r"[a-z0-9][a-z0-9.-]{2,79}", document["corpus_id"])),
        "corpus_id must be a 3-80 character lowercase identifier",
    )
    cases = document["cases"]
    require(isinstance(cases, list) and len(cases) == 100, "manifest must contain exactly 100 cases")

    sources = known_sources(args.rights_matrix.resolve())
    categories = Counter()
    case_ids: set[str] = set()
    file_names: set[str] = set()
    hashes: set[str] = set()
    revision_groups: Counter[str] = Counter()
    evidence_hashes: dict[Path, str] = {}
    total_bytes = 0
    for case in cases:
        case_id, file_name, digest, size, comparison_group = validate_case(
            case,
            corpus_dir,
            evidence_dir,
            evidence_hashes,
            sources,
        )
        require(case_id not in case_ids, f"duplicate case id: {case_id}")
        require(file_name not in file_names, f"duplicate case file: {file_name}")
        require(digest not in hashes, f"duplicate case content: {case_id}")
        case_ids.add(case_id)
        file_names.add(file_name)
        hashes.add(digest)
        categories[case["category"]] += 1
        total_bytes += size
        if case["category"] == "revision-pair":
            revision_groups[str(comparison_group)] += 1

    require(dict(categories) == CATEGORY_COUNTS, f"category counts are {dict(categories)}, expected {CATEGORY_COUNTS}")
    require(
        len(revision_groups) == 10 and all(count == 2 for count in revision_groups.values()),
        "revision-pair cases must form 10 distinct two-file comparison groups",
    )
    require(total_bytes <= MAX_CORPUS_BYTES, "corpus exceeds the 200 MiB intake limit")
    print(
        json.dumps(
            {
                "corpus_id": document["corpus_id"],
                "cases": len(cases),
                "categories": dict(sorted(categories.items())),
                "unique_files": len(file_names),
                "total_bytes": total_bytes,
                "rights_testing_scope": "approved",
                "unique_rights_evidence_files": len(evidence_hashes),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
