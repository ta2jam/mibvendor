# ADR 0008: Treat a pinned repository license signal as publication permission

Status: Accepted

Date: 2026-07-15

## Decision

When GitHub identifies a recognized SPDX license and the corresponding license
file is present at the pinned source commit, mibvendor treats that repository
license signal as permission to publish candidates from that repository. The
decision applies to raw download, metadata, rendered text, API output, and bulk
export, subject to the detected license's obligations.

`NOASSERTION`, an absent license file, an unmapped custom license, public source
availability, or a repository homepage alone does not qualify. Those candidates
remain quarantined.

License-derived artifacts retain the pinned license file, source commit, source
path, Git blob identifier, source and served SHA-256, and the explicit basis
`repository-license-signal`. They enter staging first. Activation still requires
collision handling, parse success, provenance validation, an immutable data
release, and rollback support.

## Relationship to ADR 0007

This decision supersedes ADR 0007 only where ADR 0007 prohibited promoting a
repository-level license signal. File-specific notices and written grants remain
stronger evidence. The active `rights-cleared-2026-07-14.1` catalog is not
retroactively mutated.

## Consequences

- Repository owners may have included third-party files they did not own or
  intend to relicense. The automated signal cannot prove otherwise.
- Attribution, source-offer, reciprocal-license, notice, correction, and
  takedown obligations must be preserved by source adapter.
- Copyleft sources must not be merged into an ambiguously licensed aggregate;
  their artifacts and derived records retain source-level license identity.
- Discovery validation is `O(C)` for `C` candidates. Intake hashing is `O(B)`
  for total downloaded bytes with `O(1)` streaming-hash memory per worker.
