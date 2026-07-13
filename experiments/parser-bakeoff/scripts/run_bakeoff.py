#!/usr/bin/env python3
"""Run the parser bake-off without third-party Python dependencies."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import resource
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "corpus"
MANIFEST = json.loads((CORPUS / "manifest.json").read_text())
DEFAULT_RESULTS = ROOT / "results" / "latest"
TIMEOUT_SECONDS = 10


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def corpus_fingerprint() -> str:
    digest = hashlib.sha256()
    for path in sorted(CORPUS.iterdir(), key=lambda item: item.name):
        if path.is_file():
            digest.update(path.name.encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    return digest.hexdigest()


def sanitize(text: str) -> str:
    return text.replace(str(ROOT), "<BAKEOFF_ROOT>")[:12000]


def usage_snapshot() -> resource.struct_rusage:
    return resource.getrusage(resource.RUSAGE_CHILDREN)


def peak_rss_kib(usage: resource.struct_rusage) -> int:
    # macOS reports bytes, Linux reports KiB.
    return int(usage.ru_maxrss / 1024) if sys.platform == "darwin" else int(usage.ru_maxrss)


def run_command(
    command: list[str], env: dict[str, str], timeout: int = TIMEOUT_SECONDS
) -> dict[str, Any]:
    before = usage_snapshot()
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
        timed_out = False
        returncode = completed.returncode
        stdout = completed.stdout
        stderr = completed.stderr
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        returncode = None
        stdout = exc.stdout or b""
        stderr = (exc.stderr or b"") + b"\nTIMEOUT"
    after = usage_snapshot()
    return {
        "command": [sanitize(part) for part in command],
        "returncode": returncode,
        "timed_out": timed_out,
        "wall_seconds": round(time.perf_counter() - started, 6),
        "user_cpu_seconds": round(after.ru_utime - before.ru_utime, 6),
        "system_cpu_seconds": round(after.ru_stime - before.ru_stime, 6),
        "peak_child_rss_kib_so_far": peak_rss_kib(after),
        "stdout": stdout,
        "stderr": stderr,
    }


def public_command_result(measurement: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in measurement.items() if k not in {"stdout", "stderr"}}


def dir_size_bytes(path: Path) -> int | None:
    if not path.exists():
        return None
    total = 0
    for item in path.rglob("*"):
        try:
            if item.is_file() and not item.is_symlink():
                total += item.stat().st_size
        except OSError:
            pass
    return total


def standard_mib_dirs() -> list[Path]:
    configured = os.environ.get("BAKEOFF_STANDARD_MIB_DIRS", "")
    if configured:
        candidates = [Path(value) for value in configured.split(os.pathsep) if value]
    else:
        groups = [
            [
            ROOT / ".tools/build/libsmi-0.5.0/mibs/ietf",
            ROOT / ".tools/build/libsmi-0.5.0/mibs/iana",
            ],
            [
            Path("/opt/homebrew/Cellar/libsmi/0.5.0/share/mibs/ietf"),
            Path("/opt/homebrew/Cellar/libsmi/0.5.0/share/mibs/iana"),
            ],
            [ROOT / ".tools/build/net-snmp-5.9.4/mibs"],
            [ROOT / ".tools/net-snmp-5.9.4/share/snmp/mibs"],
            [Path("/usr/share/snmp/mibs")],
        ]
        candidates = next((group for group in groups if all(path.is_dir() for path in group)), [])
    unique: list[Path] = []
    for candidate in candidates:
        if candidate.is_dir() and candidate.resolve() not in [p.resolve() for p in unique]:
            unique.append(candidate)
    return unique


def check_features(normalized: dict[str, Any], expected: dict[str, list[str]]) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    for feature, required in expected.items():
        actual = set(normalized.get(feature, []))
        checks[feature] = set(required).issubset(actual)
    return checks


def normalize_pysmi(payload: bytes) -> dict[str, Any]:
    document = json.loads(payload)
    normalized: dict[str, Any] = {
        "symbols": [],
        "oids": {},
        "revisions": [],
        "imports": [],
        "textual_conventions": [],
        "enums": [],
        "indexes": [],
        "augments": [],
        "notifications": [],
    }
    for name, value in document.items():
        if name in {"meta", "imports"} or not isinstance(value, dict):
            continue
        normalized["symbols"].append(name)
        if "oid" in value:
            normalized["oids"][name] = value["oid"]
        if value.get("class") == "moduleidentity":
            normalized["revisions"].extend(item["revision"] for item in value.get("revisions", []))
        if value.get("class") == "textualconvention":
            normalized["textual_conventions"].append(name)
        syntax = value.get("type") or value.get("syntax") or {}
        enumeration = syntax.get("constraints", {}).get("enumeration", {})
        normalized["enums"].extend(f"{key}={number}" for key, number in enumeration.items())
        normalized["indexes"].extend(item["object"] for item in value.get("indices", []))
        augmentation = value.get("augmention") or value.get("augmentation")
        if augmentation:
            normalized["augments"].append(augmentation["object"])
        if value.get("class") == "notificationtype":
            normalized["notifications"].append(name)
    for module, symbols in document.get("imports", {}).items():
        if module != "class":
            normalized["imports"].extend(f"{module}::{symbol}" for symbol in symbols)
    for key in normalized:
        if isinstance(normalized[key], list):
            normalized[key] = sorted(set(normalized[key]))
    return normalized


def normalize_libsmi(payload: bytes) -> dict[str, Any]:
    root = ET.fromstring(payload)
    normalized: dict[str, Any] = {
        "symbols": [],
        "oids": {},
        "revisions": [],
        "imports": [],
        "textual_conventions": [],
        "enums": [],
        "indexes": [],
        "augments": [],
        "notifications": [],
    }
    for element in root.iter():
        name = element.get("name")
        if name and element.tag in {"node", "scalar", "table", "row", "column", "notification", "typedef"}:
            normalized["symbols"].append(name)
        if name and element.get("oid"):
            normalized["oids"][name] = element.get("oid")
        if element.tag == "revision" and element.get("date"):
            normalized["revisions"].append(element.get("date"))
        elif element.tag == "import":
            normalized["imports"].append(f"{element.get('module')}::{element.get('name')}")
        elif element.tag == "typedef" and element.get("name") and element.get("basetype"):
            normalized["textual_conventions"].append(element.get("name"))
        elif element.tag == "namednumber":
            normalized["enums"].append(f"{element.get('name')}={element.get('number')}")
        elif element.tag == "index":
            normalized["indexes"].append(element.get("name"))
        elif element.tag == "augments":
            normalized["augments"].append(element.get("name"))
        elif element.tag == "notification":
            normalized["notifications"].append(element.get("name"))
    for key in normalized:
        if isinstance(normalized[key], list):
            normalized[key] = sorted({item for item in normalized[key] if item})
    return normalized


def normalize_netsnmp(payload: bytes) -> dict[str, Any]:
    text = payload.decode(errors="replace")
    normalized: dict[str, Any] = {
        "symbols": [],
        "oids": {},
        "revisions": [],
        "imports": [],
        "textual_conventions": [],
        "enums": [],
        "indexes": [],
        "augments": [],
        "notifications": [],
    }
    current: str | None = None
    for line in text.splitlines():
        match = re.match(r"^[A-Z][A-Z0-9-]+::([A-Za-z][A-Za-z0-9-]*)$", line.strip())
        if match:
            current = match.group(1)
            normalized["symbols"].append(current)
            continue
        if current and "NOTIFICATION-TYPE" in line:
            normalized["notifications"].append(current)
        if current and line.startswith("::= { "):
            numeric = re.findall(r"(?:^|\s)(\d+)(?:\s|\})", line)
            if numeric:
                normalized["oids"][current] = ".".join(numeric)
        match = re.search(
            r"(?:Textual Convention:|--\s*TEXTUAL CONVENTION)\s*([A-Za-z][A-Za-z0-9-]*)",
            line,
            re.IGNORECASE,
        )
        if match:
            normalized["textual_conventions"].append(match.group(1))
        match = re.search(r"(?:Values:|SYNTAX\s+INTEGER\s+\{)(.*)", line)
        if match:
            for enum_name, number in re.findall(r"([A-Za-z][A-Za-z0-9-]*)\((-?\d+)\)", match.group(1)):
                normalized["enums"].append(f"{enum_name}={number}")
        match = re.search(r"INDEX\s+\{\s*([^}]*)\}", line)
        if match:
            normalized["indexes"].extend(item.strip() for item in match.group(1).split(","))
        match = re.search(r"AUGMENTS\s+\{\s*([^}]*)\}", line)
        if match:
            normalized["augments"].extend(item.strip() for item in match.group(1).split(","))
    for key in normalized:
        if isinstance(normalized[key], list):
            normalized[key] = sorted({item for item in normalized[key] if item})
    return normalized


class Adapter:
    name = ""

    def __init__(self, binary: Path, work: Path):
        self.binary = binary
        self.work = work
        self.env = os.environ.copy()
        self.mib_dirs = [CORPUS, *standard_mib_dirs()]

    def version(self) -> str:
        raise NotImplementedError

    def footprint_root(self) -> Path:
        return self.binary.parent.parent

    def run_once(self, case: dict[str, Any], repetition: int) -> dict[str, Any]:
        raise NotImplementedError

    def collision_test(self) -> dict[str, Any]:
        raise NotImplementedError


class PysmiAdapter(Adapter):
    name = "pysmi"

    def version(self) -> str:
        result = subprocess.run([self.binary, "--version"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        match = re.search(rb"library version ([^,\s]+)", result.stdout)
        return match.group(1).decode() if match else sanitize(result.stdout.decode(errors="replace"))

    def run_once(self, case: dict[str, Any], repetition: int) -> dict[str, Any]:
        destination = self.work / case["id"] / str(repetition)
        shutil.rmtree(destination, ignore_errors=True)
        destination.mkdir(parents=True)
        empty_borrower = self.work / "empty-borrower"
        empty_borrower.mkdir(parents=True, exist_ok=True)
        command = [
            str(self.binary),
            "--destination-format=json",
            f"--destination-directory={destination}",
            f"--mib-borrower={empty_borrower}",
            "--generate-mib-texts",
            "--rebuild",
        ]
        command.extend(f"--mib-source=file://{directory}" for directory in self.mib_dirs)
        command.append(case["module"])
        measured = run_command(command, self.env)
        artifact_path = destination / f"{case['module']}.json"
        artifact = artifact_path.read_bytes() if artifact_path.exists() else b""
        success = measured["returncode"] == 0 and bool(artifact) and not measured["timed_out"]
        normalized = normalize_pysmi(artifact) if success else {}
        combined = measured["stdout"] + measured["stderr"]
        diagnostics = b"" if success else combined
        return {
            "success": success,
            "measurement": public_command_result(measured),
            "raw_sha256": sha256(artifact),
            "normalized_sha256": sha256(canonical_bytes(normalized)),
            "normalized": normalized,
            "diagnostics": sanitize(diagnostics.decode(errors="replace")),
        }

    def collision_test(self) -> dict[str, Any]:
        destination = self.work / "collision-combined"
        shutil.rmtree(destination, ignore_errors=True)
        destination.mkdir(parents=True)
        empty_borrower = self.work / "empty-borrower"
        empty_borrower.mkdir(parents=True, exist_ok=True)
        command = [
            str(self.binary),
            "--destination-format=json",
            f"--destination-directory={destination}",
            f"--mib-borrower={empty_borrower}",
            "--generate-mib-texts",
            "--rebuild",
        ]
        command.extend(f"--mib-source=file://{directory}" for directory in self.mib_dirs)
        command.extend(["MIBVENDOR-COLLISION-A-MIB", "MIBVENDOR-COLLISION-B-MIB"])
        measured = run_command(command, self.env)
        objects: dict[str, str] = {}
        for module in ["MIBVENDOR-COLLISION-A-MIB", "MIBVENDOR-COLLISION-B-MIB"]:
            path = destination / f"{module}.json"
            if path.exists():
                data = normalize_pysmi(path.read_bytes())
                objects[module] = data.get("oids", {}).get("mvSharedName", "")
        return {
            "success": measured["returncode"] == 0,
            "module_qualified_preserved": len(objects) == 2 and len(set(objects.values())) == 2,
            "resolved": objects,
            "diagnostics": sanitize((measured["stdout"] + measured["stderr"]).decode(errors="replace")),
            "measurement": public_command_result(measured),
        }


class LibsmiAdapter(Adapter):
    name = "libsmi"

    def __init__(self, binary: Path, work: Path):
        super().__init__(binary, work)
        self.smilint = Path(os.environ.get("BAKEOFF_SMILINT", str(binary.with_name("smilint"))))
        self.env["SMIPATH"] = os.pathsep.join(str(path) for path in self.mib_dirs)

    def version(self) -> str:
        result = subprocess.run([self.binary, "-V"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        match = re.search(rb"smidump\s+([^\s]+)", result.stdout)
        return match.group(1).decode() if match else sanitize(result.stdout.decode(errors="replace"))

    def run_once(self, case: dict[str, Any], repetition: int) -> dict[str, Any]:
        path = CORPUS / case["file"]
        lint = run_command([str(self.smilint), "-s", "-l", "6", str(path)], self.env)
        dump = run_command([str(self.binary), "-q", "-f", "xml", str(path)], self.env)
        artifact = dump["stdout"]
        success = (
            lint["returncode"] == 0
            and dump["returncode"] == 0
            and bool(artifact)
            and not lint["timed_out"]
            and not dump["timed_out"]
        )
        normalized: dict[str, Any] = {}
        if success:
            try:
                normalized = normalize_libsmi(artifact)
            except ET.ParseError:
                success = False
        diagnostics = lint["stderr"] + dump["stderr"]
        return {
            "success": success,
            "measurement": {
                "lint": public_command_result(lint),
                "dump": public_command_result(dump),
            },
            "raw_sha256": sha256(artifact),
            "normalized_sha256": sha256(canonical_bytes(normalized)),
            "normalized": normalized,
            "diagnostics": sanitize(diagnostics.decode(errors="replace")),
        }

    def collision_test(self) -> dict[str, Any]:
        paths = [
            CORPUS / "MIBVENDOR-COLLISION-A-MIB.mib",
            CORPUS / "MIBVENDOR-COLLISION-B-MIB.mib",
        ]
        measured = run_command(
            [str(self.smilint), "-s", "-l", "6", *(str(path) for path in paths)], self.env
        )
        resolved: dict[str, str] = {}
        # smilint loads both modules in one process. Individual XML dumps then
        # prove that the two module-qualified descriptors remain distinguishable.
        for module, filename in [
            ("MIBVENDOR-COLLISION-A-MIB", "MIBVENDOR-COLLISION-A-MIB.mib"),
            ("MIBVENDOR-COLLISION-B-MIB", "MIBVENDOR-COLLISION-B-MIB.mib"),
        ]:
            one = run_command([str(self.binary), "-q", "-f", "xml", str(CORPUS / filename)], self.env)
            if one["returncode"] == 0:
                normalized = normalize_libsmi(one["stdout"])
                resolved[module] = normalized.get("oids", {}).get("mvSharedName", "")
        return {
            "success": measured["returncode"] == 0,
            "module_qualified_preserved": len(resolved) == 2 and len(set(resolved.values())) == 2,
            "resolved": resolved,
            "diagnostics": sanitize(measured["stderr"].decode(errors="replace")),
            "measurement": public_command_result(measured),
        }


class NetsnmpAdapter(Adapter):
    name = "net-snmp"

    def __init__(self, binary: Path, work: Path):
        super().__init__(binary, work)
        joined = os.pathsep.join(str(path) for path in self.mib_dirs)
        self.env["MIBDIRS"] = joined
        self.env.pop("MIBS", None)

    def version(self) -> str:
        result = subprocess.run([self.binary, "-V"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        match = re.search(rb"NET-SNMP version:\s*([^\s]+)", result.stdout)
        return match.group(1).decode() if match else sanitize(result.stdout.decode(errors="replace"))

    def run_once(self, case: dict[str, Any], repetition: int) -> dict[str, Any]:
        joined = os.pathsep.join(str(path) for path in self.mib_dirs)
        symbols = [f"{case['module']}::{symbol}" for symbol in case.get("detail_symbols", [case["identity"]])]
        command = [
            str(self.binary),
            "-Le",
            "-M",
            joined,
            "-m",
            case["module"],
            "-Td",
            *symbols,
        ]
        measured = run_command(command, self.env)
        artifact = measured["stdout"]
        identity_marker = f"{case['module']}::{case['identity']}".encode()
        success = measured["returncode"] == 0 and identity_marker in artifact and not measured["timed_out"]
        normalized = normalize_netsnmp(artifact) if success else {}
        return {
            "success": success,
            "measurement": public_command_result(measured),
            "raw_sha256": sha256(artifact),
            "normalized_sha256": sha256(canonical_bytes(normalized)),
            "normalized": normalized,
            "diagnostics": sanitize(measured["stderr"].decode(errors="replace")),
        }

    def collision_test(self) -> dict[str, Any]:
        joined = os.pathsep.join(str(path) for path in self.mib_dirs)
        modules = "MIBVENDOR-COLLISION-A-MIB:MIBVENDOR-COLLISION-B-MIB"
        command = [
            str(self.binary),
            "-Le",
            "-Pw",
            "-M",
            joined,
            "-m",
            modules,
            "-On",
            "MIBVENDOR-COLLISION-A-MIB::mvSharedName",
            "MIBVENDOR-COLLISION-B-MIB::mvSharedName",
        ]
        measured = run_command(command, self.env)
        values = [line.strip() for line in measured["stdout"].decode(errors="replace").splitlines() if line.strip()]
        resolved = dict(zip(modules.split(":"), values)) if len(values) == 2 else {}
        return {
            "success": measured["returncode"] == 0,
            "module_qualified_preserved": len(resolved) == 2 and len(set(resolved.values())) == 2,
            "resolved": resolved,
            "diagnostics": sanitize(measured["stderr"].decode(errors="replace")),
            "measurement": public_command_result(measured),
        }


def find_binary(candidate: str) -> Path | None:
    overrides = {
        "pysmi": "BAKEOFF_PYSMI",
        "libsmi": "BAKEOFF_LIBSMI",
        "net-snmp": "BAKEOFF_NETSNMP",
    }
    defaults = {
        "pysmi": ROOT / ".tools/pysmi-venv/bin/mibdump",
        "libsmi": Path(shutil.which("smidump") or ""),
        "net-snmp": ROOT / ".tools/net-snmp-5.9.4/bin/snmptranslate",
    }
    configured = os.environ.get(overrides[candidate])
    path = Path(configured) if configured else defaults[candidate]
    return path if str(path) and path.is_file() and os.access(path, os.X_OK) else None


def run_candidate(candidate: str, results_dir: Path) -> dict[str, Any]:
    binary = find_binary(candidate)
    if not binary:
        raise RuntimeError(f"{candidate} binary not found; set the matching BAKEOFF_* environment variable")
    work = Path(os.environ.get("BAKEOFF_WORK_DIR", str(ROOT / ".work"))) / candidate
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    adapter_class = {"pysmi": PysmiAdapter, "libsmi": LibsmiAdapter, "net-snmp": NetsnmpAdapter}[candidate]
    adapter = adapter_class(binary.resolve(), work)
    started = datetime.now(timezone.utc)
    cases: list[dict[str, Any]] = []
    total_wall = 0.0
    total_user = 0.0
    total_system = 0.0
    peak_rss = 0
    for case in MANIFEST["cases"]:
        first = adapter.run_once(case, 1)
        if first["success"]:
            # PySMI embeds a one-second timestamp in raw JSON metadata. Crossing
            # that boundary deliberately tests raw artifact reproducibility.
            time.sleep(1.05 if candidate == "pysmi" else 0.01)
        runs = [first, adapter.run_once(case, 2)]
        expected_success = case["expected"] == "success"
        feature_checks = check_features(first["normalized"], case.get("features", {})) if first["success"] else {
            feature: False for feature in case.get("features", {})
        }
        for run in runs:
            measurements = run["measurement"].values() if candidate == "libsmi" else [run["measurement"]]
            for measurement in measurements:
                total_wall += measurement["wall_seconds"]
                total_user += measurement["user_cpu_seconds"]
                total_system += measurement["system_cpu_seconds"]
                peak_rss = max(peak_rss, measurement["peak_child_rss_kib_so_far"])
        cases.append(
            {
                "id": case["id"],
                "module": case["module"],
                "expected": case["expected"],
                "success": first["success"],
                "expectation_met": first["success"] == expected_success,
                "timed_out": any(
                    measurement["timed_out"]
                    for run in runs
                    for measurement in (
                        run["measurement"].values() if candidate == "libsmi" else [run["measurement"]]
                    )
                ),
                "raw_output_deterministic": runs[0]["raw_sha256"] == runs[1]["raw_sha256"],
                "normalized_output_deterministic": runs[0]["normalized_sha256"]
                == runs[1]["normalized_sha256"],
                "feature_checks": feature_checks,
                "normalized": first["normalized"],
                "diagnostics": first["diagnostics"],
                "runs": [
                    {
                        "measurement": run["measurement"],
                        "raw_sha256": run["raw_sha256"],
                        "normalized_sha256": run["normalized_sha256"],
                    }
                    for run in runs
                ],
            }
        )
    collision = adapter.collision_test()
    valid = [case for case in cases if case["expected"] == "success"]
    invalid = [case for case in cases if case["expected"] == "failure"]
    feature_values = [passed for case in cases for passed in case["feature_checks"].values()]
    result = {
        "schema_version": 1,
        "candidate": candidate,
        "version": adapter.version(),
        "binary": sanitize(str(binary.resolve())),
        "execution_mode": os.environ.get("BAKEOFF_EXECUTION_MODE", "local"),
        "started_at": started.isoformat(),
        "host": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "corpus": {
            "license": MANIFEST["license"],
            "cases": len(cases),
            "valid_cases": len(valid),
            "invalid_cases": len(invalid),
            "sha256": corpus_fingerprint(),
        },
        "summary": {
            "valid_parse_success": sum(case["success"] for case in valid),
            "valid_parse_total": len(valid),
            "invalid_rejected": sum(not case["success"] for case in invalid),
            "invalid_total": len(invalid),
            "expectations_met": sum(case["expectation_met"] for case in cases),
            "expectations_total": len(cases),
            "field_fidelity_passed": sum(feature_values),
            "field_fidelity_total": len(feature_values),
            "normalized_deterministic_cases": sum(case["normalized_output_deterministic"] for case in cases),
            "raw_deterministic_cases": sum(case["raw_output_deterministic"] for case in cases),
            "timeout_cases": sum(case["timed_out"] for case in cases),
            "total_measured_wall_seconds": round(total_wall, 6),
            "total_user_cpu_seconds": round(total_user, 6),
            "total_system_cpu_seconds": round(total_system, 6),
            "peak_child_rss_kib": peak_rss,
            "installed_footprint_bytes": dir_size_bytes(adapter.footprint_root()),
            "container_image_bytes": None,
        },
        "collision": collision,
        "cases": cases,
    }
    results_dir.mkdir(parents=True, exist_ok=True)
    (results_dir / f"{candidate}.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def aggregate(results_dir: Path) -> dict[str, Any]:
    candidates = []
    for candidate in ["pysmi", "libsmi", "net-snmp"]:
        path = results_dir / f"{candidate}.json"
        if path.exists():
            candidates.append(json.loads(path.read_text()))
    if not candidates:
        raise RuntimeError(f"no candidate results found in {results_dir}")
    container_unmeasured = all(item["summary"]["container_image_bytes"] is None for item in candidates)
    gate_reasons = [
        "the checked-in corpus has 9 synthetic cases, not the required 100-case rights-approved corpus"
    ]
    if container_unmeasured:
        gate_reasons.append("pinned container execution has not been reproduced in this result set")
    summary = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "parser_gate": {
            "status": "provisional",
            "reasons": gate_reasons,
        },
        "container_measurement_status": "not_measured" if container_unmeasured else "measured",
        "candidates": [
            {
                "candidate": item["candidate"],
                "version": item["version"],
                **item["summary"],
                "collision_module_qualified_preserved": item["collision"]["module_qualified_preserved"],
            }
            for item in candidates
        ],
    }
    (results_dir / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", choices=["pysmi", "libsmi", "net-snmp", "all"], default="all")
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--aggregate-only", action="store_true")
    args = parser.parse_args()
    results_dir = args.results_dir.resolve()
    if not args.aggregate_only:
        if args.candidate == "all":
            # Separate processes keep RUSAGE_CHILDREN peak RSS scoped to one
            # candidate instead of leaking the previous candidate's high-water mark.
            for candidate in ["pysmi", "libsmi", "net-snmp"]:
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
            run_candidate(args.candidate, results_dir)
    aggregate(results_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
