# ADR 0007: Publish MIB content through a fail-closed rights catalog

Status: Accepted

Date: 2026-07-14

## Decision

Every public source and MIB module has one publication mode:

- `redistributable`: approved metadata, rendered text, API output, raw download,
  and export, subject to retained license notices;
- `metadata-only`: only explicitly approved derived fields;
- `directory-only`: publisher, official source URL, and rights state only;
- `quarantine`: no public source content.

Unknown is never upgraded to metadata-only. Public download availability, an
OID's factual character, or possession of a file is not accepted as a license.
Raw responses are generated only from manifest rows below
`data/mibs/redistributable`, include the artifact SHA-256, and link the license
and original source.

## Approved inventory boundary

The first release includes:

1. post-2008 IETF-stream RFC modules discovered through MIB/managed-object terms
   in the RFC index title or abstract, after code-component notice and
   restrictive-legend checks;
2. all 20 raw MIB registry files directly linked by IANA's maintained-MIB group;
3. 18 Net-SNMP/UCD/LM-Sensors project modules from pinned tag `v5.9.5.2`.

Same-name IANA files supersede RFC extracts. Net-SNMP's copied RFC MIBs are not
reclassified as project-authored content. Pre-2008 IETF modules and vendor files
remain outside the raw public corpus unless their exact controlling terms are
separately approved.

## Consequences

- Vendor metadata requested by product design remains unavailable until written
  scope evidence exists; the UI may link only to the official source.
- Every update is an immutable data release and may shrink if rights evidence
  fails. Availability is subordinate to the publication gate.
- Catalog verification is `O(total artifact bytes)` for checksums and `O(M+O)`
  for `M` modules and `O` normalized objects, with streaming hash memory `O(1)`.
- Runtime OID resolution uses a prefix hash index and is `O(d)` per query for
  OID depth `d`, rather than scanning all objects.
