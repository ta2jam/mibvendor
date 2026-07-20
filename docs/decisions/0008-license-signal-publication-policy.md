# ADR 0008: Treat a pinned repository license signal as publication permission

Status: Accepted

Date: 2026-07-15

## Decision

When GitHub identifies a recognized SPDX license and the corresponding license
file is present at the pinned source commit, mibvendor treats that repository
license signal as permission to publish candidates from that repository. The
decision applies to raw download, metadata, rendered text, API output, and bulk
export, subject to the detected license's obligations.

A direct notice inside an artifact overrides that repository-level signal when
it explicitly claims confidential/proprietary material, prohibits copying,
use, disclosure, or distribution, or restricts the artifact to an internal or
authorized audience. The artifact remains as pinned metadata and hashed notice
evidence, but its raw bytes are not retained in public staging and it cannot be
selected for publication. Copyright, `All rights reserved`, and trademark lines
alone are not treated as this conflict; the scanner requires a narrow direct
restriction to avoid turning ordinary attribution into a false prohibition.

`NOASSERTION`, an absent license file, an unmapped custom license, public source
availability, or a repository homepage alone does not qualify. Those candidates
remain quarantined.

GitHub sometimes classifies a default-branch license but returns `NOASSERTION`
for the identical file queried by commit ref. That fallback is accepted only
when the classified path and Git blob identifier exactly equal a configured
license file in the pinned commit. The snapshot records this recognition basis;
a path or blob mismatch remains quarantined.

License-derived artifacts retain the pinned license file, source commit, source
path, Git blob identifier, source and served SHA-256, and the explicit basis
`repository-license-signal`. They enter staging first. Activation still requires
collision handling, parse success, provenance validation, an immutable data
release, and rollback support.

## Relationship to ADR 0007

This decision supersedes ADR 0007 only where ADR 0007 prohibited promoting a
repository-level license signal. File-specific notices and written grants remain
stronger evidence. The historical `rights-cleared-2026-07-14.1` catalog was not
retroactively mutated; qualifying artifacts were promoted through the separate,
immutable `license-signaled-2026-07-20.2` release.

[ADR 0012](0012-scope-bound-manual-license-classification.md) adds a narrower
manual path for a named adapter scope when automated discovery reports
`NOASSERTION` but exact pinned license bytes, Git blobs, SHA-256 values, and
required markers all verify. It does not reclassify the repository or allow
general `NOASSERTION` candidates to leave quarantine.

## Consequences

- Repository owners may have included third-party files they did not own or
  intend to relicense. The automated signal cannot prove otherwise.
- Attribution, source-offer, reciprocal-license, notice, correction, and
  takedown obligations must be preserved by source adapter.
- Copyleft sources must not be merged into an ambiguously licensed aggregate;
  their artifacts and derived records retain source-level license identity.
- Discovery validation is `O(C)` for `C` candidates. Intake hashing is `O(B)`
  for total downloaded bytes with `O(1)` streaming-hash memory per worker.
