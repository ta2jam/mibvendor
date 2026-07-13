# MIB parser bake-off

This experiment compares PySMI 2.0.0, libsmi 0.5.0, and the Net-SNMP 5.9.4
release archive against the same MIB inputs. It does not make the Phase 0 parser
gate pass. The checked-in corpus has nine synthetic cases; the required
rights-approved 100-case corpus and a pinned container reproduction are still
missing.

## Current result

The committed run was produced on macOS arm64 from hash-verified source archives
and a hash-locked Python environment. It is a local source-build run, not a
container-equivalent result.

| Candidate | Valid parsed | Invalid rejected | Requested field checks | Normalized deterministic | Raw deterministic | Measured wall time | Peak child RSS* |
|---|---:|---:|---:|---:|---:|---:|---:|
| PySMI 2.0.0 | 6/6 | 3/3 | 10/10 | 9/9 | 3/9 | 4.324 s | 52,544 KiB |
| libsmi 0.5.0 | 6/6 | 3/3 | 10/10 | 9/9 | 9/9 | 0.126 s | 2,544 KiB |
| Net-SNMP 5.9.4 archive | 6/6 | 3/3 | 5/10 | 9/9 | 9/9 | 0.196 s | 6,720 KiB |

\* Each candidate runs in a separate process. On macOS, `RUSAGE_CHILDREN`
reports a candidate-level high-water mark, not per-case RSS. It is unsuitable
for cross-platform ranking and is not used as a selection gate.

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
./scripts/validate_results.py results/2026-07-13-macos-arm64
```

## Reproduce in pinned containers

The Dockerfiles lock the Python, GCC, and Debian base image indexes by digest,
verify the libsmi and Net-SNMP archives by SHA-256, and use exact Python package
versions with wheel hashes for Linux amd64 and arm64. Runtime parsing is invoked
with no network, a read-only root filesystem, and a bounded tmpfs.

```sh
./scripts/run_containers.sh results/latest
```

This command was not run successfully on the current Mac: a Docker CLI exists,
but no Docker-compatible daemon or installed Docker/OrbStack/Colima runtime was
available. Therefore container build correctness, image sizes, and Linux
runtime metrics remain unverified. See
[`results/2026-07-13-container-attempt.txt`](results/2026-07-13-container-attempt.txt).

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
- Installed footprint is the local installation tree, not a container image.

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
- `containers/`: one pinned Dockerfile per candidate.
- `results/2026-07-13-macos-arm64/`: committed real local run.
