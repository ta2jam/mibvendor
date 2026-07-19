# Takedown and rollback operations

Publication controls are fail-closed, repository-reviewed state. A source or
module is disabled by appending a chained `disable` event to
`data/publication-controls.json`; history is not deleted. Re-enabling requires a
later `enable` event and fresh evidence. A correction appends a `correction`
event that names the superseded event hash.

The control validator recomputes every RFC 8785 event digest, verifies the hash
chain, checks targets against the known release/source/module inventories, and
derives the disabled lists from the log. A hand-edited list, reordered event,
unknown target, or changed reason fails validation.

Operational order:

1. record the evidence URL and exact affected source/module;
2. append and hash the control event, then derive the disabled lists;
3. run `node scripts/validate-publication-controls.mjs` and the complete test
   suite;
4. publish a new application release so the runtime control snapshot is
   immutable with the code artifact;
5. verify search, object, module, raw-download, and cache behavior for the
   disabled target;
6. purge affected edge cache entries;
7. for a release-wide fault, move the active release pointer to the last
   verified release with a chained `rollback` event and repeat production
   verification.

The automated drill in `tests/publication-controls.test.mjs` proves disable,
re-enable, tamper rejection, state/log consistency, and rollback pointer
semantics without changing production. It is a control-plane drill, not proof
that a production cache purge or VPS rollback was executed.

## Active release evidence

Every active data release has an immutable evidence directory at
`data/releases/<data_release>/`. `activation.json` binds the first application
version that activated it, predecessor, activation time, candidate report,
active catalogs, and publication-control snapshot by exact SHA-256. Later
application releases may consume those exact bytes without rewriting the
activation record, but an application version older than the activating
version fails closed. The activating version must also match the immutable
release tag URL retained by the promotion event. The stored control snapshot must
end with the promotion event named by the activation record. Later control
events may be appended, but the activation history must remain an exact prefix
of the current hash-chained history.

`node scripts/validate-release-evidence.mjs` fails closed on unsafe release
identifiers or symlinks, missing evidence, byte drift, count drift, collisions,
an unready candidate, predecessor or timestamp mismatch, rewritten control
history, malformed release versions, or a consumer `VERSION` older than the
activation version. This check is part of `npm run verify` and
must pass before packaging or rollback.
