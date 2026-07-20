# Product work tracker

Updated: 2026-07-20

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
- [ADR 0012](decisions/0012-scope-bound-manual-license-classification.md)
  permits manual classification only for a named adapter scope whose exact
  pinned license bytes, blobs, SHA-256 values, and markers verify. It does not
  reclassify a repository or release general `NOASSERTION` candidates.
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

Status: `complete`

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

Status: `complete`

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

Status: `complete`

The completed, fixed review universe is the 14 transition-era RFCs already
quarantined by the active release's generic front-matter matcher. These are
March-August 2009 documents, not pre-2008 RFCs. Each exact RFC contains a
complete BSD-3-Clause grant inside every listed MIB module, so all 14 RFCs and
15 module definitions are accepted for a future candidate build. This review
activates zero modules and does not alter the active data release.

The machine-readable review is
[`legacy-rfc-review.json`](./research/rights/legacy-rfc-review.json). It pins the
RFC Editor index and exact RFC checksums, publication dates, embedded notice
signals, RFC successor relationships, decision reasons, and five independently
licensed active same-name variants. Those variants are explicitly not treated
as RFC successors. The unbounded pre-2008 class is outside this fixed outcome
and remains quarantined unless a later file-specific review supplies equivalent
evidence.

Acceptance criteria:

- every accepted module has a file-specific controlling basis;
- same-name successors and obsolete revisions remain distinguishable;
- rejected and unknown candidates remain quarantined with a machine-readable
  reason.

Verification: `npm run check:legacy-rfcs`; five tests cover the fixed universe,
missing notices, false successor claims, digest mutation, and the rule that an
unknown decision cannot escape quarantine.

### DATA-04 — Open-source device identity inventory and adapters

Status: `complete`

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

Current evidence: the immutable release normalizes 1,023 sanitized LibreNMS
and SNMP::Info observations over 713 exact OIDs, retains 72 conflicting OIDs,
and adds a static, non-executing RackTables adapter with 270 medium-confidence
exact model definitions. Thirty-three non-root source candidates are
quarantined. The derived definition dataset is explicitly GPL-2.0-only and
retains pinned source/license checksums without PHP, source descriptions, or
raw device data. All 19 definition-observation overlaps have reviewed
dispositions; four material disagreements stay ambiguous. The project-evidence
union is 964 OIDs. The active `device-identity-2026-07-20.3` release adds 655
unconditional, arc-bound LibreNMS `sysObjectID` platform prefixes for 406
platform keys across 266 PENs. It quarantines 358 conditional, root,
non-enterprise, shared-agent, or multi-platform literals. Exact evidence takes
priority; prefix evidence applies only to `sysObjectID`, stops at platform,
retains its matched-parent provenance, and has an independent source kill
switch. The definition-only dataset is GPL-3.0-or-later and binds the pinned
commit, tree, all 806 input files, Git blobs, SHA-256 values, license markers,
parser policy, and limits without serving raw YAML or source descriptions.

Completion covers the bounded LibreNMS, SNMP::Info, and RackTables adapters
selected for this outcome; it is not a claim that every mapping in every named
open-source monitoring project has been ingested. Exact, prefix, signature,
and registry methods remain distinct, and field-level provenance and material
conflicts survive normalization.

### DATA-05 — Evidence-backed model identity engine

Status: `complete`

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

Verification: deterministic engine/API tests cover positive, negative,
neighbor-SKU, family, generic vendor-identifier, platform, cross-vendor, and
conflicting Catalyst 9300 cases. Only 36 vendor-MIB normalizations are reviewed
exact models; 1,491 mappings stop at family/category and 4,672 generic vendor
identifiers assert neither model nor family. A separate source-bound project
definition layer contributes 270 medium-confidence exact-model claims and
never inflates the reviewed vendor count. Every public candidate retains
match type, claim scope, confidence, source evidence, and the explicit absence
of firmware/authenticity proof. The pure engine accepts only bounded individual
signals and does not require or retain a raw walk.

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

Status: `complete`

Implement `discover -> download -> verify -> parse -> normalize -> quarantine
-> review -> activate -> rollback` for source adapters. Development uses
synthetic or user-authorized private fixtures until public scopes are approved.

Acceptance criteria:

- promotion is a rights-manifest change plus immutable release build, not a
  parser or UI rewrite;
- a source can be disabled without deleting historical release evidence;
- rollback restores the previous active pointer without mutating releases.

Verification: a repository-owned materialized-source adapter now starts from a
real clean Git worktree whose origin, HEAD, tracked blob IDs, license hash, and
candidate bytes match the reviewed manifest. It executes discovery,
checksum-bound intake, restrictive-notice screening, static parsing,
normalization, variant review/quarantine, and the existing canonical validators
before writing an isolated candidate workspace. False commit/origin claims,
dirty bytes, unrecognized or changed license evidence, symlinks, submodules,
missing dependencies, duplicate symbols, unreviewed content variants, and a
non-empty target workspace fail without deleting existing evidence.

The lifecycle test then executes the deterministic candidate builder,
append-only promotion, activation-evidence validation, public runtime probes,
source disable/enable, and rollback. A separate production-owned app-pointer
command validates both immutable application release trees twice, performs an
atomic relative-symlink replacement, and records external hash-chained audit
events with explicit recovery. Validation or release-tree drift leaves the
pointer unchanged. Release trees remain byte-identical. This command manages
only the filesystem app pointer: production deployment must still reconcile
`release.env`, recreate the Docker workload, and run public health checks.

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

Status: `in-progress`

Identify a module variant by module name, module revision, source family,
source revision, and artifact SHA-256. Never overwrite a same-name variant.

Acceptance criteria:

- exact duplicates collapse without inflating counts;
- revision variants remain queryable;
- dependency resolution records which variant satisfied an import;
- conflicting symbols and OIDs remain explicit.

### DATA-10 — Storage and search scale bake-off

Status: `in-progress`

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

Status: `complete`

Expose separate counts for modules, revisions, objects, notifications, textual
conventions, exact identities, family identities, vendors, unresolved imports,
directory-only sources, and quarantined candidates.

Acceptance criteria:

- active public and quarantined counts are never combined;
- duplicate modules and aliases do not inflate totals;
- API and UI counts derive from the same immutable release manifest.

### DATA-12 — Source freshness, correction, and takedown operations

Status: `in-progress`

Add scheduled upstream diffing, license/notice change detection, checksum drift,
source and module kill switches, correction records, immutable release diffs,
and tested rollback.

Acceptance criteria:

- a failed rights recheck blocks activation;
- one module or source can be withdrawn without rebuilding unrelated history;
- takedown and rollback drills are recorded and machine-verifiable.

### DATA-13 — Permanently free API contract

Status: `complete`

Record the no-paid-tier decision in an ADR, README, website, OpenAPI, and API
documentation. Retain fair-use controls and bounded responses without billing.

Acceptance criteria:

- no billing, payment, subscription, or paid-plan code or copy exists;
- optional keys are described only as free abuse-control credentials;
- caching, ETags, pagination, and immutable release downloads reduce cost;
- documentation distinguishes free access from unlimited use or an SLA.

## Ordered web UX work

### UI-01 — Routable information architecture

Status: `complete`

Replace the growing anchor-only page with deep-linkable routes for search,
numeric OIDs, objects, modules and revisions, enterprise records, device/model
identity, release detail, and comparison. Preserve browser history, canonical
URLs, and shareable state.

### UI-02 — Unified omnibox and query classification

Status: `in-progress`

Classify numeric OIDs, instances, `MODULE::symbol`, symbols, modules, vendors,
models, `sysObjectID`, enterprise numbers, monitoring intent, notifications,
and textual conventions. Group result types and show the deterministic match
reason; exact matches cannot rank below description-only matches.

### UI-03 — Faceted and virtualized result browsing

Status: `planned`

Add publisher, module, kind, access, status, syntax, rights, revision, and
identity-strength filters with cursor pagination and DOM virtualization.

### UI-04 — Full MIB module page

Status: `in-progress`

Show identity, revisions, source, license, counts, root OID, imports, imported
symbols, dependants, missing/cyclic dependencies, object kinds, module-scoped
search, lazy tree, revision selection, and raw availability.

### UI-05 — Lazy virtualized OID tree

Status: `in-progress`

Load children on demand, virtualize wide subtrees, support keyboard navigation,
persist expanded nodes in URL state, and synchronize breadcrumbs and object
detail. Provide children, ancestors, and subtree-summary API operations.

### UI-06 — Device identity workbench

Status: `in-progress`

Accept `sysObjectID`, `sysDescr`, `entPhysicalModelName`,
`entPhysicalVendorType`, and local numeric walk fragments. Present exact model,
reason, evidence, alternatives, conflicts, firmware scope, and confidence.

Current evidence: the responsive workbench submits only four bounded fields,
renders model/family/vendor-identifier/platform/vendor/conflict/unknown states,
separates registry, vendor-MIB, open-source definition, device-signal, and
project-observation layers, exposes confidence and source links, and passed local
desktop/mobile browser flows. Singular results and every candidate now expose
`firmware_scope: "not_established"`; unknown and conflicting results expose
`null`. This item remains open only because walk-fragment handoff is not
implemented.

### UI-07 — Identity conflict and uncertainty presentation

Status: `in-progress`

Show competing mappings side by side with source revision, date, match method,
and evidence. Never silently convert a prefix, signature, or PEN into an exact
model.

Current evidence: competing candidates and material conflict types render in
both the workbench and direct sysObjectID route without selecting a singular
model; PEN-only, signature, family, and generic vendor-identifier outcomes
remain weaker than exact model. The complete production browser interaction
matrix is recorded. This item remains open until each competing row carries
its own source revision and date.

### UI-08 — Operational object detail

Status: `in-progress`

Add copy actions, scalar and table-index composers, enum rendering, related
objects, table/row/index breadcrumbs, notification varbinds, read/write risk,
revision history, compact provenance, command/exporter snippets, and device
verification guidance.

### UI-09 — Semantic revision comparison

Status: `planned`

Compare added, removed, OID, syntax, access, status, enum, description, import,
and dependency changes across module revisions or data releases.

### UI-10 — Accessible dependency graph

Status: `in-progress`

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

Status: `in-progress`

Keep source, revision, confidence, and publication state in the primary result;
move checksums, full scope matrices, and license detail into an accessible
provenance drawer.

### UI-14 — Accessibility and responsive master-detail

Status: `in-progress`

Add WCAG 2.2 AA browser checks, axe automation, keyboard golden flows, reduced
motion, mobile result/detail history, 320 px overflow coverage, and accessible
tree/graph table alternatives.

### UI-15 — Free API documentation

Status: `complete`

Publish a concise free-API statement, copyable curl/JavaScript/Python examples,
real responses, error states, pagination, caching, release pinning, fair-use
limits, OpenAPI, health/status links, and prohibited sensitive inputs.

Historical verification: deployed `v0.4.0-alpha.2` passed exact clipboard comparisons for
all five examples, cursor `0` to `1`, OpenAPI/health/status navigation, full
forward and reverse keyboard cycles, Enter activation, live regions, result
focus, strict no-overflow checks at 1280×900 and 390×844, and zero
console/page/request errors. Screenshots and the immutable production identity
are recorded in `docs/operations/ui-15-browser-evidence.md`. The
`v0.4.0-alpha.3` production follow-up verified the Arista prefix workbench and
deep route, exact-over-prefix precedence for Cisco `.9.1.1117`, visible matched
prefix/revision fields at 390x844 without horizontal overflow, and an empty
browser console; publication evidence is recorded in `docs/RELEASE.md`.

## Outcome-based release sequence

### v0.3.0-alpha.2 — Corpus expansion engine

Status: `complete`

One result: every approved file in the defined discovery universe is imported
reproducibly and public module coverage is at least five times the 110-module
baseline. Infrastructure-only or documentation-only changes do not trigger the
release. The published release meets this result with 702 active modules; its
tag, CI, VPS deployment, and live release identity are reconciled.

### v0.4.0-alpha.1 — Device identity

Status: `complete`

One result: evidence-backed model identity works end to end without converting
generic MIB symbols into device-model claims. The candidate contains 6,199
exact vendor OID assignments across ten vendor families, including 36 reviewed
exact device-model normalizations, 1,491 family/category assignments, 4,672
generic vendor identifiers, and positive, negative, and conflict-tested
Catalyst 9300 identification. The immutable tag, CI, VPS deployment, public
API/UI smoke, production monitor, and release identity are reconciled.

### v0.4.0-alpha.2 — Open-source exact device definitions

Status: `complete`

One result: a pinned open-source project-definition adapter expands exact model
evidence without relabeling project definitions as vendor-MIB claims, hiding
material conflicts, serving raw source code, or inferring firmware. The local
candidate contains 270 RackTables-derived exact-model claims, 33 quarantined
source candidates, 19 reviewed definition-observation overlap dispositions,
6,391 distinct runtime mapping keys, and 964 distinct project model-evidence
OIDs. Integration commit `4b8a89dcddea11ef8b7afdd262daf7e8a6cffbc8`,
annotated tag, green CI, exact image, VPS deployment, public API/browser smoke,
and production monitor are reconciled.

### v0.4.0-alpha.3 — Open-source platform-prefix definitions

Status: `complete`

One result: a pinned project adapter broadens platform recognition without
turning a string prefix, PEN root, conditional rule, or project label into a
model claim. The release preserves 6,391 exact keys and 964 exact
project-evidence OIDs, then adds 655 arc-bound LibreNMS `sysObjectID` prefixes
for 406 platform keys across 266 PENs. Exact matches take precedence, prefix
matching is confined to `sysObjectID`, and the source kill switch removes the
layer without fallback inference. Release commit
`c22f64758998f5ffad4979623a0add06c933c323`, annotated tag
`v0.4.0-alpha.3`, CI run `29724845067`, production image
`sha256:c5640b23d6eddc044f80de43158550f725742518fcb766620a13eacdfbb3bb5f`,
deployment time `2026-07-20T08:03:12Z`, rollback point
`/srv/sites/mibvendor/backups/pre-v0.4.0-alpha.3-20260720T075017Z`, full public
verification, Browser checks, production-monitor run `29726660532`, and the
active release identity are reconciled.

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

### 2026-07-15 — DATA-02 candidate corpus expansion

- Expanded discovery to 12 repositories and 9,756 candidates. The selected
  license-signal policy classifies 973 candidates as redistributable and keeps
  8,783 in quarantine.
- Staged 357 raw MIB variants from five licensed repositories. Of these, 315
  are collision-free against the active catalog, 41 collide with an active
  module name, and one lacks a valid module declaration.
- Statically analyzed 273 BSD-2-Clause PySNMP compiled modules without executing
  Python and extracted 20,901 candidate OID objects. Two modules carry parser
  warnings and 27 collide with active module names.
- Collapsed 739 active/raw/compiled variants into 559 unique module names: 110
  active and 449 candidates. The 550-module numerical target is met only in the
  candidate set, not in production.
- Recorded 115 multi-variant modules, including 111 content conflicts. DATA-09
  is now `in-progress`; no conflict was silently overwritten.
- DATA-02 remains `in-progress`: the 252 selected raw candidates still need the
  full parser/dependency gate, the 197 selected compiled candidates need field
  fidelity review, and only then can an immutable release be activated.

### 2026-07-15 — DATA-02 parser and fidelity baseline

- Deterministically analyzed all 252 selected raw modules without executing
  source code or loading system MIBs: 190 static passes, 57 partials, and five
  empty modules.
- Resolved 38,045 of 41,733 unique declared objects. Kept 3,688 unresolved
  objects, eight missing dependency edges across seven modules, and 16 duplicate
  symbols across five modules explicit; the parser gate remains open.
- Fixed a parser defect that treated reserved `SYNTAX OBJECT IDENTIFIER` clauses
  as object declarations. Duplicate legitimate symbols are now excluded from
  canonical output and retained as diagnostics.
- Compared raw and compiled output for 47 modules. Of 3,321 union symbols,
  3,209 have an exact symbol/OID match and none has an OID mismatch; 28 are raw
  only and 84 compiled only. Exact OID coverage is 96.6275%.
- Compiled fidelity remains open: only 47 modules are cross-format comparable,
  one of 2,026 comparable access fields differs, 17 description-presence fields
  differ, and all 197 selected compiled-only modules lack a raw reference.

### 2026-07-15 — DATA-02 semantic definitions and dependency aliases

- Added deterministic static extraction for 1,055 textual conventions and 12
  legacy SMI macros without executing source code. Syntax, status, description,
  and display hints remain staged with artifact-level provenance.
- Reclassified macro-only and textual-convention-only modules as semantic input,
  reducing `static-empty` modules from five to one. The remaining empty module,
  `OPENSS7-O248-MIB`, contains a module shell but no definitions.
- Added two explicit, artifact-backed import aliases: `RFC-1213` resolves to
  `RFC1213-MIB`, and `RFC1212` resolves to `RFC-1212`. Aliases do not change
  canonical module names or inflate corpus counts.
- Reduced missing dependency edges from eight across seven modules to six
  across five modules. The remaining CPQ and Microsoft imports are still
  missing and remain visible; no fallback dependency was inferred.
- DATA-02 remains `in-progress`: 3,688 OID declarations are unresolved, 16
  duplicate symbols remain explicit, and the parser gate is still open.

### 2026-07-20 — v0.3 corpus-expansion release candidate

- Completed DATA-01 against its documented acceptance criteria: 16 immutable
  discovery sources produce a 10,636-candidate provenance snapshot; validators
  and tests enforce complete trees, pinned URLs, license-signal evidence,
  deterministic output, credential exclusion, unique candidates, and count
  drift. A weekly GitHub workflow rebuilds the snapshot and requires explicit
  review when the rebuilt evidence differs.
- Completed DATA-02 by activating `license-signaled-2026-07-20.2`: 592 approved
  modules join the 110-module historical baseline for 702 active modules and
  76,606 collision-free searchable catalog OID nodes. Every promoted artifact
  passed immutable provenance, license/notice, parser-resolution, diagnostics,
  and dependency-closure gates; 336 rejected artifacts remain outside the
  active release.
- Completed DATA-11 with one runtime/API/UI statistics contract: 4,138 textual
  conventions, 1,273 notifications, 66,266 IANA enterprise records, 19 exact
  platform mappings, and 32 source records are reported separately from staged
  or quarantined content.
- Completed DATA-13 with the no-paid-tier ADR and public contract, bounded
  requests, cursor pagination, strong ETags and conditional responses,
  immutable release identifiers, and fair-use language. API documentation has
  copyable curl, JavaScript, and Python examples, a real same-origin success
  response, cursor continuation, and service health/status links. UI-15 remains
  `in-progress` until the expanded identity contract and complete interaction
  matrix are verified against the deployed v0.4 release.
- Completed UI-01 with safe deep routes for search, object, module, enterprise,
  `sysObjectID`, and release views plus canonical URLs and browser history.
  UI-04 and UI-05 remain `in-progress`: the routable module/object views and
  bounded ancestor/child/subtree API exist, but revision comparison, full
  module context, keyboard tree behavior, and virtualization do not.
- Began DATA-12 with scheduled source freshness and hash-chained source/module
  publication controls. Correction records and machine-verified takedown and
  rollback drills remain open.
- Completed v0.3 production publication with the immutable tag, green CI, VPS
  deployment, public release-identity checks, and an isolated 640 MiB cgroup
  preflight. Device/model identity scale and Phase 0 external-demand evidence
  remain open; no corpus count closes either gate.

### 2026-07-20 — v0.4 device-identity release

- Completed DATA-05 with an immutable, source-bound identity release, 36 narrow
  reviewed model normalizations, deterministic Catalyst 9300 positive/negative/
  conflict gates, direct PEN and reviewed organization keys, and bounded
  multi-signal assessment.
- Classified all 6,199 vendor OID assignments without count inflation: 1,491
  stop at product family/category and 4,672 remain generic vendor identifiers.
  The 713 observation OIDs are a separate corroboration layer; they never
  become universal mappings.
- Added a release-manifest SHA-256 and a separate publication-control revision,
  digest, source kill switch, and derived `identity_view`. Tests prove a
  disabled source removes its claims instead of creating a replacement.
- Added the responsive workbench and API contract with `vendor_identifier` as a
  first-class weaker state, four-unit assessment cost, bounded inputs/results,
  `no-store` responses, raw-signal non-echo rules, and an explicit unestablished
  firmware scope. Local and production browser/API flows passed.
- Published the immutable tag after green CI and three Node 22 Alpine cgroup
  runs. The measured 640 MiB/1-vCPU mixed-load peak was 237,666,304 bytes with
  zero memory-limit, OOM, OOM-kill, or restart events; the tag, VPS SHA,
  production monitor, and public release identity are reconciled.

### 2026-07-20 — v0.4.0-alpha.2 RackTables adapter release

- Added a closed static parser for the pinned RackTables `known_switches`
  table. It rejects executable/dynamic PHP shapes, enterprise roots,
  out-of-range numeric arcs, sensitive values, and unbounded model labels.
- Measured 304 literal source entries: one enterprise root is rejected, 270
  model definitions are publishable, and 33 candidates are quarantined.
- Bound source, review artifact, IANA registry, GPL-2.0-only notice/full text,
  generated dataset, runtime index, release manifest, and kill-switch source ID
  by deterministic checksums.
- Reviewed all 19 definition-observation overlaps. Fifteen equivalent or
  less-specific observations resolve; four material disagreements remain
  ambiguous and expose candidates/conflicts without selecting a model.
- Updated web examples, evidence-layer labels, direct-route conflict details,
  README, API schemas, identity documentation, third-party notices, and
  measured release statistics.
- Published the immutable tag after green CI and three isolated mixed-load
  runs. The exact image, VPS commit, public API verifier, complete desktop/mobile
  keyboard and interaction matrix, and GitHub production monitor are
  reconciled; Cloudflare no longer injects an analytics beacon into the strict
  CSP page.

### 2026-07-20 — v0.4.0-alpha.3 platform-prefix release

- Completed the bounded DATA-04 adapter inventory with a strict, non-executing
  LibreNMS OS-detection YAML parser. It publishes 655 unconditional platform
  prefixes for 406 platform keys and 266 PENs and quarantines 358 literals.
- Enforced numeric-arc boundaries, longest-prefix selection, exact precedence,
  `sysObjectID`-only use, retained parent evidence, platform-only claim
  strength, and a source-level kill switch. Prefixes never create model,
  product-family, firmware, or `entPhysicalVendorType` claims.
- Bound the clean pinned repository, commit and tree, 806 tracked files, modes,
  blobs, SHA-256 values, license markers, parser policy, generated dataset, and
  runtime/release indexes. Any drift fails closed.
- Adopted
  [ADR 0012](decisions/0012-scope-bound-manual-license-classification.md) for
  scope-bound manual license classification. The derived records are
  GPL-3.0-or-later and definition-only; raw YAML and descriptions are not
  served, and the general LibreNMS `NOASSERTION` discovery snapshot remains
  quarantined.
- Published annotated tag `v0.4.0-alpha.3` at commit
  `c22f64758998f5ffad4979623a0add06c933c323` after CI run `29724845067`.
  Image
  `sha256:c5640b23d6eddc044f80de43158550f725742518fcb766620a13eacdfbb3bb5f`
  was activated at `2026-07-20T08:03:12Z`; the rollback point is
  `/srv/sites/mibvendor/backups/pre-v0.4.0-alpha.3-20260720T075017Z`.
- Reconciled the full public verifier, host health contract, Arista prefix and
  Cisco exact-precedence Browser flows, 390x844 no-overflow result, empty
  browser console, active release identity, and successful production-monitor
  run `29726660532`.

### 2026-07-20 — Public parser breadth gate

- Selected 100 unique tracked redistributable files, hashes, and modules from
  11 sources with five deterministic 20-file strata and a 30-case source cap.
- Enforced source/revision/license/hash provenance, path and size bounds,
  duplicate rejection, deterministic selection, and measured feature floors.
- Kept positive public breadth separate from the nine CC0 malformed,
  missing-import, collision, and revision-shape cases. No valid file is
  relabelled as a known parser failure.
- Added pinned, read-only, network-disabled public runners and a native Linux
  amd64/arm64 result-parity gate.
- GitHub Actions run `29719084848` completed both native architectures and
  parity validation. PySMI 2.0.0 alone met the 94/100 public parse, 330/360
  feature, 9/9 CC0 expectation, and 10/10 CC0 field gates; the canonical parser
  decision is complete and machine-verifiable.

### 2026-07-20 — DATA-07 executable source and pointer lifecycle

- Replaced hand-built early-stage lifecycle evidence with a materialized-source
  adapter that verifies a clean commit-pinned Git checkout and runs the real
  discovery, rights/intake, parse, normalize, and review/quarantine code.
- Reused the existing restrictive-notice scanner, static parser, candidate
  builder, and canonical discovery/intake/analysis validators instead of
  defining a second parser contract.
- Added a bounded app-pointer command with two-pass immutable-tree validation,
  fail-closed TOCTOU handling, atomic replacement, private append-only audit,
  explicit interrupted-operation recovery, and a constrained host wrapper.
- Kept the operational boundary explicit: pointer activation is not a Docker
  restart, `release.env` update, or complete production deployment.
