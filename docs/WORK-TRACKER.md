# Product work tracker

Updated: 2026-07-15

This is the binding implementation tracker for corpus growth, device identity,
web UX, and the permanently free API. Work is ordered by dependency and product
impact. A lower item does not displace an unfinished higher item unless the
higher item is externally blocked and the lower item can progress safely.

## Product decisions

- The public API remains free. Billing, subscriptions, paid plans, and a paid
  data tier are out of scope. Fair-use limits, optional abuse-control keys,
  caching, and response bounds remain allowed.
- Releases are grouped around one measurable product outcome, not commit count.
- A recognized SPDX repository license plus its pinned license file is treated
  as publication permission. `NOASSERTION`, missing license files, and unmapped
  custom licenses remain quarantined. License-derived approval does not prove
  third-party file ownership, so provenance, obligations, correction, and
  takedown controls remain mandatory.
- Corpus counts must separate active public, metadata-only, directory-only, and
  quarantined records. Candidate or duplicate files do not inflate public
  coverage.

## Status vocabulary

| Status | Meaning |
|---|---|
| `planned` | Ordered but not started |
| `in-progress` | Active implementation work |
| `blocked` | Cannot progress without external evidence or authority |
| `complete` | Acceptance criteria and tests passed |

## Ordered data and identity work

### DATA-01 — Source discovery and per-file rights inventory

Status: `in-progress`

Build a reproducible source registry and discovery snapshot covering official
vendor repositories, open-source monitoring/device-definition projects,
open-source SNMP agents, package sources, and standards organizations. Discovery
records metadata only. Recognized pinned license signals produce
`redistributable` candidates; all other content starts in quarantine.

Acceptance criteria:

- every source is pinned to an immutable repository revision;
- every candidate records path, Git blob identifier, size, source type, pinned
  URL, repository license signal, and review state;
- recognized repository SPDX signals require a pinned license file and are
  recorded explicitly as `license-derived-approval`;
- incomplete/truncated source trees fail closed;
- secrets and GitHub credentials are never written to the snapshot;
- discovery output is deterministic apart from the recorded generation time;
- a validator and automated tests enforce the selected license-signal rule and
  reject unauthorized promotion, unpinned URLs, duplicate candidates, and
  count drift.

### DATA-02 — Open-license project MIB ingestion

Status: `in-progress`

Ingest MIBs from sources with a recognized pinned repository license signal.
Retain complete licenses and notices, label the approval basis, and keep source
families and copied third-party files separable for correction or takedown.

Acceptance criteria:

- active public module count grows by at least five times from the 110-module
  `rights-cleared-2026-07-14.1` baseline before the corpus-expansion release;
- every artifact has source and served SHA-256, license, notice, revision, and
  immutable provenance;
- every repository-license approval is labelled `repository-license-signal`
  and remains independently removable if ownership evidence conflicts;
- parser failures and missing imports are recorded without partial publication.

### DATA-03 — Legacy standards file-by-file review

Status: `planned`

Re-evaluate pre-2008 IETF and other legacy standards modules through explicit
code notices, author grants, IANA-maintained successors, or independently
licensed implementations. Do not blanket-approve the legacy class.

Acceptance criteria:

- every accepted module has a file-specific controlling basis;
- same-name successors and obsolete revisions remain distinguishable;
- rejected and unknown candidates remain quarantined with a machine-readable
  reason.

### DATA-04 — Open-source device identity inventory and adapters

Status: `planned`

Inventory independently authored device definitions and model mappings from
projects such as LibreNMS, Netdisco, Zabbix, and OpenNMS. Keep project-authored
identity definitions separate from bundled vendor MIB files and preserve each
source's license boundary.

Canonical identity fields:

```text
sys_object_id, enterprise_number, vendor, product_family, model, platform,
match_method, claim_strength, confidence, evidence_url, source_license,
source_revision, firmware_range, valid_from, valid_to
```

Acceptance criteria:

- exact, prefix, signature, and registry-only matches are distinct;
- field-level provenance survives normalization;
- conflicting mappings are retained rather than overwritten;
- copied vendor descriptions are not smuggled through an open-source project
  license.

### DATA-05 — Evidence-backed model identity engine

Status: `planned`

Correlate exact `sysObjectID`, chassis `ENTITY-MIB` fields, vendor model OIDs,
`sysDescr` signatures, enterprise assignment, and capability evidence. The
first reference task is a defensible Cisco Catalyst 9300 result.

Acceptance criteria:

- result states are `exact_model`, `product_family`, `platform`, `vendor_only`,
  `conflicting_evidence`, and `unknown`;
- PEN 9 alone never resolves to Catalyst 9300;
- the Catalyst 9300 fixture includes positive, negative, and conflicting cases;
- every model claim exposes method, claim strength, confidence, evidence, and
  firmware limitation;
- device-provided values can be evaluated locally without storing a raw walk.

### DATA-06 — Community identity contribution workflow

Status: `planned`

Add a schema and GitHub-based review workflow for numeric identity mappings,
source evidence, sanitized device observations, firmware scope, and contributor
authority. Raw walks, credentials, customer identifiers, and serial numbers are
rejected.

Acceptance criteria:

- duplicate and conflicting claims are detected automatically;
- no contribution becomes public without evidence review;
- provenance remains attached to every normalized field;
- corrections and removals are append-only audit events.

### DATA-07 — Vendor-ready quarantine and promotion pipeline

Status: `planned`

Implement `discover -> download -> verify -> parse -> normalize -> quarantine
-> review -> activate -> rollback` for source adapters. Development uses
synthetic or user-authorized private fixtures until public scopes are approved.

Acceptance criteria:

- promotion is a rights-manifest change plus immutable release build, not a
  parser or UI rewrite;
- a source can be disabled without deleting historical release evidence;
- rollback restores the previous active pointer without mutating releases.

### DATA-08 — Browser-local private MIB workspace

Status: `planned`

Parse user-supplied MIBs inside a Web Worker, resolve local imports, and combine
them temporarily with the public catalog. Raw files and values do not leave the
browser unless the user explicitly chooses a future export operation.

Acceptance criteria:

- network instrumentation proves zero raw-file upload;
- public and private objects are visually and structurally distinct;
- missing import and collision diagnostics expose no local path or raw text;
- clearing the workspace removes local state;
- the workflow handles the measured 50,000-line walk boundary.

### DATA-09 — Revision, duplicate, and conflict engine

Status: `planned`

Identify a module variant by module name, module revision, source family,
source revision, and artifact SHA-256. Never overwrite a same-name variant.

Acceptance criteria:

- exact duplicates collapse without inflating counts;
- revision variants remain queryable;
- dependency resolution records which variant satisfied an import;
- conflicting symbols and OIDs remain explicit.

### DATA-10 — Storage and search scale bake-off

Status: `planned`

Benchmark the current in-memory index, immutable SQLite/FTS5, and PostgreSQL
with trigram/full-text indexes on real-shaped 100,000, 1,000,000, and 2,000,000
object datasets.

Initial measurement targets:

- exact OID p95 below 25 ms;
- text search p95 below 150 ms;
- 1,000-OID batch below 2 seconds;
- runtime RSS below 512 MiB;
- release plus indexes below 10 GiB;
- import time, startup time, CPU time, serialized bytes, and disk amplification
  are recorded.

### DATA-11 — Honest public corpus statistics

Status: `planned`

Expose separate counts for modules, revisions, objects, notifications, textual
conventions, exact identities, family identities, vendors, unresolved imports,
directory-only sources, and quarantined candidates.

Acceptance criteria:

- active public and quarantined counts are never combined;
- duplicate modules and aliases do not inflate totals;
- API and UI counts derive from the same immutable release manifest.

### DATA-12 — Source freshness, correction, and takedown operations

Status: `planned`

Add scheduled upstream diffing, license/notice change detection, checksum drift,
source and module kill switches, correction records, immutable release diffs,
and tested rollback.

Acceptance criteria:

- a failed rights recheck blocks activation;
- one module or source can be withdrawn without rebuilding unrelated history;
- takedown and rollback drills are recorded and machine-verifiable.

### DATA-13 — Permanently free API contract

Status: `planned`

Record the no-paid-tier decision in an ADR, README, website, OpenAPI, and API
documentation. Retain fair-use controls and bounded responses without billing.

Acceptance criteria:

- no billing, payment, subscription, or paid-plan code or copy exists;
- optional keys are described only as free abuse-control credentials;
- caching, ETags, pagination, and immutable release downloads reduce cost;
- documentation distinguishes free access from unlimited use or an SLA.

## Ordered web UX work

### UI-01 — Routable information architecture

Status: `planned`

Replace the growing anchor-only page with deep-linkable routes for search,
numeric OIDs, objects, modules and revisions, enterprise records, device/model
identity, release detail, and comparison. Preserve browser history, canonical
URLs, and shareable state.

### UI-02 — Unified omnibox and query classification

Status: `planned`

Classify numeric OIDs, instances, `MODULE::symbol`, symbols, modules, vendors,
models, `sysObjectID`, enterprise numbers, monitoring intent, notifications,
and textual conventions. Group result types and show the deterministic match
reason; exact matches cannot rank below description-only matches.

### UI-03 — Faceted and virtualized result browsing

Status: `planned`

Add publisher, module, kind, access, status, syntax, rights, revision, and
identity-strength filters with cursor pagination and DOM virtualization.

### UI-04 — Full MIB module page

Status: `planned`

Show identity, revisions, source, license, counts, root OID, imports, imported
symbols, dependants, missing/cyclic dependencies, object kinds, module-scoped
search, lazy tree, revision selection, and raw availability.

### UI-05 — Lazy virtualized OID tree

Status: `planned`

Load children on demand, virtualize wide subtrees, support keyboard navigation,
persist expanded nodes in URL state, and synchronize breadcrumbs and object
detail. Provide children, ancestors, and subtree-summary API operations.

### UI-06 — Device identity workbench

Status: `planned`

Accept `sysObjectID`, `sysDescr`, `entPhysicalModelName`,
`entPhysicalVendorType`, and local numeric walk fragments. Present exact model,
reason, evidence, alternatives, conflicts, firmware scope, and confidence.

### UI-07 — Identity conflict and uncertainty presentation

Status: `planned`

Show competing mappings side by side with source revision, date, match method,
and evidence. Never silently convert a prefix, signature, or PEN into an exact
model.

### UI-08 — Operational object detail

Status: `planned`

Add copy actions, scalar and table-index composers, enum rendering, related
objects, table/row/index breadcrumbs, notification varbinds, read/write risk,
revision history, compact provenance, command/exporter snippets, and device
verification guidance.

### UI-09 — Semantic revision comparison

Status: `planned`

Compare added, removed, OID, syntax, access, status, enum, description, import,
and dependency changes across module revisions or data releases.

### UI-10 — Accessible dependency graph

Status: `planned`

Visualize direct, transitive, missing, cyclic, imported-symbol, and dependant
relationships with an equivalent accessible table.

### UI-11 — Full-corpus local walk decoder

Status: `planned`

Replace the six-fixture resolver with either a downloadable compressed public
index or OID-only batch resolution while keeping raw lines and values local.
Add Web Worker streaming, deduplication, progress/cancel, table grouping,
unresolved-subtree grouping, local export, and virtualized results.

### UI-12 — Private MIB workspace UI

Status: `planned`

Add drag-and-drop local modules, dependency diagnostics, collision selection,
local tree, public/private badges, temporary union search, and an explicit clear
operation.

### UI-13 — Compact provenance and rights disclosure

Status: `planned`

Keep source, revision, confidence, and publication state in the primary result;
move checksums, full scope matrices, and license detail into an accessible
provenance drawer.

### UI-14 — Accessibility and responsive master-detail

Status: `planned`

Add WCAG 2.2 AA browser checks, axe automation, keyboard golden flows, reduced
motion, mobile result/detail history, 320 px overflow coverage, and accessible
tree/graph table alternatives.

### UI-15 — Free API documentation

Status: `planned`

Publish a concise free-API statement, copyable curl/JavaScript/Python examples,
real responses, error states, pagination, caching, release pinning, fair-use
limits, OpenAPI, health/status links, and prohibited sensitive inputs.

## Outcome-based release sequence

### v0.3.0-alpha.1 — Corpus expansion engine

Status: `planned`

One result: every approved file in the defined discovery universe is imported
reproducibly and public module coverage is at least five times the 110-module
baseline. Infrastructure-only or documentation-only changes do not trigger the
release.

### v0.4.0-alpha.1 — Device identity

Status: `planned`

One result: evidence-backed model identity works end to end. Target at least
1,000 exact mappings across at least ten vendor families, including positive,
negative, and conflict-tested Catalyst 9300 identification.

### v0.5.0-alpha.1 — Browse at scale

Status: `planned`

One result: users can navigate a large corpus through routable search, a full
module page, lazy tree, facets, revision comparison, and measured keyboard,
mobile, and one-million-object performance gates.

### v0.6.0-alpha.1 — Local private MIB

Status: `planned`

One result: a user can parse and browse a vendor MIB and decode a walk without
uploading the raw module or raw values.

### v0.7.0-alpha.1 — Free API stability

Status: `planned`

One result: the permanently free API has caching, ETags, pagination, release
pinning, measured fair-use behavior, and at least three external integrations,
with no billing code.

## Progress log

### 2026-07-15 — DATA-01 discovery foundation

- Added a commit-pinned GitHub source registry and reproducible discovery
  snapshot.
- Indexed seven upstream repositories: LibreNMS, Netdisco MIBs, Netdisco
  SNMP::Info, Erlang/OTP SNMP, Net-SNMP, Prometheus SNMP Exporter, and Zabbix.
- Classified 367 candidates as redistributable from recognized pinned
  repository-license signals; 8,783 candidates remain quarantined.
- Added minimum-count drift checks, complete-tree checks, pinned URL checks,
  credential-leak checks, and regression tests.
- DATA-01 remains `in-progress`: directly vendor-owned official source leads
  still need a durable registry and periodic discovery coverage.

### 2026-07-15 — DATA-02 license-derived intake

- Staged 24 Erlang/OTP MIB artifacts from an immutable Apache-2.0 source
  revision and retained the pinned license file.
- Verified every artifact and license with its Git blob identifier and SHA-256.
- Found 23 collision-free module names and one active-catalog name collision;
  the full parser gate remains open.
- Kept staging outside the active catalog and production image. DATA-02 remains
  `in-progress` until the 550-module release threshold, parser/collision gates,
  notices, and immutable activation manifest pass.
