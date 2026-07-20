# Release and production contract

This document defines the repository meaning of the owner's instruction
`prod'a al`.

## Versioning

- Semantic Versioning is used before and after `1.0.0`.
- Phase 0 artifacts use prerelease versions such as `0.1.0-alpha.1` while an
  evidence gate remains open.
- A tag is immutable. Fixes produce a new version; a published tag is not moved.
- Every runtime and public data release must expose its application version,
  Git commit SHA, schema version, and immutable data-release identifier.

## `prod'a al` completion rule

Production publication is complete only when all applicable checks pass:

1. local application tests, migration checks, and build pass from a clean
   working tree;
2. the release commit and annotated version tag exist locally;
3. branch and tag are pushed, remote GitHub resolves both to the expected SHA,
   and required CI is green;
4. protected-branch review requirements are satisfied unless the owner
   explicitly authorizes a documented exception;
5. the target VPS has a verified backup/restore point before a stateful change;
6. application image/artifact, migration state, configuration schema, and
   public data release are deployed atomically or in a documented safe order;
7. Cloudflare/DNS/edge state points to the intended healthy origin;
8. production health, UI smoke, API smoke, version endpoint, rollback path, and
   critical logs are verified;
9. local `main`, remote `main`, release tag, deployed Git SHA, and reported
   application version are reconciled and recorded as the same release.

Deploying a working directory without publishing the corresponding commit/tag
is not production completion. Pushing code without deploying and verifying the
VPS is also not production completion.

## v0.3 corpus-expansion baseline

`v0.3.0-alpha.2` defines the corpus-expansion release contract. Its immutable
`license-signaled-2026-07-20.2` data release contains 702 redistributable
modules, 76,606 searchable catalog OID nodes, 4,138 textual conventions, 1,273
notifications, file/source checksums, retained notices, and fail-closed raw
downloads. The 32 reviewed source records remain separated into 12
redistributable and 20 directory-only sources. The release preserves the
110-module `rights-cleared-2026-07-14.1` baseline and promotes 592 modules only
after license-signal, parser-resolution, dependency-closure, collision, and
resource gates pass. Two hash-chained publication-control events retain the
baseline and promotion decisions.

The API also includes the contact-free IANA PEN snapshot, 19 pinned Net-SNMP
and SigScale `sysObjectID` mappings with explicit claim strength, dependency
states, batch resolution, RFC 9457 failures, and per-client rate limiting. It
does not authorize a production database, unknown-rights vendor content, broad
product-model coverage, or a stable/SLA-backed API claim. The API is
permanently free but fair-use bounded: it has no paid tier or paid quota
upgrade, and free access does not imply unlimited use or an availability SLA.

Production status: complete on 2026-07-20 after the commit, immutable tag, CI,
VPS deployment, public smoke checks, and release-identity reconciliation met
the completion rule above. The exact release image also passed an isolated
Linux cgroup preflight: 40 concurrent searches and a 1,000-OID batch completed
with zero OOM, limit, or restart events and a 229,392,384-byte peak under the
640 MiB limit. The application binds only to
`127.0.0.1:3001`; host-level Caddy and Cloudflare own the public edge. GitHub
independently verifies the public origin every 15 minutes, and a hardened VPS
timer checks the container, loopback bind, release identity, public/local
health, Caddy, disk threshold, and representative API results every five
minutes.

## v0.4 device-identity release

`v0.4.0-alpha.1` delivers an evidence-bounded identity flow spanning the web
workbench, exact lookup, multi-signal assessment, OpenAPI contract, and
production probes.

The immutable `device-identity-2026-07-20.1` release contains 6,199 exact
vendor-MIB OID assignments across ten vendor families: 36 narrow reviewed
device-model normalizations, 1,491 product-family/category assignments, and
4,672 generic vendor identifiers that assert neither a whole-device model nor
a family. It keeps 713 project-observation OIDs as a separate corroboration
layer and 19 existing platform mappings as a separate claim class. The release
manifest SHA-256 binds its source revisions, datasets, licenses, built-in
claims, and runtime-index digest.

A separately hashed publication-control document selects the active identity
release and carries a positive control revision plus sorted source kill
switches. API responses expose the release digest, control digest/revision, and
derived `identity_view`; a control change is therefore observable without
mutating the immutable release. The fair-use bucket is 120 units per client per
minute and device assessment consumes four units. Every singular identity and
candidate explicitly reports `firmware_scope: "not_established"`; unknown or
conflicting outcomes use `null` instead of implying firmware-wide support.

Production status: complete on 2026-07-20 after the immutable tag, green CI,
VPS deployment, public UI/API checks, production monitor, and release identity
were reconciled. Before cutover, the runtime-equivalent Node 22 Alpine image
passed three cold-start mixed-load runs with a 640 MiB memory limit, 1 vCPU,
and no swap. Each run issued a 75-request mixed burst with up to 40 concurrent
requests, consuming exactly 120 fair-use units. Listen readiness was 8.0–8.5
seconds, p95 response latency was
4.1–4.4 seconds, and memory peaks were 231,550,976–237,666,304 bytes, with zero
memory-limit, OOM, OOM-kill, or restart events. The previous 0.25-vCPU cap
produced a measured 17.2-second p95 under the same burst and was raised to
1 vCPU; idle resource use is unaffected by that ceiling.

The GitHub production monitor resolves the expected commit from the immutable
`v${VERSION}` release tag. It does not assume that every `main` commit has been
deployed; staged corpus and parser work may safely advance `main` while the
published production release remains pinned to its tag.

## v0.4.0-alpha.2 — RackTables exact definitions release

One measurable result: the immutable `device-identity-2026-07-20.2` release
adds a source-bound open-source project-definition layer while preserving the
vendor-MIB and project-observation boundaries. A static, non-executing parser
finds 303 non-root exact OID candidates in pinned RackTables commit
`e5fff9f8aab339798ed47e8c6d7d977ed97a82bd`; 270 bounded model definitions are
published at medium confidence and 33 are quarantined. The runtime now exposes
6,391 distinct exact lookup keys and 964 distinct project model-evidence OIDs.

All 19 definition-observation overlaps have explicit reviewed dispositions:
15 are equivalent labels or less-specific observations, while four material
disagreements return an ambiguous result with no singular model. The dataset
is explicitly GPL-2.0-only and retains the pinned upstream `COPYING` and
`LICENSE`. API output contains normalized definitions and provenance only; it
does not serve RackTables PHP, source descriptions, port summaries, raw walks,
private device values, or firmware inference. The RackTables source has an
independent publication kill switch.

Origin HTML shell responses, including explicit SPA fallback routes, use
`Cache-Control: public, max-age=0, must-revalidate, no-transform`. The
`no-transform` directive is the operational boundary against Cloudflare beacon
injection or other edge HTML mutation under the strict CSP. CSS, JavaScript,
OpenAPI, and API cache contracts remain independently defined and unchanged.

Production status: complete. Annotated tag `v0.4.0-alpha.2`, commit
`4b8a89dcddea11ef8b7afdd262daf7e8a6cffbc8`, and image
`sha256:a233549f91570819d11bf6f573d19fb6cec6c35c1f8fde9fe51abb92f0af20c7`
were reconciled before deployment at `2026-07-20T04:01:07Z`. CI run
`29715595292`, the full production verifier, and production-monitor run
`29716094534` passed. The pre-deployment rollback point is
`/srv/sites/mibvendor/backups/pre-v0.4.0-alpha.2-20260720T040107Z`.

Three mixed-load runs each completed 75 requests at up to 40 concurrent
requests with 75/75 HTTP 200 responses. Measured p95 latency was 3.557–3.898
seconds and peak memory was 232,353,792–243,404,800 bytes; no run recorded an
OOM, OOM kill, or restart. Production Chromium verification passed at
1280×900 and 390×844 for the assessment keyboard path and result focus, all
five clipboard examples, cursor `0` to `1`, exact and conflicting deep routes,
the OpenAPI/health/status links, and horizontal-overflow checks. The run
recorded no console, page, or request errors and no Cloudflare beacon
injection; origin HTML retained the `no-transform` boundary.
