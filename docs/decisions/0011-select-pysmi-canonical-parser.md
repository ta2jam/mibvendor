# ADR 0011: Select PySMI as the canonical parser adapter

Status: Accepted

Date: 2026-07-20

## Decision

Select PySMI 2.0.0 as the canonical parser behind the project-owned normalized
module contract. Keep libsmi 0.5.0 as optional offline lint/QA and Net-SNMP as a
compatibility oracle. Neither secondary parser enters the application runtime.

The selection supersedes ADR 0004. It does not make PySMI raw JSON an API or
storage contract. Parser upgrades and normalized-schema changes require a new
native multi-architecture evidence run and an explicit migration decision.

## Evidence

Pinned GitHub Actions run
[`29719084848`](https://github.com/ta2jam/mibvendor/actions/runs/29719084848)
tested commit `94e60809f3a01a8ba482ffc7319c8dc8a358fd30` on native Linux amd64 and arm64
with runtime networking disabled. All candidates produced deterministic,
cross-architecture-identical normalized evidence with no timeout.

PySMI alone met every selection threshold: 94/100 public files, 330/360 public
feature probes, 9/9 CC0 expectations, 10/10 CC0 fields, and module-qualified
collision preservation. libsmi reached 78/100 and 293/360; Net-SNMP reached
48/100 and 47/360 with 5/10 CC0 fields. The complete inputs, per-file failures,
resource measurements, artifact hashes, and fail-closed decision are retained
under `experiments/parser-bakeoff/results/2026-07-20-public-*`.

The adapter contract isolates one bounded source artifact per parser process.
A shared warm process is not a missing benchmark: it would introduce cross-file
state and would not represent equivalent behavior across the three CLIs.

## Consequences

- PySMI parse failure publishes no partial canonical module and never falls
  back silently to another parser.
- Every result records the parser version, normalized hash, diagnostics, and
  bounded wall/CPU/RSS measurements.
- The public corpus is positive breadth, not evidence about unknown-rights
  proprietary malformed files; those claims remain out of scope.
- Selection validation is `O(P * (C + E))` over three parsers, 100 public cases,
  and nine edge cases. Result verification uses `O(C)` memory per candidate.
