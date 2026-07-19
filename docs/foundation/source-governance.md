# Source governance

Status: implemented for the rights-cleared public core and license-derived staging

Every acquired artifact becomes an immutable source snapshot. A snapshot binds
the source identity, official URL, acquisition time, artifact and notice hashes,
parser-use decision, rights evidence, and five separate output scopes. A later
rights change creates a new decision or snapshot; it does not rewrite history.

The intake path is:

1. acquire from the recorded official URL;
2. hash the artifact and applicable notice;
3. record dated rights evidence and an optional expiry;
4. approve recognized SPDX repository-license signals under ADR 0008 and fail
   closed for `NOASSERTION`, absent license files, and unknown output scopes;
5. parse only when parser use is approved;
6. stage normalized output against the adapter and canonical contracts;
7. include it in an immutable release only within approved scopes;
8. promote by changing the active-release pointer.

Tier P is synthetic/provisional and Tier Q is quarantine. Neither may approve
public output scopes. A pinned recognized SPDX repository license is accepted as
permission under [ADR 0008](../decisions/0008-license-signal-publication-policy.md);
an absent or unmapped license is not. If GitHub classifies the default-branch
license but returns `NOASSERTION` for the same file at a commit ref, the signal
is accepted only when the classified path and Git blob identifier exactly match
the configured license file in the pinned commit. Parser
permission is also not permission to render text, expose API output, offer raw
downloads, or create bulk exports.

Rights revocation changes the active pointer to a safe release. Historical
manifests remain audit records, but inaccessible material must not be served.
Vendor text and raw artifacts must not appear in diagnostics, logs, commits, or
unapproved public output.

The public runtime maps these tiers to four explicit publication modes:
`redistributable`, `metadata-only`, `directory-only`, and `quarantine`. Raw
downloads require `raw_download=approved` on both the source and module manifest
row. `directory-only` exposes no derived MIB fields; even a vendor file checksum
is withheld because producing it would require acquiring and processing content
without an approved metadata scope.

The executable gate is `scripts/validate-mib-catalog.mjs`. It verifies all raw
paths remain below the approved directory, source and served SHA-256 values,
license/notice mapping, source scopes, manifest completeness, object ownership,
and the absence of unmanifested MIB files.
