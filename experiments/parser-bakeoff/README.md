# MIB parser bake-off

This experiment compares PySMI 2.0.0, libsmi 0.5.0, and the Net-SNMP 5.9.4
release archive against the same MIB inputs. It does not make the Phase 0 parser
gate pass by itself. The checked-in evidence now has two deliberately separate
parts: nine CC0 edge cases and a deterministic 100-file positive-breadth corpus
selected from the active redistributable release.

## Current result

The current committed runs were produced from the pinned containers on native
Linux amd64 and arm64. Runtime networking was disabled, the root filesystem was
read-only, and all output was written by the invoking host UID/GID. Both
architectures produced identical normalized case evidence. The earlier macOS
arm64 source-build result remains available as a separate baseline.

The committed evidence covers both the nine synthetic edge cases and the
100-file public corpus. GitHub Actions run
[`29719084848`](https://github.com/ta2jam/mibvendor/actions/runs/29719084848)
passed both native architectures and parity validation. PySMI 2.0.0 is the
canonical adapter because it is the only candidate that meets every committed
public and CC0 threshold.

Public corpus, identical on Linux amd64 and arm64:

| Candidate | Parsed | Feature probes | Deterministic | Timeouts | Decision |
|---|---:|---:|---:|---:|---|
| PySMI 2.0.0 | 94/100 | 330/360 | 100/100 | 0 | selected |
| libsmi 0.5.0 | 78/100 | 293/360 | 100/100 | 0 | below 90% thresholds |
| Net-SNMP 5.9.4.pre2 | 48/100 | 47/360 | 100/100 | 0 | below public and CC0 field thresholds |

Linux amd64:

| Candidate | Valid parsed | Invalid rejected | Requested field checks | Normalized deterministic | Raw deterministic | Measured wall time | Peak child RSS | Container image |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| PySMI 2.0.0 | 6/6 | 3/3 | 10/10 | 9/9 | 3/9 | 32.830 s | 43,768 KiB | 55.4 MiB |
| libsmi 0.5.0 | 6/6 | 3/3 | 10/10 | 9/9 | 9/9 | 0.185 s | 26,332 KiB | 47.0 MiB |
| Net-SNMP 5.9.4 archive | 6/6 | 3/3 | 5/10 | 9/9 | 9/9 | 0.403 s | 26,624 KiB | 49.8 MiB |

Linux arm64:

| Candidate | Valid parsed | Invalid rejected | Requested field checks | Normalized deterministic | Raw deterministic | Measured wall time | Peak child RSS | Container image |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| PySMI 2.0.0 | 6/6 | 3/3 | 10/10 | 9/9 | 3/9 | 8.610 s | 42,312 KiB | 176.8 MiB |
| libsmi 0.5.0 | 6/6 | 3/3 | 10/10 | 9/9 | 9/9 | 0.038 s | 25,404 KiB | 163.9 MiB |
| Net-SNMP 5.9.4 archive | 6/6 | 3/3 | 5/10 | 9/9 | 9/9 | 0.069 s | 25,416 KiB | 171.4 MiB |

Each candidate runs in a separate process. Peak RSS is a candidate-level child
high-water mark, not a per-case measurement. Nine small cases mostly measure
process startup, so timing does not decide the parser selection.

The Net-SNMP archive is the official 5.9.4 tarball with the locked hash in
`sources.lock.json`, but its compiled binary reports `5.9.4.pre2`. The result
keeps that observed version instead of rewriting it to 5.9.4.

PySMI is selected for canonical normalization. libsmi remains optional offline
lint/QA, and Net-SNMP remains a compatibility oracle rather than a product
runtime dependency. The evidence, thresholds, and limitations are in
[`DECISION.md`](DECISION.md).

## Corpus and rights

`public-corpus/manifest.json` selects 100 unique files, content hashes, and
modules from the tracked active release. It uses five 20-file strata, covers 11
sources with at most 30 cases from one source, and totals 5.95 MiB. Every case
retains source revision, URL, SPDX signal, artifact hash, a bounded probe
symbol, and observed static-parser baseline. Selection is deterministic from a
fixed seed; duplicate bytes, path escape, hash drift, count drift, and a
manifest that claims parser success are rejected.

The public corpus is positive breadth evidence, not a disguised malformed-file
suite. The nine CC0 cases remain the explicit negative, collision, missing
import, and revision-shape evidence. A real malformed or historical revision
corpus may be added later if it is both useful and rights-approved; it is not
fabricated by relabelling valid files.

All checked-in `MIBVENDOR-*` fixtures were written for this experiment and are
CC0-1.0. The experiment copies no additional vendor MIB text: its public
manifest references files already governed and tracked in the active
redistributable release. Standard import dependencies are extracted at runtime
from the hash-locked libsmi source archive and are not newly vendored here.

Future external fixtures belong under ignored `corpus/private/` unless their
redistribution scope is explicitly approved. A source being publicly
downloadable is not approval to commit or republish it. The 100-case result may
commit only aggregate metrics and diagnostics scrubbed of third-party MIB text.
Git and the parser Docker build context both exclude `corpus/private/`; private
fixtures must be mounted read-only at execution time and must never be copied
into an image layer.

Before any optional private-corpus run, its manifest and files must pass:

```sh
./scripts/validate_corpus_intake.py corpus/private/manifest.json \
  --corpus-dir corpus/private/files \
  --evidence-dir corpus/private/evidence
```

That legacy private intake requires exactly 20 cases in each planned category, ten two-file
revision comparison groups, unique files and content hashes, an exact SHA-256
for every file, a known rights-matrix source, and explicit approved testing
authority backed by a present, non-symlinked evidence file with an exact
SHA-256. It reads each corpus file and unique evidence file once, uses `O(N)`
manifest memory, caps individual MIB files at 10 MiB, evidence files at 5 MiB,
and the total MIB corpus at 200 MiB. It emits counts only—not filenames,
diagnostics, evidence contents, or MIB text. Passing intake does not pass the
parser gate; it only proves that the supplied evidence is eligible to be
measured.

The nine current cases cover:

- revisions, imports, textual conventions, enums, INDEX, AUGMENTS, and a notification;
- a cross-module import;
- identical descriptors in two modules with distinct OIDs;
- old/new revision shapes;
- missing import, truncated input, and bounded malformed nesting.

They validate the harness semantics. Public source diversity is measured by the
separate 100-file manifest rather than inferred from these synthetic cases.

## Reproduce locally

Requirements are a POSIX shell, `curl`, `make`, a C toolchain, and Python 3.
The bootstrap downloads only the two sources in `sources.lock.json`, verifies
SHA-256, builds the C tools under ignored `.tools/`, and installs the
hash-locked Python dependencies.

```sh
./scripts/run_local.sh results/latest
./scripts/validate_results.py results/latest
```

The committed evidence can be checked without parser binaries or downloads:

```sh
./scripts/validate_results.py results/2026-07-13-linux-amd64
./scripts/validate_results.py results/2026-07-14-linux-arm64
./scripts/validate_multiarch_results.py \
  results/2026-07-13-linux-amd64 results/2026-07-14-linux-arm64
python3 scripts/validate_public_multiarch_results.py \
  --expected-source-commit 94e60809f3a01a8ba482ffc7319c8dc8a358fd30 \
  results/2026-07-20-public-linux-amd64 \
  results/2026-07-20-public-linux-arm64
python3 scripts/select_public_parser.py \
  --expected-source-commit 94e60809f3a01a8ba482ffc7319c8dc8a358fd30 \
  results/2026-07-20-public-linux-amd64 \
  results/2026-07-20-public-linux-arm64 \
  results/2026-07-13-linux-amd64 \
  results/2026-07-14-linux-arm64
```

The tracked public corpus can be regenerated and validated without parser
binaries:

```sh
python3 scripts/public_corpus_gate.py --write-manifest
python3 scripts/public_corpus_gate.py
```

## Reproduce in pinned containers

The Dockerfiles lock the Python, GCC, and Debian base image indexes by digest,
verify the libsmi and Net-SNMP archives by SHA-256, and use exact Python package
versions with wheel hashes for Linux amd64 and arm64. Both container runners use
the host UID/GID, no runtime network, a read-only root filesystem, and a bounded
tmpfs. The public runner additionally drops all Linux capabilities, disables
privilege escalation, and bounds CPU, memory, and PIDs. It mounts only the
tracked data, parser scripts, public manifest, and a safe synthetic manifest;
it does not expose the whole checkout, `.git`, or an optional private corpus to
parser processes.

```sh
./scripts/run_containers.sh results/latest
```

The heavier public run executes three parsers, 100 cases, and two repetitions
on the host architecture:

```sh
./scripts/run_public_containers.sh results/public-linux-amd64
```

Use native runners, not QEMU, for the second architecture. The manually
dispatched `Parser public corpus` GitHub workflow runs `ubuntu-24.04` and
`ubuntu-24.04-arm`, uploads each result set separately, then rejects missing,
unpinned, nondeterministic, timed-out, or cross-architecture divergent
evidence. Each result must match the workflow source commit and the exact
manifest, catalog, and data-release hashes; empty applicable feature maps or
missing resource measurements also fail. It intentionally does not run in the
five-minute normal CI path.

The committed CC0 Linux evidence is in
[`results/2026-07-13-linux-amd64/`](results/2026-07-13-linux-amd64/) and
[`results/2026-07-14-linux-arm64/`](results/2026-07-14-linux-arm64/). It verifies
container build correctness, exact parser versions, image sizes, runtime
isolation, malformed-input rejection, deterministic normalized output, and
cross-architecture normalized parity. The arm64 run is tied to its public
[GitHub Actions execution](https://github.com/ta2jam/mibvendor/actions/runs/29294289938).
The earlier unavailable-daemon record is retained as audit history, not as the
current status.

The public result sets are in
[`results/2026-07-20-public-linux-amd64/`](results/2026-07-20-public-linux-amd64/)
and
[`results/2026-07-20-public-linux-arm64/`](results/2026-07-20-public-linux-arm64/).
The threshold decision and exact evidence hashes are in
[`results/2026-07-20-public-validation/parser-selection.json`](results/2026-07-20-public-validation/parser-selection.json).

## Measurement semantics

- Each case is run twice from a clean destination.
- Parse success requires an emitted, readable normalized artifact and a
  successful tool status; malformed cases must be rejected without timeout.
- Fidelity checks only fields visible in the candidate's emitted artifact.
  Net-SNMP's 5/10 score describes the tested CLI extraction path, not every
  capability that might exist in its C API.
- PySMI raw JSON embeds host and generation time, so raw hashes vary. Removing
  `meta` yields deterministic normalized output in all nine cases.
- Wall/CPU totals include process startup because the selected adapter contract
  isolates one bounded artifact in one parser process. A shared warm process is
  not measured: it would introduce cross-file state and would not have equivalent
  semantics across the three CLIs.
- Installed footprint and container image size are recorded separately.

Harness work is approximately `O(P * C * R * parse(input))`. The public run has
`P=3`, `C=100`, and `R=2` and invokes roughly 800 tool subprocesses because
some adapters have separate lint/dump or per-symbol probes. Eligibility scans
702 catalog files (about 41.8 MiB) once per validation and uses `O(C)` manifest
memory. Peak working space is bounded by the largest parser plus one emitted
artifact and the 512 MiB container tmpfs. Process startup and container builds
are the main energy constants.

## Files

- `corpus/manifest.json`: cases and expected fields.
- `corpus/LICENSE.md`: checked-in fixture provenance.
- `sources.lock.json`: source URLs, hashes, and base image digests.
- `requirements-pysmi.txt`: exact packages and accepted wheel hashes.
- `scripts/run_bakeoff.py`: adapters, normalization, metrics, and aggregation.
- `scripts/validate_results.py`: dependency-free result consistency check.
- `scripts/validate_multiarch_results.py`: architecture and normalized parity check.
- `scripts/validate_corpus_intake.py`: private 100-case balance, rights, hash, and path gate.
- `public-corpus/manifest.json`: deterministic rights-approved positive-breadth cases.
- `scripts/public_corpus_gate.py`: public selection, hash, provenance, and coverage gate.
- `scripts/run_public_bakeoff.py`: public-corpus runner and bounded result writer.
- `scripts/run_public_containers.sh`: read-only/no-network public container run.
- `scripts/validate_public_multiarch_results.py`: complete native result and parity gate.
- `scripts/select_public_parser.py`: deterministic thresholds and fail-closed selection.
- `containers/`: one pinned Dockerfile per candidate.
- `results/2026-07-13-macos-arm64/`: committed real local run.
- `results/2026-07-13-linux-amd64/`: committed pinned-container run.
- `results/2026-07-14-linux-arm64/`: committed native arm64 container run and provenance.
- `results/2026-07-20-public-linux-amd64/`: committed public amd64 evidence.
- `results/2026-07-20-public-linux-arm64/`: committed public arm64 evidence.
- `results/2026-07-20-public-validation/`: parity and canonical selection evidence.
