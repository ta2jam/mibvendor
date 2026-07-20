# ADR 0005: Prepare provisional foundation contracts without opening Phase 1

Status: Partially superseded by ADR 0010; provisional contracts and open Phase
0 gates remain
Date: 2026-07-14

## Decision

Check in parser-neutral source, canonical module, immutable release, active
pointer, and parser-adapter contracts plus 20 UX golden tasks. Validate their
shape and semantic invariants in CI without adding a production framework,
database, importer, public API, or unapproved third-party data.

These artifacts are provisional. Their presence does not satisfy the Phase 0
evidence gate and does not mark Phase 1 started or complete.

## Reason

The contracts expose expensive data-model mistakes early and are reversible.
Production scaffolding would create migration and operational commitments before
demand, vendor rights, and the 100-case parser gate are evidenced.

## Consequences

- Phase 0 status and exit criteria remain unchanged.
- Production code cannot claim these schemas are frozen.
- Hash canonicalization, real corpus results, rights-approved sources, and field
  sessions remain required before implementation is promoted beyond provisional
  foundation work.
