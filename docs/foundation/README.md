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

The checked-in examples are synthetic contract fixtures. Their repeated hash
values demonstrate field shape and cross-reference rules; they are not claims
that those fixture documents were content-addressed. The production digest
projection must be frozen and tested before any real data release.

Run `npm run check:foundation` to validate schema structure, examples,
cross-document invariants, rights fail-closed behavior, OID consistency, and the
golden-task set. Runtime is O(total contract bytes + objects + tasks); memory is
linear in those inputs.

No production database, production importer, public API, or third-party vendor
data is authorized by these documents. The binding gate remains
[Phase 0](../PHASE-0.md).
