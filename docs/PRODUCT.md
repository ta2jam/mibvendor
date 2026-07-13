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
4. consume the same resolution and provenance model through a stable API.

The web UI has first product priority. The data model and immutable release
contract are foundational because both UI and API depend on them.

## Non-goals for V1

- connecting to a user's SNMP devices;
- storing credentials, raw walks, hostnames, serial numbers, or device values;
- redistributing vendor MIB text or files without approved scope;
- accounts, billing, dashboards, a message queue, microservices, or a separate
  search engine before measurements justify them;
- claiming device identity from an OID or MIB module.

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

## Technical direction after the Phase 0 gate

A low-dependency modular monolith is the current hypothesis:

- Next.js and TypeScript for UI and route handlers;
- PostgreSQL for immutable source/module releases and active release state;
- importer and resolver commands in the same repository;
- CDN/edge cache for public reads.

No production stack is selected until parser, corpus, demand, and target
workloads pass Phase 0. Exact OID resolution uses integer subidentifier arrays.
Given OID depth `d` and `N` indexed definitions, ancestor resolution is roughly
`O(d log N)` with one bounded query; exact lookup is `O(log N)` and children are
`O(log N + k)`. SNMP permits up to 128 subidentifiers, so no design may assume a
depth near 20.
