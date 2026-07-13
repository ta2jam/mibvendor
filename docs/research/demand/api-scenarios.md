# API integration scenario hypotheses

These are contract hypotheses for interviews and thin client tests. They are not “real integrations” until a qualified API/tool developer uses or commits to use them in an actual workflow.

Common rules:

- HTTPS JSON, explicit API version, immutable `data_release`.
- Numeric OIDs are arrays/normalized dotted strings; never compare them as plain lexicographic text.
- Partial batch success is explicit and order-preserving.
- Every definition carries source, revision, parse status, and allowed output scopes.
- Errors are machine-distinguishable; no silent source or revision fallback.
- Raw walk values are not required by these public endpoints.

## H1 — Client-local walk decoder with batch OID resolution

Actor: browser, CLI, or monitoring diagnostic tool with a sanitized or private walk.

Input contract:

```http
POST /v1/resolve:batch
Content-Type: application/json

{
  "data_release": "2026-07-13.1",
  "oids": [
    "1.3.6.1.2.1.2.2.1.8.7",
    "1.3.6.1.2.1.31.1.1.1.6.7",
    "1.3.6.1.4.1.999999.1.0"
  ]
}
```

Response contract:

```json
{
  "data_release": "2026-07-13.1",
  "results": [
    {
      "input": "1.3.6.1.2.1.2.2.1.8.7",
      "status": "resolved",
      "object": {"module": "IF-MIB", "symbol": "ifOperStatus", "oid": "1.3.6.1.2.1.2.2.1.8"},
      "instance_suffix": [7],
      "semantics": {"kind": "table-column", "enums": {"1": "up", "2": "down"}},
      "provenance": {"source_id": "...", "module_revision": "...", "scopes": ["metadata_index", "api_output"]}
    },
    {"input": "1.3.6.1.4.1.999999.1.0", "status": "not_found"}
  ]
}
```

Contract tests:

1. Longest valid object prefix is selected; instance suffix is preserved as integer components.
2. Input order and duplicates are preserved.
3. Unknown OID is a per-item state, not whole-request failure.
4. Invalid syntax is distinct from unknown valid syntax.
5. A 1,000-OID batch performs one request and has a documented maximum; oversized input returns `413` or `422` with a stable problem type.
6. Network inspection confirms no walk values, hostnames, serials, or filenames leave the client.

Validation question: would a developer replace their current resolver with this contract, and what latency/batch ceiling is required? No developer has answered yet.

## H2 — Monitoring template/exporter config generator

Actor: Zabbix/LibreNMS/Prometheus integration code selecting a small useful object set.

Flow:

1. `GET /v1/search?q=temperature&vendor=...&kind=scalar,table-column&match=any&data_release=...`
2. `GET /v1/objects/{stable_id}?data_release=...`
3. `GET /v1/modules/{stable_id}/dependencies?data_release=...`
4. Generator emits numeric OIDs, units/enums, table indexes/lookups, and source comments.

Contract tests:

1. Exact symbol match outranks description-only match; ranking is deterministic within a release.
2. Ambiguous symbols return all qualified module/revision candidates and never auto-pick invisibly.
3. Object representation contains enough semantics to generate scalar, counter-rate, enum, table-index, and notification fixtures.
4. Generated configuration includes numeric OIDs and `data_release`; repeating against the same release is byte-stable.
5. Rights-restricted raw/rendered content is omitted while permitted metadata remains explicit; an unknown-rights source is not returned publicly.
6. Dependency errors identify the missing import and affected object.

Validation question: can three external generators complete one real config without an undocumented field or manual database scrape? Current result: untested.

## H3 — Release-aware NMS enrichment/cache

Actor: NMS, CMDB, trap pipeline, or documentation portal that enriches stored numeric OIDs and needs controlled updates.

Contract:

```http
GET /v1/data-release
GET /v1/releases/{release}/changes?since={older_release}&cursor=...
GET /v1/objects/{stable_id}?data_release={release}
```

Required change types: object added/removed/moved, syntax/access/status/index/enum/description changed, module revision/source/provenance changed, and rights scope changed.

Contract tests:

1. Release identifiers are immutable; active-release promotion never mutates an older response.
2. Change feed is cursor-stable and paginated; replay is idempotent.
3. Cache key includes API version plus `data_release` plus canonical query.
4. A rights-scope revocation is visible as a change event and prevents new disallowed output without rewriting historical release identity.
5. Unknown, deleted, and unavailable-due-to-rights are distinct states.
6. Rollback changes the active pointer, not release contents.

Validation question: does a real integration require a diff feed, or is periodic full refresh cheaper/simpler? Until measured, the diff endpoint is optional complexity and must not be built solely from this hypothesis.

## Performance model to test, not promise

- Exact object lookup: target `O(log N)` database index lookup.
- Longest-prefix resolution: up to OID depth `d` exact-prefix probes, approximately `O(d log N)`; SNMP OIDs allow bounded depth, but constants and batch size dominate.
- Batch response memory/network: `O(b × result_size)` for batch size `b`; cap `b`, stream client parsing, compress responses, and benchmark energy/CPU rather than claiming optimality.
- Search: depends on the chosen text index and returned `k`; measure query latency and index memory with the real corpus.
