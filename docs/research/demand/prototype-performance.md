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
