# ADR 0012: Allow scope-bound manual classification of pinned license content

Status: Accepted

Date: 2026-07-20

## Context

Repository-discovery APIs can report `NOASSERTION` even when an exact pinned
tree contains a recognized license file and unambiguous license text. Treating
that signal as permission for the entire repository would be an unsupported
scope expansion. Treating the exact local evidence as unusable would also block
a narrowly derived dataset whose complete input and obligations can be bound
and checked.

The LibreNMS OS-detection adapter is the first use case. Its intended public
output is normalized platform-prefix definitions, not the 6,322 candidates in
the general LibreNMS discovery snapshot, raw YAML, bundled vendor MIBs, or
source descriptions.

## Decision

A named adapter may manually classify one explicit content scope when every
one of these gates passes:

- repository identity and a full 40-character source revision are configured;
- the scope identifier is explicit and path-safe;
- the expected SPDX identifier is in the repository's recognized-license
  allowlist;
- every configured license-evidence path is relative, safe, and unique;
- the bytes at the pinned revision exactly match the configured Git blob
  identifier and SHA-256;
- every configured license marker is present in those exact bytes;
- the adapter independently binds every input path, Git mode, blob identifier,
  SHA-256, byte count, source tree, parser policy, and resource limit; and
- no artifact-specific restriction conflicts with the intended publication.

Any missing or changed field, file, hash, blob, marker, revision, or scope makes
the classification `NOASSERTION` and quarantines the derived output. Public
availability, a repository homepage, an unpinned license file, or a name match
does not qualify.

Approval applies only to the named derived-content scope and the recorded
publication mode. It does not reclassify the repository, its general discovery
snapshot, sibling paths, bundled third-party files, or raw inputs. Direct
artifact-specific restrictions continue to override repository-level or
manually verified license signals.

For `librenms-os-detection`, the approved scope is
`resources/definitions/os_detection-derived-platform-prefixes`, the license is
GPL-3.0-or-later, and the publication mode is `definition-only`. The generated
records retain that license identity and a pinned source link. mibvendor does
not publish the raw upstream YAML.

## Relationship to ADR 0008

ADR 0008 remains the default repository-license-signal policy. This decision
adds a narrower evidence path when automated discovery returns `NOASSERTION`:
exact pinned content may approve only a configured adapter scope. It does not
weaken ADR 0008's rule that `NOASSERTION` remains quarantine for unscoped or
general discovery candidates.

## Consequences

- The general LibreNMS discovery snapshot remains `NOASSERTION`; its 6,322
  candidates are not promoted by this decision.
- A separate source adapter, dataset license, manifest, and kill switch are
  required for every manually classified scope.
- Review and hashing work is O(B + F) for B input bytes and F tracked files;
  the implementation stores O(F) manifest metadata and hashes one bounded file
  at a time.
- Upstream license or content changes fail closed and require a new pinned
  review, dataset, and immutable identity release.
- Manual classification is auditable but cannot prove that a repository owner
  owns every included fact; correction, attribution, source availability, and
  takedown controls remain mandatory.
