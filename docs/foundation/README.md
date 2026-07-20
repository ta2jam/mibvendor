# Provisional public-foundation contracts

Status: **provisional while Phase 0 is open**

These artifacts make later implementation decisions explicit without claiming
that Phase 1 has started or passed:

- `contracts/source-snapshot.schema.json` records source identity, provenance,
  parser permission, and five independent output-rights scopes.
- `contracts/canonical-module.schema.json` isolates the product model from any
  parser's private output shape.
- `contracts/data-release.schema.json` defines immutable release contents.
- `contracts/active-release-pointer.schema.json` keeps promotion and rollback
  separate from immutable releases.
- `contracts/parser-adapter.schema.json` bounds parser success and failure.
- `ux-golden-tasks.json` fixes 20 provisional user outcomes across beginners,
  experts, and API/tool developers.
- `prototype-golden-coverage.json` records implemented, partial, and missing
  prototype behavior without treating documents as observed user success.

The checked-in examples are synthetic contract fixtures with reproducible
RFC 8785/SHA-256 content addresses. They contain no vendor text and grant no
public output scope. See the [release model](release-model.md) for the exact
self-hash projections.

Run `npm run check:foundation` to validate schema structure, examples,
cross-document invariants, content addresses, rights fail-closed behavior, OID
consistency, and the golden-task set. Contract validation is linear outside JCS
object-key sorting; digest construction is O(n + sum(k log k)).

These documents do not authorize a production database/importer, stable API
claim, or unknown-rights vendor data. The bounded public-alpha API now serves
the immutable licensed MIB catalog, contact-free IANA CC0 PEN fields, pinned
Net-SNMP/SigScale platform identities, and a separate content-addressed
metadata-only device-identity release. Project fixtures remain an
observation-only corroboration layer. The binding gate remains
[Phase 0](../PHASE-0.md).
