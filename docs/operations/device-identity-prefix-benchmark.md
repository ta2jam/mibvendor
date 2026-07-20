# Device identity platform-prefix benchmark

This is a local, synthetic baseline for the `device-identity-2026-07-20.3`
candidate. It does not measure production HTTP latency or energy use.

## Recorded run

- Date: 2026-07-20
- Host: Apple M4, 16 GiB RAM, macOS 26.5.2, arm64
- Runtime: Node.js v26.5.0
- Identity index: 6,391 exact sysObjectID keys and 655 project platform prefixes
- Command: `npm run benchmark:identity-prefixes -- 10000`
- Workload: 64 synthetic descendants per depth under the pinned Arista prefix
  `1.3.6.1.4.1.30065.1`; seven warm in-process batch samples of 10,000
  lookups after 5,000 warm-up lookups at each depth
- Scope: the public in-memory identity lookup and response construction; HTTP
  handling and JSON serialization are excluded

| OID depth | Prefix map probes | p50 batch-sample ns/lookup | p95 batch-sample ns/lookup | p50 lookups/s |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 1 | 2,437 | 3,666 | 410,409 |
| 16 | 9 | 5,541 | 6,544 | 180,482 |
| 32 | 25 | 16,567 | 17,330 | 60,362 |
| 64 | 57 | 55,137 | 59,743 | 18,137 |

The p95 column is the 95th percentile across seven batch-derived
nanoseconds-per-lookup samples. It is not a request-latency percentile and is
not a production SLO.

The process was already fully initialized when the starting memory snapshot
was taken. Starting RSS was 651,821,056 bytes, ending RSS was 847,216,640
bytes, and process peak RSS was 970,817,536 bytes. The run consumed 6,558,958
microseconds of user CPU and 111,281 microseconds of system CPU. These figures
include the full MIB and identity runtime plus temporary result allocations;
they do not isolate the 655-entry prefix index. The RSS delta must not be
reported as prefix-index memory.

## Complexity and limits

For an enterprise sysObjectID with `A` arcs, the lookup makes at most `A - 7`
descending, arc-bound `Map` probes, so the probe count is `O(A)`. The current
implementation creates every candidate prefix with `slice().join()`.
Consequently, worst-case prefix-key materialization is `O(A^2)` total character
work, string hashing, and transient allocation across one lookup even though
the number of map probes is linear. Live parsed/prefix state is `O(A)`. The prefix index itself is
`O(P)` for `P` prefixes; the complete identity engine also retains exact vendor
claims, project definitions, and fixture evidence.

The measured throughput decline is consistent with the increasing probe and
string-materialization work, but this one machine and four depths do not prove
an asymptotic bound. SNMP OID length is API-bounded, so constants and response
allocation dominate normal inputs. A numeric trie or an incremental encoded
prefix key could remove repeated string construction, but that complexity is
not justified without production profiles showing this lookup is a bottleneck.

Energy was not measured. Elapsed time and CPU time are not substitutes for an
energy measurement.

## Reproduction

Run the benchmark from the repository root:

```sh
npm run benchmark:identity-prefixes -- 10000
```

The script rejects fewer than 1,000 or more than 1,000,000 iterations per
sample, verifies every lookup resolves to the expected prefix/platform, and
prints machine-readable JSON. Results must be compared only on equivalent
runtime, host, identity release, iteration count, and workload depth.
