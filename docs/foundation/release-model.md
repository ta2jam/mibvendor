# Immutable data releases

Status: provisional; Phase 0 open

A data release is an immutable manifest containing exact source snapshots,
canonical module hashes, counts, schema version, and an optional predecessor.
The release identifier never means “latest.” Responses will eventually expose
the exact release identifier used.

The active-release pointer is mutable and deliberately separate. Promotion,
rollback, rights revocation, and correction move that pointer; they never edit a
published release manifest. This gives one atomic operational action and keeps
audit history intact.

Foundation records use RFC 8785 JSON Canonicalization Scheme and SHA-256. Strings
are preserved without Unicode normalization, object keys use raw UTF-16 code-unit
ordering, arrays retain their order, and output bytes are UTF-8. Source snapshots
exclude root `snapshot_id`, canonical modules exclude root `canonical_sha256`,
and release manifests exclude root `manifest_sha256` from their own digest. The
checked-in fixtures carry verified content addresses.

Release construction must fail if counts drift, a module references an absent
source snapshot, canonical and manifest hashes disagree, or a source lacks the
rights required for the intended output. Rollback is pointer movement followed
by cache invalidation and verification; rebuilding an older release is not a
rollback.
