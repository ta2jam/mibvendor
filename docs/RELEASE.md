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

## Current Phase 0 boundary

`v0.1.0-alpha.10` publishes research artifacts, provisional parser-neutral
foundation contracts with RFC 8785 content addressing, measured UX golden-task
coverage, a synthetic local API probe, and the static public alpha at
`mibvendor.io` through an isolated VPS container. It
does not authorize a production database, vendor MIB publication, or public
API. The application binds only to `127.0.0.1:3001`; host-level Caddy and
Cloudflare own the public edge. GitHub independently verifies the public origin
every 15 minutes, and a hardened VPS timer checks the container, loopback bind,
release identity, public/local health, Caddy, and root-disk threshold every five
minutes.
