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
- obtain a viable public Tier A/B seed and at least one vendor permission path;
- run a reproducible PySMI/libsmi/Net-SNMP bake-off and select one canonical
  parser on measured results.

Phase 1 cannot start merely because documents exist. See
[the binding gate](PHASE-0.md).

Parser-neutral contracts and UX golden tasks may be prepared provisionally
while Phase 0 is open. They do not change gate status or authorize production
application/database scaffolding.

A bounded public-alpha slice now exposes enterprise lookup, evidence-limited
`sysObjectID` lookup, structured object details, module dependency states, and
batch resolution. The rights-cleared slice also exposes 110 manifest-bound raw
modules, 5,392 parsed OID nodes, file/source checksums, four publication modes,
and fail-closed source decisions. This is validation infrastructure, not
evidence that Phases 1–4 or the Phase 0 demand/vendor-rights gates are complete.

## Phase 1 — public foundation

- freeze source governance, canonical intermediate schema, immutable release
  model, adapter contract, and 20 UX golden tasks;
- establish application skeleton and reproducible CI;
- bundle no unapproved third-party data.

## Phase 2 — data engine and internal resolver

- deterministic importer, dependency graph, diagnostics, revisions, and module
  variants;
- exact, symbol, instance, and ancestor resolver;
- atomic activation, rollback, search, and measured performance baselines.

## Phase 3 — task-first web and walk decoder

- omnibox, grouped results, object/module/notification pages, table/index
  guidance, command generation, lazy tree, and accessibility;
- browser-local streaming walk parse and local value join;
- target benchmark: 10 MiB or 50,000 lines, with no raw-walk logging.

## Phase 4 — public API

- versioned search, resolve, object, module, dependency, batch, and data-release
  endpoints;
- provenance and rights fields, OpenAPI 3.1, JSON Schema, RFC 9457 errors,
  bounded pagination, caching, and protective rate limits.

## Phase 5 — production and controlled expansion

- isolated application/database/volume/secrets/backups on the shared VPS;
- restore, failed-release, and rollback drills;
- Cloudflare DNS/edge configuration and production verification;
- source freshness, rights expiry, corrections, and takedown operations;
- only approved Tier A/B sources; local CLI if private-MIB demand is measured.
