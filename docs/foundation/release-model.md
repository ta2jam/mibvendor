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

Before real data exists, the digest projection must be frozen. It must define
canonical JSON serialization, excluded self-hash fields, string normalization,
and ordering. The same bytes must yield the same SHA-256 across supported
platforms. The current examples validate hash shape and references only.

Release construction must fail if counts drift, a module references an absent
source snapshot, canonical and manifest hashes disagree, or a source lacks the
rights required for the intended output. Rollback is pointer movement followed
by cache invalidation and verification; rebuilding an older release is not a
rollback.
