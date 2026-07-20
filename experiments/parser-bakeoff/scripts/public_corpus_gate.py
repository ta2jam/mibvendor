#!/usr/bin/env python3
"""Build and validate the deterministic 100-file public parser corpus.

This gate proves corpus eligibility and breadth only.  It deliberately does not
claim parser correctness or select a canonical parser; those claims require
committed results from all pinned candidates on Linux amd64 and arm64 plus the
separate malformed/revision fixtures.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any, Callable
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = ROOT / "data/mib-catalog.json"
DEFAULT_MANIFEST = ROOT / "experiments/parser-bakeoff/public-corpus/manifest.json"
ALLOWED_ROOT = (ROOT / "data/mibs/redistributable").resolve()

SELECTION_SEED = "mibvendor-public-parser-breadth-v1"
STANDARD_SOURCES = {"iana-maintained-mibs", "ietf-post-2008", "net-snmp"}
CATEGORY_COUNTS = {
    "compatibility-edge": 20,
    "standards-origin": 20,
    "textual-convention": 20,
    "table-structure": 20,
    "repository-license-signal": 20,
}
EDGE_COUNTS = {
    "unresolved-static-baseline": 5,
    "dependency-heavy": 5,
    "legacy-smi": 10,
}
FEATURE_TOKENS = {
    "AGENT-CAPABILITIES": "agent-capabilities",
    "AUGMENTS": "augments",
    "IMPORTS": "imports",
    "INDEX": "table-index",
    "MODULE-COMPLIANCE": "module-compliance",
    "MODULE-IDENTITY": "module-identity",
    "NOTIFICATION-TYPE": "notification-type",
    "OBJECT-GROUP": "object-group",
    "OBJECT-TYPE": "object-type",
    "REVISION": "revision",
    "TEXTUAL-CONVENTION": "textual-convention",
    "TRAP-TYPE": "trap-type-v1",
}
OBSERVABLE_FEATURE_FIELDS = {
    "augments": "augments",
    "imports": "imports",
    "notification-type": "notifications",
    "revision": "revisions",
    "table-index": "indexes",
    "textual-convention": "textual_conventions",
    "trap-type-v1": "notifications",
}
MINIMUM_COVERAGE = {
    "augments": 10,
    "dependency-heavy": 10,
    "imports": 90,
    "legacy-smi": 15,
    "module-identity": 60,
    "notification-or-trap": 25,
    "object-type": 70,
    "revision": 40,
    "table-structure": 60,
    "textual-convention": 40,
    "unresolved-static-baseline": 5,
}
MAX_SOURCE_CASES = 30
MIN_DISTINCT_SOURCES = 8
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_CORPUS_BYTES = 32 * 1024 * 1024
ALLOWED_SUFFIXES = {"", ".mib", ".my", ".smiv1", ".smiv2", ".txt"}
RESERVED_PROBE_SYMBOLS = {
    "BEGIN",
    "DEFINITIONS",
    "END",
    "EXPORTS",
    "FROM",
    "IMPORTS",
    "OBJECTS",
    "STATUS",
    "SYNTAX",
}


def fail(message: str) -> None:
    raise SystemExit(f"public corpus gate failed: {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def strip_comments_and_strings(text: str) -> str:
    """Remove SMI line comments and quoted prose while retaining newlines."""
    output: list[str] = []
    index = 0
    in_string = False
    while index < len(text):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if in_string:
            if char == '"' and following == '"':
                output.extend((" ", " "))
                index += 2
                continue
            if char == '"':
                in_string = False
            output.append("\n" if char == "\n" else " ")
            index += 1
            continue
        if char == '"':
            in_string = True
            output.append(" ")
            index += 1
            continue
        if char == "-" and following == "-":
            while index < len(text) and text[index] not in "\r\n":
                output.append(" ")
                index += 1
            continue
        output.append(char)
        index += 1
    return "".join(output)


def has_token(text: str, token: str) -> bool:
    return bool(re.search(rf"(?<![A-Z0-9-]){re.escape(token)}(?![A-Z0-9-])", text))


def scan_file(path: Path, module: str) -> dict[str, Any]:
    clean_original = strip_comments_and_strings(path.read_text(encoding="utf-8", errors="replace"))
    clean = clean_original.upper()
    declaration = re.search(r"(?im)^\s*([A-Z][A-Z0-9-]*)\s+DEFINITIONS\s*::=", clean_original)
    require(declaration is not None, f"{path.relative_to(ROOT)} has no module declaration")
    require(declaration.group(1).upper() == module.upper(), f"{path.relative_to(ROOT)} declares a different module")

    features = sorted(public for token, public in FEATURE_TOKENS.items() if has_token(clean, token))
    feature_set = set(features)
    legacy = "trap-type-v1" in feature_set or (
        "module-identity" not in feature_set
        and bool(feature_set.intersection({"object-type", "trap-type-v1"}))
    )

    probe_patterns = (
        r"(?im)^[ \t]*([A-Z][A-Z0-9-]*)[ \t]+MODULE-IDENTITY\b",
        r"(?im)^[ \t]*([A-Z][A-Z0-9-]*)[ \t]+OBJECT-TYPE\b",
        r"(?im)^[ \t]*([A-Z][A-Z0-9-]*)[ \t]+NOTIFICATION-TYPE\b",
        r"(?im)^[ \t]*([A-Z][A-Z0-9-]*)[ \t]+TRAP-TYPE\b",
        r"(?im)^[ \t]*([A-Z][A-Z0-9-]*)[ \t]+OBJECT[ \t]+IDENTIFIER\b",
        r"(?im)^[ \t]*([A-Z][A-Z0-9-]*)[ \t]+::=[ \t]+TEXTUAL-CONVENTION\b",
    )

    def first_symbol(pattern: str) -> str | None:
        return next(
            (
                match.group(1)
                for match in re.finditer(pattern, clean_original)
                if match.group(1).upper() not in RESERVED_PROBE_SYMBOLS
            ),
            None,
        )

    representative_symbols = [first_symbol(pattern) for pattern in probe_patterns]
    probe_symbol = next((symbol for symbol in representative_symbols if symbol is not None), None)
    detail_symbols = list(
        dict.fromkeys(
            symbol
            for symbol in [probe_symbol, *representative_symbols]
            if symbol is not None
        )
    )
    object_blocks = re.finditer(
        r"(?ims)^[ \t]*([A-Z][A-Z0-9-]*)[ \t]+OBJECT-TYPE\b.*?::=[ \t]*\{.*?\}",
        clean_original,
    )
    for block in object_blocks:
        body = block.group(0).upper()
        if has_token(body, "INDEX") or has_token(body, "AUGMENTS"):
            detail_symbols.append(block.group(1))
    detail_symbols = list(dict.fromkeys(detail_symbols))[:8]
    return {
        "features": features,
        "legacy_smi": legacy,
        "probe_symbol": probe_symbol,
        "detail_symbols": detail_symbols,
    }


def resolve_catalog_path(raw_path: object, module: str) -> tuple[Path, str]:
    require(isinstance(raw_path, str) and raw_path, f"{module} has no catalog raw_path")
    relative = PurePosixPath("data") / PurePosixPath(raw_path)
    require(not relative.is_absolute() and ".." not in relative.parts, f"{module} path escapes the repository")
    require(relative.suffix.lower() in ALLOWED_SUFFIXES, f"{module} has an unsupported file suffix")
    path = ROOT.joinpath(*relative.parts)
    require(path.is_file() and not path.is_symlink(), f"{module} public file is missing or is a symlink")
    try:
        path.resolve().relative_to(ALLOWED_ROOT)
    except ValueError:
        fail(f"{module} file escapes the redistributable root")
    size = path.stat().st_size
    require(0 < size <= MAX_FILE_BYTES, f"{module} file size is outside the 1 byte-2 MiB limit")
    return path, relative.as_posix()


def load_candidates(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    require(catalog.get("schema_version") == 1, "unsupported catalog schema")
    modules = catalog.get("modules")
    require(isinstance(modules, list) and modules, "catalog has no modules")
    candidates: list[dict[str, Any]] = []
    for row in modules:
        module = row.get("id")
        require(isinstance(module, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,127}", module) is not None,
                "catalog contains an invalid module id")
        require(row.get("publication_mode") == "redistributable" and row.get("raw_download") is True,
                f"{module} is not an eligible redistributable raw module")
        path, relative = resolve_catalog_path(row.get("raw_path"), module)
        actual_hash = sha256_file(path)
        require(actual_hash == row.get("artifact_sha256"), f"{module} catalog artifact hash drifted")
        scan = scan_file(path, module)
        # Macro-only modules can be valid dependency inputs but cannot support
        # the same cross-parser detail probe as a bake-off case.
        if scan["probe_symbol"] is None:
            continue
        declared = row.get("declared_oid_count")
        resolved = row.get("resolved_oid_count")
        dependencies = row.get("dependencies")
        require(isinstance(declared, int) and declared >= 0 and isinstance(resolved, int) and resolved >= 0,
                f"{module} has invalid static counts")
        require(isinstance(dependencies, list) and all(isinstance(item, str) for item in dependencies),
                f"{module} has invalid dependencies")
        license_row = row.get("license")
        require(isinstance(license_row, dict) and isinstance(license_row.get("spdx"), str),
                f"{module} has no SPDX license evidence")
        source_id = row.get("source_id")
        require(
            isinstance(source_id, str)
            and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,127}", source_id) is not None,
            f"{module} has an invalid source id",
        )
        source_url = row.get("source_url")
        parsed_source_url = urlsplit(source_url) if isinstance(source_url, str) else None
        require(
            parsed_source_url is not None
            and parsed_source_url.scheme == "https"
            and bool(parsed_source_url.hostname)
            and parsed_source_url.username is None
            and parsed_source_url.password is None,
            f"{module} has an invalid source URL",
        )
        source_revision = row.get("source_revision")
        require(
            isinstance(source_revision, str) and 1 <= len(source_revision) <= 256,
            f"{module} has an invalid source revision",
        )
        license_spdx = license_row["spdx"]
        require(
            1 <= len(license_spdx) <= 128
            and re.fullmatch(r"[A-Za-z0-9.+-]+", license_spdx) is not None,
            f"{module} has an invalid SPDX license signal",
        )
        rights_basis = license_row.get("basis") or "source-specific-public-license"
        require(
            rights_basis in {"repository-license-signal", "source-specific-public-license"},
            f"{module} has an unsupported rights basis",
        )
        candidates.append(
            {
                "module": module,
                "file": relative,
                "sha256": actual_hash,
                "bytes": path.stat().st_size,
                "source_id": source_id,
                "source_url": source_url,
                "source_revision": source_revision,
                "license_spdx": license_spdx,
                "rights_basis": rights_basis,
                "declared_oid_count": declared,
                "resolved_oid_count": resolved,
                "dependency_count": len(dependencies),
                "features": scan["features"],
                "legacy_smi": scan["legacy_smi"],
                "probe_symbol": scan["probe_symbol"],
                "detail_symbols": scan["detail_symbols"],
                "unresolved_static_baseline": declared != resolved,
                "dependency_heavy": len(dependencies) >= 8,
            }
        )
    require(len({row["module"] for row in candidates}) == len(candidates), "catalog module ids are not unique")
    return candidates


def selection_rank(category: str, row: dict[str, Any]) -> str:
    return sha256_bytes(f"{SELECTION_SEED}\0{category}\0{row['sha256']}".encode())


def select_cases(candidates: list[dict[str, Any]]) -> list[tuple[str, str, dict[str, Any]]]:
    selected: list[tuple[str, str, dict[str, Any]]] = []
    selected_hashes: set[str] = set()
    source_counts: Counter[str] = Counter()

    def take(category: str, predicate: Callable[[dict[str, Any]], bool], count: int) -> None:
        eligible = sorted(
            (row for row in candidates if row["sha256"] not in selected_hashes and predicate(row)),
            key=lambda row: selection_rank(category, row),
        )
        taken = 0
        for row in eligible:
            if source_counts[row["source_id"]] >= MAX_SOURCE_CASES:
                continue
            public_category = "compatibility-edge" if category.startswith("compatibility-edge/") else category
            selection_basis = category.split("/", 1)[1] if "/" in category else category
            selected.append((public_category, selection_basis, row))
            selected_hashes.add(row["sha256"])
            source_counts[row["source_id"]] += 1
            taken += 1
            if taken == count:
                return
        fail(f"deterministic selection found only {taken}/{count} cases for {category}")

    take("compatibility-edge/unresolved-static-baseline", lambda row: row["unresolved_static_baseline"], 5)
    take("compatibility-edge/dependency-heavy", lambda row: row["dependency_heavy"], 5)
    take("compatibility-edge/legacy-smi", lambda row: row["legacy_smi"], 10)
    take("standards-origin", lambda row: row["source_id"] in STANDARD_SOURCES, 20)
    take("textual-convention", lambda row: "textual-convention" in row["features"], 20)
    take(
        "table-structure",
        lambda row: bool(set(row["features"]).intersection({"table-index", "augments"})),
        20,
    )
    take(
        "repository-license-signal",
        lambda row: row["source_id"] not in STANDARD_SOURCES
        and row["rights_basis"] == "repository-license-signal",
        20,
    )
    require(len(selected) == 100, "selection did not produce exactly 100 cases")
    return selected


def coverage_for(cases: list[dict[str, Any]]) -> Counter[str]:
    coverage: Counter[str] = Counter()
    for case in cases:
        features = set(case["features"])
        for feature in features:
            coverage[feature] += 1
        flags = set(case["compatibility_flags"])
        for flag in flags:
            coverage[flag] += 1
        if features.intersection({"notification-type", "trap-type-v1"}):
            coverage["notification-or-trap"] += 1
        if features.intersection({"table-index", "augments"}):
            coverage["table-structure"] += 1
    return coverage


def build_manifest(catalog: dict[str, Any], catalog_bytes: bytes) -> dict[str, Any]:
    selected = select_cases(load_candidates(catalog))
    cases = []
    for category, selection_basis, row in selected:
        flags = sorted(
            flag
            for flag, enabled in {
                "dependency-heavy": row["dependency_heavy"],
                "legacy-smi": row["legacy_smi"],
                "unresolved-static-baseline": row["unresolved_static_baseline"],
            }.items()
            if enabled
        )
        cases.append(
            {
                "id": f"{category}-{row['sha256'][:12]}",
                "category": category,
                "selection_basis": selection_basis,
                "module": row["module"],
                "file": row["file"],
                "sha256": row["sha256"],
                "bytes": row["bytes"],
                "source_id": row["source_id"],
                "source_url": row["source_url"],
                "source_revision": row["source_revision"],
                "license_spdx": row["license_spdx"],
                "rights_basis": row["rights_basis"],
                "expected": "observe",
                "probe_symbol": row["probe_symbol"],
                "detail_symbols": row["detail_symbols"],
                "features": row["features"],
                "compatibility_flags": flags,
                "static_baseline": {
                    "declared_oid_count": row["declared_oid_count"],
                    "resolved_oid_count": row["resolved_oid_count"],
                    "dependency_count": row["dependency_count"],
                },
            }
        )
    corpus_digest = hashlib.sha256()
    for case in cases:
        corpus_digest.update(case["file"].encode())
        corpus_digest.update(b"\0")
        corpus_digest.update(case["sha256"].encode())
        corpus_digest.update(b"\0")
    coverage = coverage_for(cases)
    return {
        "schema_version": 1,
        "corpus_id": "public-positive-breadth-v1",
        "selection_seed": SELECTION_SEED,
        "catalog_data_release": catalog.get("data_release"),
        "catalog_sha256": sha256_bytes(catalog_bytes),
        "corpus_sha256": corpus_digest.hexdigest(),
        "scope": {
            "eligibility_gate": "public-positive-breadth",
            "parser_results": "not-recorded",
            "canonical_parser_gate": "open",
            "open_reasons": [
                "no three-candidate results are committed for this corpus",
                "Linux amd64 and arm64 parity is not evidenced for this corpus",
                "positive public files do not replace malformed and revision-pair evidence",
            ],
        },
        "policy": {
            "cases": 100,
            "category_counts": CATEGORY_COUNTS,
            "compatibility_edge_counts": EDGE_COUNTS,
            "maximum_cases_per_source": MAX_SOURCE_CASES,
            "minimum_distinct_sources": MIN_DISTINCT_SOURCES,
            "minimum_coverage": MINIMUM_COVERAGE,
            "case_expectation": "observe",
        },
        "coverage": dict(sorted(coverage.items())),
        "cases": cases,
    }


def validate_document(
    document: dict[str, Any],
    catalog: dict[str, Any],
    catalog_bytes: bytes,
) -> dict[str, Any]:
    require(isinstance(document, dict), "manifest must be an object")
    require(document.get("schema_version") == 1, "unsupported manifest schema")
    scope = document.get("scope")
    require(isinstance(scope, dict), "manifest scope is missing")
    require(scope.get("eligibility_gate") == "public-positive-breadth", "eligibility scope was over-promoted")
    require(scope.get("parser_results") == "not-recorded", "manifest falsely claims parser results")
    require(scope.get("canonical_parser_gate") == "open", "manifest falsely closes canonical parser selection")
    cases = document.get("cases")
    require(isinstance(cases, list) and len(cases) == 100, "manifest must contain exactly 100 cases")

    ids: set[str] = set()
    modules: set[str] = set()
    files: set[str] = set()
    hashes: set[str] = set()
    categories: Counter[str] = Counter()
    edge_bases: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    total_bytes = 0
    for case in cases:
        require(isinstance(case, dict), "every case must be an object")
        case_id = case.get("id")
        require(isinstance(case_id, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{2,99}", case_id) is not None,
                "case id is invalid")
        require(case_id not in ids, f"duplicate case id: {case_id}")
        ids.add(case_id)
        module = case.get("module")
        require(isinstance(module, str) and module not in modules, f"duplicate or invalid module: {module}")
        modules.add(module)
        relative = case.get("file")
        require(isinstance(relative, str) and relative not in files, f"duplicate or invalid case file: {relative}")
        files.add(relative)
        declared_hash = case.get("sha256")
        require(isinstance(declared_hash, str) and re.fullmatch(r"[0-9a-f]{64}", declared_hash) is not None,
                f"{case_id} has an invalid SHA-256")
        require(declared_hash not in hashes, f"duplicate case content: {case_id}")
        hashes.add(declared_hash)
        require(case.get("expected") == "observe", f"{case_id} overstates a parser expectation")
        pure = PurePosixPath(relative)
        require(not pure.is_absolute() and ".." not in pure.parts, f"{case_id} path escapes the repository")
        path = ROOT.joinpath(*pure.parts)
        require(path.is_file() and not path.is_symlink(), f"{case_id} file is missing or is a symlink")
        try:
            path.resolve().relative_to(ALLOWED_ROOT)
        except ValueError:
            fail(f"{case_id} file escapes the redistributable root")
        actual_size = path.stat().st_size
        require(0 < actual_size <= MAX_FILE_BYTES, f"{case_id} file exceeds its bound")
        require(case.get("bytes") == actual_size, f"{case_id} byte count drifted")
        require(sha256_file(path) == declared_hash, f"{case_id} content hash drifted")
        require(isinstance(case.get("probe_symbol"), str) and case["probe_symbol"], f"{case_id} has no probe symbol")
        detail_symbols = case.get("detail_symbols")
        require(
            isinstance(detail_symbols, list)
            and 1 <= len(detail_symbols) <= 8
            and case["probe_symbol"] in detail_symbols
            and len(detail_symbols) == len(set(detail_symbols))
            and all(isinstance(symbol, str) and symbol for symbol in detail_symbols),
            f"{case_id} has invalid detail symbols",
        )
        categories[case.get("category")] += 1
        if case.get("category") == "compatibility-edge":
            edge_bases[case.get("selection_basis")] += 1
        sources[case.get("source_id")] += 1
        total_bytes += actual_size

    require(dict(categories) == CATEGORY_COUNTS,
            f"category counts are {dict(categories)}, expected {CATEGORY_COUNTS}")
    require(dict(edge_bases) == EDGE_COUNTS,
            f"compatibility-edge counts are {dict(edge_bases)}, expected {EDGE_COUNTS}")
    require(len(sources) >= MIN_DISTINCT_SOURCES, "source diversity floor is not met")
    require(max(sources.values()) <= MAX_SOURCE_CASES, "a source exceeds the case cap")
    require(total_bytes <= MAX_CORPUS_BYTES, "corpus exceeds the 32 MiB bound")
    coverage = coverage_for(cases)
    for feature, minimum in MINIMUM_COVERAGE.items():
        require(coverage[feature] >= minimum, f"coverage {feature} is {coverage[feature]}, expected at least {minimum}")
    require(document.get("coverage") == dict(sorted(coverage.items())), "declared coverage does not match cases")
    expected = build_manifest(catalog, catalog_bytes)
    require(document == expected, "manifest differs from deterministic catalog selection; regenerate it explicitly")
    return {
        "corpus_id": document["corpus_id"],
        "cases": len(cases),
        "categories": dict(sorted(categories.items())),
        "distinct_sources": len(sources),
        "maximum_source_cases": max(sources.values()),
        "unique_files": len(files),
        "unique_content_hashes": len(hashes),
        "total_bytes": total_bytes,
        "eligibility_gate": "passed",
        "canonical_parser_gate": "open",
        "coverage": {key: coverage[key] for key in sorted(MINIMUM_COVERAGE)},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()

    require(CATALOG_PATH.is_file(), "MIB catalog is missing")
    catalog_bytes = CATALOG_PATH.read_bytes()
    catalog = json.loads(catalog_bytes)
    manifest_path = args.manifest.resolve()
    if args.write_manifest:
        require(manifest_path == DEFAULT_MANIFEST.resolve(), "generated manifest may only use the canonical path")
        expected = build_manifest(catalog, catalog_bytes)
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    require(manifest_path.is_file(), "public corpus manifest is missing")
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    summary = validate_document(document, catalog, catalog_bytes)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
