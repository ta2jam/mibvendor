# Parser decision record

Status: **provisional; Phase 0 parser gate not passed**.

## Recommendation

Use PySMI 2.0.0 as the provisional canonical parser behind a project-owned
normalization schema. Use libsmi 0.5.0 only in offline import QA/lint. Do not add
Net-SNMP to the application runtime; retain it only as a compatibility oracle
for behaviors that must match common SNMP tooling.

This is not a final selection. The 9-case synthetic run cannot establish vendor
compatibility. Pinned containers pass on native Linux amd64 and arm64 with
identical normalized case evidence, but no rights-approved 100-case result exists.

## Evidence

PySMI and libsmi both:

- parsed all 6 syntactically valid fixtures;
- rejected all 3 malformed or unresolved fixtures without a timeout;
- preserved all 10 requested revision/import/TC/enum/INDEX/AUGMENTS/notification checks;
- produced deterministic project-normalized output in all 9 cases;
- preserved two module-qualified `mvSharedName` descriptors with different OIDs.

PySMI is the provisional canonical choice because it emits structured JSON with
all requested fields and maps directly into a project-owned intermediate schema.
Its current locked release installed without native compilation. Its raw artifact
is not reproducible because it embeds host and generation time; the harness must
strip `meta`, after which all normalized hashes were stable.

libsmi is substantially faster and smaller in this tiny local run, and its
file/line/severity diagnostics are better suited to QA. It also caught semantic
SMI warnings that the PySMI compile path did not expose. That measured diagnostic
benefit justifies a second tool only in the offline import pipeline. It is not the
canonical choice because building 0.5.0 on the current Clang required an explicit
`-Wno-error=implicit-function-declaration` compatibility flag. Carrying an old C
build into the main normalization path creates avoidable maintenance risk.

Net-SNMP parsed/rejected all cases and preserved collisions, but its tested CLI
artifact exposed only 5 of 10 requested field checks. Revisions and imports were
not present in that extraction path. The locked official 5.9.4 source archive
also compiled to a binary reporting `5.9.4.pre2`. Neither fact makes Net-SNMP a
bad SNMP tool; they make this CLI path a weak canonical ingest contract.

The measured timing and RSS do not decide the selection. Nine small files mostly
measure process startup, and RSS is a per-candidate child high-water mark. The
100-case multi-architecture container run must supply representative throughput
and memory data.

## Exit criteria for the parser gate

The parser gate may move from provisional only when all items below are met:

1. Build the planned 100-case corpus:
   - 20 IETF/IANA cases;
   - 20 valid vendor cases;
   - 20 known-broken vendor cases;
   - 20 revision-pair cases;
   - 20 collision/import cases.
2. Record source URL, SHA-256, acquisition date, and approved test/redistribution
   scope for every external fixture. Unknown-rights material stays private and
   no MIB text leaks into committed results or diagnostics.
3. Run all candidates from the locked containers with runtime network disabled;
   reproduce at least on Linux arm64 and one clean Linux amd64 runner.
4. Require no crashes/timeouts, 100% deterministic normalized output, 20/20
   module-qualified collision preservation, and at least 95% fidelity across the
   requested fields. Any missing revision, INDEX, AUGMENTS, or notification must
   be explained case by case rather than averaged away.
5. Measure warm batch throughput, CPU, peak RSS, installed/image size, and
   malformed-input behavior. Do not compare the current process-startup totals
   as parser throughput.
6. Freeze and document the project-owned intermediate schema. Re-running the
   same release must produce the same normalized hashes independent of host,
   paths, timestamps, and input traversal order.
7. Reconsider the recommendation if PySMI fails the thresholds or if libsmi's
   measured compatibility advantage outweighs its native-build maintenance cost.

Until these conditions pass, implementation may use the PySMI adapter only for
prototype work. It must not be treated as an irreversible production contract.
