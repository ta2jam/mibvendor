# Product definition

Status: Phase 0 hypothesis, not a validated product claim.

## Positioning

mibvendor is an OID discovery, source-confidence, and walk-decoding layer for
monitoring engineers and tool developers.

It must let a user:

1. resolve a numeric OID, `MODULE::symbol`, or monitoring intent;
2. understand scalar, table, index, notification, and revision context;
3. turn existing walk output into named, grouped, readable rows without sending
   raw values to the server;
4. correlate PEN assignment, exact `sysObjectID`, ENTITY-MIB model fields, and
   bounded platform signatures without hiding conflicts or unsupported claims;
5. consume the same resolution and provenance model through a versioned API.
6. distinguish redistributable, metadata-only, directory-only, and quarantined
   sources without mistaking a download link for permission.

The web UI has first product priority. The data model and immutable release
contract are foundational because both UI and API depend on them.

The official public API is permanently free and has no paid tier, billing, or
paid quota upgrade. Free access remains subject to bounded requests, fair-use
controls, and no availability SLA. Optional API keys, if introduced, are free
abuse-control credentials only; see
[ADR 0009](decisions/0009-permanently-free-api.md).

## Non-goals for V1

- connecting to a user's SNMP devices;
- storing credentials, raw walks, hostnames, serial numbers, or device values;
- redistributing vendor MIB text or files without approved scope;
- accounts, billing, dashboards, a message queue, microservices, or a separate
  search engine before measurements justify them;
- claiming a manufacturer, product, or model without exact source evidence.

## Corpus tiers

| Tier | Public output | Entry requirement |
|---|---|---|
| A | Approved content and explicitly approved scopes | Source-specific rights evidence |
| B | Approved metadata fields only | Metadata redistribution separately approved |
| Q | None; internal QA/reference only | Terms permit the intended internal use |
| P | None; local/private user input | User-controlled data; no public merge or retention |

"Facts are not copyrightable" is not a valid blanket Tier B approval. Database
rights, contractual terms, extraction, and jurisdiction still require a
source-specific decision.

The five independent scopes are `metadata_index`, `rendered_text`,
`api_output`, `raw_download`, and `bulk_export`. Approval for one never implies
approval for another.

## Technical direction

A dependency-free Node.js public-alpha runtime currently serves the static UI
and bounded API from one process. It uses no production database and loads only
reviewed immutable snapshots. The active `license-signaled-2026-07-20.2`
release contains 702 redistributable modules, 76,606 searchable catalog OID
nodes, 4,138 textual conventions, 1,273 notifications, the IANA PEN registry,
and 6,391 distinct exact identity lookup keys. The separate
`device-identity-2026-07-20.2` release retains 6,199 vendor-MIB mappings: 36
reviewed model normalizations, 1,491 product-family/category claims, and 4,672
generic vendor identifiers. A distinct GPL-2.0-only RackTables-derived layer
adds 270 medium-confidence exact-model claims; 33 source candidates remain
quarantined. Four of 19 reviewed definition-observation overlaps remain
material conflicts, so 270 is not presented as a count of unconditionally
resolved models. Nineteen platform mappings remain a separate claim class.
The 713 observation OIDs and project definitions cover 964 distinct OIDs when
deduplicated. An immutable release digest and a separately
hashed, revisioned publication-control view make source kill-switch changes
observable without rewriting historical evidence. The public source catalog
contains 12 redistributable and 20 directory-only sources.

The `v0.4.0-alpha.3` candidate advances the identity release to
`device-identity-2026-07-20.3` without changing the 6,391 exact keys or 964
exact project-evidence OIDs. It adds 655 definition-only LibreNMS platform
prefixes for 406 platform keys across 266 PENs. Prefix matching is arc-bound,
applies only to `sysObjectID`, and yields no model or product family. Exact
identity evidence always wins, parent prefix evidence remains inspectable, and
the `librenms-os-detection` kill switch removes the layer as a unit. The
derived records are GPL-3.0-or-later and bind the exact source revision, tree,
files, blobs, hashes, license markers, and source date; raw YAML is not served.
This is a candidate until the production release identity is reconciled.

The current runtime remains smaller than the later data-engine hypothesis:

- Next.js and TypeScript for UI and route handlers;
- PostgreSQL for immutable source/module releases and active release state;
- importer and resolver commands in the same repository;
- CDN/edge cache for public reads.

No database stack is selected until parser, corpus, demand, and target workloads
pass Phase 0. The current in-memory resolver hashes each known numeric prefix;
exact/ancestor resolution is `O(d)` time for OID depth `d` and `O(N)` index
memory for `N` definitions. Text search is currently `O(N*t)` for `t` query
tokens. Device identity exact lookup is expected `O(1)`. Platform-prefix lookup
uses O(A) descending map probes for OID arc count `A`, but current `slice`/`join`
key construction and string hashing can require O(A²) character work and
transient allocation in the worst case. Startup is `O(V+D+P+F)` and
identity-index memory is `O(V+D+P+F)` for vendor claims `V`, exact definitions
`D`, prefixes `P`, and fixture OIDs `F`. SNMP permits up to
128 subidentifiers, so no design may assume a depth
near 20. Measured latency and memory, not dataset size alone, decide when a
database/search index is justified.
