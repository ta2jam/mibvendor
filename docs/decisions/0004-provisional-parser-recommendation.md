# ADR 0004: Keep the parser recommendation provisional

Status: Provisional; Phase 0 parser gate open
Date: 2026-07-13

## Decision

Use PySMI 2.0.0 only as the provisional canonical normalizer for prototype
work. Use libsmi 0.5.0 only for offline lint/QA. Keep Net-SNMP as a compatibility
oracle, not an application runtime dependency.

Do not freeze a production parser contract until the 100-case rights-approved
corpus and pinned Linux arm64/amd64 container runs pass the criteria in the
[parser decision record](../../experiments/parser-bakeoff/DECISION.md).

## Evidence

In the checked-in nine-case CC0 synthetic baseline, PySMI and libsmi each met
all 10 requested field checks, rejected all three invalid fixtures, preserved
module-qualified collisions, and produced deterministic normalized output.
Net-SNMP's tested CLI extraction exposed 5 of 10 fields. PySMI's structured JSON
fits a project-owned intermediate schema; libsmi's diagnostics justify its
bounded QA role.

These results validate the harness, not real vendor compatibility. The tiny
corpus mostly measures process startup. Container builds, image sizes, Linux
CPU/RSS, and real-vendor diversity remain unverified.

## Consequences

- No production schema may depend on PySMI-specific raw JSON or its volatile
  `meta` fields.
- Importers target a project-owned canonical schema and store parser version,
  diagnostics, and normalized hashes.
- Failure of the larger gate can replace the provisional parser without an API
  migration promise.
