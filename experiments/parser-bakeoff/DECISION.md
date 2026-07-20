# Parser decision record

Status: **passed; PySMI 2.0.0 selected as the canonical parser adapter**.

Decision date: 2026-07-20

## Decision

Use PySMI 2.0.0 behind the project-owned normalization schema. Keep libsmi
0.5.0 as an optional offline lint/QA tool. Keep Net-SNMP as a compatibility
oracle; do not add either secondary tool to the application runtime.

The selection is release-bound, not permanent. A PySMI upgrade or material
corpus change must rerun the same native multi-architecture and CC0 gates.
Application and API contracts depend on the canonical schema, never PySMI's raw
JSON shape.

## Evidence

GitHub Actions run
[`29719084848`](https://github.com/ta2jam/mibvendor/actions/runs/29719084848)
executed commit `94e60809f3a01a8ba482ffc7319c8dc8a358fd30` in pinned,
network-disabled containers on native Linux amd64 and arm64. Both architectures
produced identical normalized case evidence with zero timeouts and 100/100
deterministic public cases for every candidate.

| Candidate | Public parse | Feature probes | CC0 fields | CC0 expectations | Selection |
|---|---:|---:|---:|---:|---|
| PySMI 2.0.0 | 94/100 | 330/360 (91.67%) | 10/10 | 9/9 | passed |
| libsmi 0.5.0 | 78/100 | 293/360 (81.39%) | 10/10 | 9/9 | failed public thresholds |
| Net-SNMP 5.9.4.pre2 | 48/100 | 47/360 (13.06%) | 5/10 | 9/9 | failed public and field thresholds |

PySMI also preserved the two module-qualified collision descriptors, parsed all
six valid CC0 fixtures, rejected the missing-import, truncated, and malformed
fixtures, and retained all ten requested revision/import/TC/enum/INDEX/AUGMENTS/
notification fields. Its raw output embeds host/time metadata; the project
normalizer removes that non-contractual `meta` content before hashing.

The process-isolated 100-file run executes every artifact twice. PySMI measured
90,780 KiB peak child RSS on amd64 and 89,232 KiB on arm64. Per-artifact wall
time was 0.627 s median / 1.244 s p95 on amd64 and 0.562 s median / 1.068 s p95
on arm64. These figures include parser process startup and are operational
capacity evidence, not a claim that PySMI is faster than the other candidates.

The exact inputs, per-file results, measurements, hashes, threshold failures,
and selection are machine-checked in:

- `results/2026-07-20-public-linux-amd64/`;
- `results/2026-07-20-public-linux-arm64/`;
- `results/2026-07-20-public-validation/parser-selection.json`.

## Why no warm shared-process benchmark

The parser-adapter contract accepts one bounded immutable artifact and returns
one success/failure envelope. A shared warm parser process would change that
contract, permit cross-file state and failure contamination, and measure
different semantics across three unrelated CLIs. It is therefore excluded,
not silently omitted. The committed measurements cover the selected
process-isolated ingestion model. Harness work is `O(P * C * R * parse(input))`
for `P=3`, `C=100`, and `R=2`; parser startup is a deliberate constant cost.

## Limitations

- The public corpus is positive breadth. It does not claim coverage of unknown-
  rights proprietary malformed files.
- Aggregate success does not erase failures. PySMI's public per-feature rates
  are recorded, including 50/62 textual-convention and 3/4 SMIv1 trap probes.
- Six public modules did not parse through the tested PySMI CLI path. They stay
  explicit in the result set; no alternate parser output is silently substituted.
- libsmi remains useful for diagnostics, but its native build maintenance cost
  and sub-threshold public coverage exclude it from the canonical path.
- Net-SNMP's result describes the tested CLI extraction path, not the full C API.

## Re-evaluation triggers

Rerun the decision when the canonical parser version changes, the normalized
schema changes, the public corpus selection policy changes, or production
failures show a missing grammar class. Selection fails closed unless exactly one
candidate meets all committed thresholds on both native architectures.
