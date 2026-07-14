# MIB parser bake-off

This experiment compares PySMI 2.0.0, libsmi 0.5.0, and the Net-SNMP 5.9.4
release archive against the same MIB inputs. It does not make the Phase 0 parser
gate pass. The checked-in corpus has nine synthetic cases; the required
rights-approved 100-case corpus is still missing.

## Current result

The current committed runs were produced from the pinned containers on native
Linux amd64 and arm64. Runtime networking was disabled, the root filesystem was
read-only, and all output was written by the invoking host UID/GID. Both
architectures produced identical normalized case evidence. The earlier macOS
arm64 source-build result remains available as a separate baseline.

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

The provisional recommendation is PySMI for canonical normalization and
libsmi only for offline lint/QA. Net-SNMP remains a compatibility oracle, not a
product runtime dependency. The evidence and remaining gate are in
[`DECISION.md`](DECISION.md).

## Corpus and rights

All checked-in `MIBVENDOR-*` fixtures were written for this experiment and are
CC0-1.0. No vendor MIB text is committed. Standard import dependencies are
extracted at runtime from the hash-locked libsmi source archive and are not
vendored into Git.

Future external fixtures belong under ignored `corpus/private/` unless their
redistribution scope is explicitly approved. A source being publicly
downloadable is not approval to commit or republish it. The 100-case result may
commit only aggregate metrics and diagnostics scrubbed of third-party MIB text.
Git and the parser Docker build context both exclude `corpus/private/`; private
fixtures must be mounted read-only at execution time and must never be copied
into an image layer.

Before any 100-case run, the private manifest and files must pass:

```sh
./scripts/validate_corpus_intake.py corpus/private/manifest.json \
  --corpus-dir corpus/private/files \
  --evidence-dir corpus/private/evidence
```

The intake requires exactly 20 cases in each planned category, ten two-file
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

They validate the harness semantics. They do not represent real IETF, IANA, or
vendor diversity.

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
```

## Reproduce in pinned containers

The Dockerfiles lock the Python, GCC, and Debian base image indexes by digest,
verify the libsmi and Net-SNMP archives by SHA-256, and use exact Python package
versions with wheel hashes for Linux amd64 and arm64. Runtime parsing is invoked
with no network, a read-only root filesystem, and a bounded tmpfs.

```sh
./scripts/run_containers.sh results/latest
```

The committed Linux evidence is in
[`results/2026-07-13-linux-amd64/`](results/2026-07-13-linux-amd64/) and
[`results/2026-07-14-linux-arm64/`](results/2026-07-14-linux-arm64/). It verifies
container build correctness, exact parser versions, image sizes, runtime
isolation, malformed-input rejection, deterministic normalized output, and
cross-architecture normalized parity. The arm64 run is tied to its public
[GitHub Actions execution](https://github.com/ta2jam/mibvendor/actions/runs/29294289938).
The earlier unavailable-daemon record is retained as audit history, not as the
current status.

## Measurement semantics

- Each case is run twice from a clean destination.
- Parse success requires an emitted, readable normalized artifact and a
  successful tool status; malformed cases must be rejected without timeout.
- Fidelity checks only fields visible in the candidate's emitted artifact.
  Net-SNMP's 5/10 score describes the tested CLI extraction path, not every
  capability that might exist in its C API.
- PySMI raw JSON embeds host and generation time, so raw hashes vary. Removing
  `meta` yields deterministic normalized output in all nine cases.
- Wall/CPU totals include process startup. The tiny corpus exaggerates Python
  startup cost and is not a throughput benchmark.
- Installed footprint and container image size are recorded separately.

Harness work is approximately `O(P * C * R * parse(input))`, with three parsers,
nine cases, and two repetitions. Peak working space is the largest parser plus
one emitted artifact. Process startup and container compilation are the main
constant and energy costs in this small run.

## Files

- `corpus/manifest.json`: cases and expected fields.
- `corpus/LICENSE.md`: checked-in fixture provenance.
- `sources.lock.json`: source URLs, hashes, and base image digests.
- `requirements-pysmi.txt`: exact packages and accepted wheel hashes.
- `scripts/run_bakeoff.py`: adapters, normalization, metrics, and aggregation.
- `scripts/validate_results.py`: dependency-free result consistency check.
- `scripts/validate_multiarch_results.py`: architecture and normalized parity check.
- `scripts/validate_corpus_intake.py`: private 100-case balance, rights, hash, and path gate.
- `containers/`: one pinned Dockerfile per candidate.
- `results/2026-07-13-macos-arm64/`: committed real local run.
- `results/2026-07-13-linux-amd64/`: committed pinned-container run.
- `results/2026-07-14-linux-arm64/`: committed native arm64 container run and provenance.
