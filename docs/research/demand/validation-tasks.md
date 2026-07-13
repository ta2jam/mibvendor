# Moderated validation tasks

Use sanitized fixtures. Do not connect the public service to a live device. Record the prototype build and data release for every session.

## Beginner tasks

### B-T1 — intent to polling target

Scenario: “You need to monitor interface operational status on port index 7. Find the correct object and produce a numeric polling target plus a command template.”

Pass requires:

- Selects `IF-MIB::ifOperStatus`, not a similarly named object.
- Distinguishes base object from instance and appends `.7`.
- Identifies enum meanings and uses a non-secret credential placeholder.
- States that device response must still be tested.

Limit: 4 minutes. Material error: wrong object/instance or exposed credential.

### B-T2 — scalar versus table

Scenario: “Use the supplied module page to retrieve one scalar uptime value and all rows of an interface-name table.”

Pass requires `.0` for scalar, subtree/table operation for rows, and correct explanation of index suffix. Limit: 4 minutes.

### B-T3 — unsupported metric

Scenario: “A vendor MIB search shows temperature-like definitions, but none appears in the sanitized complete device walk. Decide what you can conclude.”

Pass requires no fabricated OID; distinguishes definition from device implementation; proposes vendor/firmware/scope verification. Limit: 3 minutes.

## Expert tasks

### E-T1 — walk decoding

Scenario: “Turn this mixed numeric walk into readable interface rows and identify the row with an operationally down state.”

Fixture sizes: 500 lines in sessions; separate performance test at 50,000 lines/10 MB.

Pass requires longest-prefix resolution, correct instance suffix, table grouping by index, enum rendering, missing-cell visibility, and no raw values sent to the server. Session limit: 5 minutes.

### E-T2 — composite index and dynamic lookup

Scenario: “Join a port-name table to a VLAN-state table whose row key contains two index components.”

Pass requires identifying both components, producing the correct row, and explaining the join. Limit: 5 minutes.

### E-T3 — useful-object selection

Scenario: “From this 300-object vendor module, select the minimum objects needed for temperature alerting and inventory. Produce numeric OIDs and explain exclusions.”

Pass requires ≤10 relevant objects, correct types/units/indexes, and no blind whole-module export. Limit: 6 minutes.

## API/tool developer tasks

### A-T1 — batch resolver integration

Scenario: “Using only the proposed contract, map a 1,000-OID sanitized batch to object metadata while preserving unknowns and instance suffixes.”

Pass requires deterministic mapping, partial-success handling, release pin, no N+1 request pattern, and explicit invalid/not-found states. Limit: 6 minutes.

### A-T2 — reproducible config generation

Scenario: “Generate a Zabbix/Prometheus-style definition from selected objects and prove that a later data update cannot silently change the output.”

Pass requires numeric OIDs, table lookup labels, immutable release identifier, provenance, and explicit diff/update path. Limit: 6 minutes.

### A-T3 — negative/error behavior

Scenario: “Handle ambiguous symbol, invalid OID, rights-restricted definition, missing dependency, and oversized batch.”

Pass requires programmatically distinct error types/statuses with actionable fields and no fallback to an unapproved source. Limit: 5 minutes.

## Comparative baseline

For search/browse tasks, compare against the participant’s normal tool, not an arbitrary site. Counterbalance order. Use the same scenario and success criteria. Record task completion and time; subjective preference alone is insufficient.

## Aggregate acceptance targets

- Golden-task correctness: ≥90% on the fixed internal 20-task suite before public V1.
- Expert exact lookup median: <10 seconds after first-use orientation.
- Beginner guided task median: <60 seconds only for the narrowly defined lookup step; full scenarios above have longer limits.
- Zero material wrong-answer errors in the release candidate task suite.
- 50,000-line/10 MB walk: streaming parse; record wall time, peak memory, bytes uploaded, and UI responsiveness. No “optimal” claim without measurements.
