# Source governance

Status: provisional; Phase 0 rights gate open

Every acquired artifact becomes an immutable source snapshot. A snapshot binds
the source identity, official URL, acquisition time, artifact and notice hashes,
parser-use decision, rights evidence, and five separate output scopes. A later
rights change creates a new decision or snapshot; it does not rewrite history.

The intake path is:

1. acquire from the recorded official URL;
2. hash the artifact and applicable notice;
3. record dated rights evidence and an optional expiry;
4. fail closed for every unknown output scope;
5. parse only when parser use is approved;
6. stage normalized output against the adapter and canonical contracts;
7. include it in an immutable release only within approved scopes;
8. promote by changing the active-release pointer.

Tier P is synthetic/provisional and Tier Q is quarantine. Neither may approve
public output scopes. Unknown rights are not equivalent to permission. Parser
permission is also not permission to render text, expose API output, offer raw
downloads, or create bulk exports.

Rights revocation changes the active pointer to a safe release. Historical
manifests remain audit records, but inaccessible material must not be served.
Vendor text and raw artifacts must not appear in diagnostics, logs, commits, or
unapproved public output.
