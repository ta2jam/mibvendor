# Roadmap

Dates are not commitments. Vendor-rights responses are calendar-dependent.
The ordered implementation status and measurable release outcomes are tracked
in [WORK-TRACKER.md](WORK-TRACKER.md). That tracker is binding when this roadmap
and a task status diverge.

## Phase 0 — validate demand, rights, and parsing

- publish a task prototype early;
- collect at least 30 real tasks from beginners, experts, and API/tool
  developers;
- observe at least five users losing material time on those tasks;
- observe at least three users returning to the prototype for a second task;
- validate three concrete API integration scenarios;
- classify top-priority module/vendor sources across five rights scopes;
- obtain a viable public Tier A/B seed and at least one licensed source path
  capable of vendor-family coverage;
- run a reproducible PySMI/libsmi/Net-SNMP bake-off and select one canonical
  parser on measured results.

The parser gate is complete. PySMI 2.0.0 is selected from the 100-file public
positive-breadth corpus and the CC0 edge suite after identical native Linux
amd64/arm64 evidence. This does not close the participant-demand gates.

Phase 1 cannot start merely because documents exist. See
[the binding gate](PHASE-0.md).

Parser-neutral contracts and UX golden tasks may be prepared provisionally
while Phase 0 is open. They do not change gate status or authorize production
application/database scaffolding.

A bounded public-alpha slice now exposes enterprise lookup, evidence-limited
`sysObjectID` lookup, structured object details, module dependency states, and
batch resolution. The active `license-signaled-2026-07-20.2` slice exposes 702
manifest-bound raw modules, 76,606 searchable catalog OID nodes, 4,138 textual
conventions, 1,273 notifications, file/source checksums, four publication
modes, and fail-closed source decisions across 32 source records. This is
joined by the active `device-identity-2026-07-20.3` release: 6,391 distinct
exact lookup keys spanning 6,199 vendor-MIB assignments and 270 separate
medium-confidence RackTables-derived model claims. The vendor-MIB split remains
36 reviewed model normalizations, 1,491 family/category claims, and 4,672
generic vendor identifiers. Thirty-three RackTables source candidates are
quarantined; four reviewed definition-observation overlaps remain material
conflicts. Nineteen platform mappings remain separate, while the 713 project
observation OIDs and definitions cover 964 distinct project-evidence OIDs. The
identity release digest and
revisioned publication-control view expose source kill-switch changes. This is
validation infrastructure, not evidence that Phases 1–4 or the Phase 0
external-demand gates are complete.

The deployed `v0.4.0-alpha.3` release keeps those exact counts unchanged and adds a
separate GPL-3.0-or-later, definition-only LibreNMS layer: 655 arc-bound
`sysObjectID` platform prefixes covering 406 platform keys and 266 PENs. Exact
identity evidence has priority. Prefixes apply only to `sysObjectID`, stop at
platform, retain matched-parent evidence, and are removed by their source kill
switch. They never establish a model, product family, firmware range, or
identity from `entPhysicalVendorType`. Its immutable tag, deployed identity,
public verification, and production monitor are reconciled. The Phase 0
participant-demand, repeat-use, and external-API gates remain open.

## Phase 1 — public foundation

Status: partially delivered under ADR 0010; Phase 0 is still open, so this is
not a declaration that Phase 1 formally started.

- Complete: source governance, canonical intermediate schemas, immutable
  release model, adapter contract, 20 UX golden tasks, reproducible CI, and
  fail-closed publication controls, plus quarantine-only community identity
  contribution governance.
- Open: the provisional contracts may still change before Phase 0 closes.

## Phase 2 — data engine and internal resolver

Status: partial.

- Complete: deterministic approved-source intake, dependency graph states,
  diagnostics, exact/symbol/instance/ancestor resolution, search, immutable
  activation evidence, exact-precedence arc-bound identity prefixes,
  source/module kill switches, and a validated atomic filesystem app-pointer
  rollback with external audit and recovery.
- Open: queryable revision variants, variant-bound dependency resolution,
  generic takedown drills, and the 100K/1M/2M storage bake-off.

## Phase 3 — task-first web and walk decoder

Status: partial.

- Complete: routable search/object/module/enterprise/identity/release views,
  structured object semantics, bounded tree navigation, dependency states,
  device identity, table/index guidance, command examples, and a production
  desktop/mobile API-documentation matrix.
- Open: unified query classification, facets, full module context,
  virtualization, semantic revision comparison, accessible graph/table parity,
  and a full-corpus Web Worker walk decoder. The existing 50,000-line decoder
  benchmark uses a limited local resolver and never uploads raw values.

## Phase 4 — public API

Status: public alpha delivered; stability evidence remains open.

- Complete: versioned search, resolve, object, navigation, module, raw,
  dependency, source, enterprise, identity, batch, status, and release
  endpoints; provenance and rights fields; OpenAPI 3.1; RFC 9457 errors;
  bounded pagination; cache contracts; fair-use controls; and permanently free
  access with no paid tier or paid quota upgrade.
- Open: three independent external integrations and any compatibility or SLA
  claim. The API is prerelease and intentionally carries no availability SLA.

## Phase 5 — production and controlled expansion

Status: partial production operation.

- Complete: isolated release directories and Compose project on the shared
  VPS, loopback-only application binding, least-privilege read-only container,
  rollback points, host Caddy, proxied Cloudflare DNS/edge, immutable tags,
  CI, five-minute host checks, scheduled GitHub production verification, and
  source/module publication kill switches.
- Open: generic correction/takedown drills and source-expiry automation. No
  production database or application volume exists because the current
  immutable in-memory release does not need either; they must not be added
  merely to satisfy an old architecture sketch. A local private-MIB workflow
  remains conditional on measured demand.
