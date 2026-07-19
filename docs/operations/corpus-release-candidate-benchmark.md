# Corpus candidate resource benchmark

This benchmark is isolated from active data and production. It uses `scripts/benchmark-corpus-release-candidate.mjs` to load a candidate into a standalone Node process, build runtime-shaped record, exact-OID, id, and parent/child indexes, start a loopback HTTP server, and consume every response body.

## 2026-07-20 result

Candidate: `.local/corpus-release-candidates/license-signaled-2026-07-20.2`

- Release: `license-signaled-2026-07-20.2`
- Catalog: 702 modules, 76,606 OID objects, 32 sources
- `mib-objects.json`: 46,005,925 bytes (43.87 MiB), reduced by keeping immutable provenance at module/source/report level
- Host: Apple M4 arm64, 16 GiB RAM, macOS 26.5.2
- Runtime: Node v26.5.0
- Cold listen-ready time: 360.837 ms, including construction of the reusable normalized search index
- Startup RSS: 282,001,408 bytes (268.94 MiB)
- Post-benchmark/process peak RSS: 332,300,288 bytes (316.91 MiB)
- RSS gate: startup and peak are below 512 MiB

Loopback HTTP latency after one warm-up per operation:

| Operation | Iterations | p50 | p95 | Max |
|---|---:|---:|---:|---:|
| Exact OID | 50 | 1.576 ms | 1.965 ms | 2.135 ms |
| Text search | 10 | 12.928 ms | 16.669 ms | 16.669 ms |
| 1,000-item exact-OID batch | 10 | 4.726 ms | 7.092 ms | 7.092 ms |

Command:

```bash
node scripts/benchmark-corpus-release-candidate.mjs \
  --candidate .local/corpus-release-candidates/license-signaled-2026-07-20.2 \
  --exact-iterations 50 \
  --search-iterations 10 \
  --batch-iterations 10
```

The exact lookup and batch paths scale with OID depth and batch length. Text
search still scans the normalized index in `O(N)` time, but normalization is
paid once at startup instead of once per request. The retained normalized text
is the main incremental memory cost. The benchmark approximates the runtime's
retained data structures but does not import the active runtime or include
Cloudflare, TLS, VPS contention, production-control evaluation, PEN records,
or logging. It is a resource gate, not a production latency claim.

## Collision and integrity gate

The builder rejected modules with case-folded public object-id collisions before
dependency closure; their dependants were rejected iteratively. It also removed
six reserved grammar-keyword pseudo-objects left by the older active parser and
corrected the affected module counts. A separate artifact-content gate rejected
restrictive redistribution notices even when a repository-level license signal
existed. The final candidate has zero public object-id collisions, zero preserved
restrictive-notice conflicts, exceeds the 550-module threshold, passes the 512
MiB resource gate, and reports `activation_ready: true`. Rejected modules remain
explicit in the immutable candidate report; no hash suffix or silent
last-write-wins behavior is used.
