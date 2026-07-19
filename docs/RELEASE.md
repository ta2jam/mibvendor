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

## Current Phase 0 release candidate

`v0.3.0-alpha.1` defines the corpus-expansion release contract. Its immutable
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

The GitHub production monitor resolves the expected commit from the immutable
`v${VERSION}` release tag. It does not assume that every `main` commit has been
deployed; staged corpus and parser work may safely advance `main` while the
published production release remains pinned to its tag.
