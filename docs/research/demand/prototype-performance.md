# Walk prototype performance baseline

Measured: 2026-07-13
Runtime: Node.js v26.5.0, macOS arm64
Command: `npm run benchmark:prototype`

Synthetic input: 50,000 numeric `ifOperStatus` rows, 2,188,893 bytes.

| Measure | Result |
|---|---:|
| Resolved rows | 50,000 |
| Wall time | 110.428 ms |
| RSS before | 60,899,328 bytes |
| RSS after | 112,590,848 bytes |
| RSS delta | 51,691,520 bytes |

This is one warm-process observation, not a latency or memory promise. OS page
accounting, allocator state, runtime version, and input shape affect RSS. Energy
was not instrumented.

The prototype loads and splits the complete string, stores every parsed row,
and scans six mock definitions for every line. With `L` lines, `N` mock
definitions, and average OID depth `d`, time is `O(L × N × d)` and memory is
`O(input bytes + L)`. This is acceptable only for the Phase 0 mock. The planned
implementation must stream/chunk parsing, deduplicate numeric OIDs before
bounded server batches, and use indexed resolver probes. Its target and memory
ceiling must be remeasured with real mixed walks before Phase 3 exits.

## Rights-cleared API catalog baseline

Measured: 2026-07-14

Runtime: local Node.js process on macOS arm64

Catalog: 5,398 searchable records, including 5,392 rights-cleared parsed nodes

One maximum-size `POST /v1/resolve:batch` request resolved 1,000 OIDs in 6.1 ms
and returned 1,340,558 bytes. Process RSS was 105,696 KiB before the request and
109,360 KiB after it. This is a warm-process observation, not an SLA. The
resolver uses a numeric-prefix index, so one OID lookup is `O(d)` in OID depth;
a batch is `O(B × d)` for `B` OIDs. Response serialization and response bytes,
not lookup work, dominate the maximum batch's transient memory and energy cost.

The `v0.2.0-alpha.1` production container limit was therefore 192 MiB. A
128 MiB limit left less than 20 MiB of measured headroom before accounting for
Linux/container runtime differences and concurrent responses. This historical
limit is superseded for the expanded corpus by the
[corpus candidate benchmark](../../operations/corpus-release-candidate-benchmark.md)
and a 640 MiB container limit. Production RSS and container health must still
be checked after deployment.
