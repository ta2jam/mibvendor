# Corpus release candidate

`scripts/build-corpus-release-candidate.mjs` builds an isolated, non-active corpus candidate. It never edits `data/`, the active release, tags, or deployment state.

## Build

Use a new release id, an explicit timestamp, and a fresh output directory:

```bash
node scripts/build-corpus-release-candidate.mjs \
  --release-id rights-cleared-YYYY-MM-DD.N \
  --generated-at YYYY-MM-DDTHH:MM:SS.000Z \
  --minimum-modules 550 \
  --output .local/corpus-release-candidates/rights-cleared-YYYY-MM-DD.N
```

The build exits `2` when the candidate verifies correctly but is not activation-ready, including a missed minimum-module target, a public-id collision, or a restrictive notice in a preserved artifact. Omitting `--minimum-modules` records the final count without imposing a module target. Existing output directories are refused so an earlier candidate cannot be silently overwritten.

The output is self-contained: active and newly selected raw MIB files, required license files, `mib-catalog.json`, `mib-objects.json`, `source-catalog.json`, and `corpus-release-report.json`. The report records every selected artifact and every rejection.

## Fail-closed gates

A staged raw variant is selectable only when all of these hold:

- source discovery and intake agree on a recognized repository-license signal, pinned commit, SPDX id, immutable URL, blob id, and path;
- the artifact contains no direct conflicting notice: explicit confidentiality/proprietary claims, copy/use/distribution prohibitions, or internal/authorized-audience-only restrictions override the repository license signal and reject the artifact;
- the raw checksum and declared module name match intake;
- the exact artifact has `static-pass`, complete OID resolution, matching staged-object count, no duplicate-symbol diagnostic, and no missing dependency diagnostic;
- the staged rows for a promoted module have unique case-folded public ids derived from `module--symbol`; any collision rejects the whole module before dependency closure and is listed under `public_object_id_collisions` on the rejection;
- no active module has the same name;
- the exact raw `selected_artifact_id` named by `corpus-expansion-candidates.json` passes every gate; a failing or absent selected variant rejects the module without falling back;
- every dependency is in the preserved active release or the final selected raw-module closure.

Same-name content/revision conflicts and exact duplicates remain explicit as non-active variants in the report and promoted module metadata. They do not inflate module or object counts. Public-id collisions are never hash-disambiguated or collapsed. Dependency removal is iterative, so a rejected dependency also rejects its dependants. Compiled artifacts are not promotion inputs.

The notice scanner intentionally does not reject a copyright line, `All rights reserved`, or a trademark notice by itself. Its small rule set requires a direct restrictive, prohibitive, or confidential statement. Each match records the rule, category, one-based line range, and a SHA-256 digest of the exact full line span after only newline normalization. The report never republishes the matched notice text. A matching newly selected artifact is rejected at `artifact-notice-gate`; a matching preserved artifact is disclosed under `artifact_notice_gate.blocking_preserved_artifacts` and forces `readiness.activation_ready` to `false` rather than silently deleting active data.

The same gate runs earlier during license-derived intake. A conflicting artifact remains in `license-derived-intake.json` only as pinned provenance, module identity, byte/hash metadata, and notice evidence. It is marked `quarantined-not-retained`; its raw bytes are not written under public staging and it is excluded from raw corpus selection. Validation rescans every retained raw artifact and requires every quarantined path to be absent, so a clean-clone CI run needs no quarantined bytes and fails if one is reintroduced.

The candidate also removes exact uppercase reserved grammar-keyword rows left by the historical active parser. Each removed pseudo-object and the corresponding active module `resolved_oid_count` adjustment is recorded under `corrections`; legitimate lowercase vendor symbols are not treated as this parser correction.

## Verify

```bash
node scripts/build-corpus-release-candidate.mjs \
  --verify .local/corpus-release-candidates/rights-cleared-YYYY-MM-DD.N
```

Verification checks release/count consistency, raw identities and hashes, restrictive-notice disclosures for every included raw artifact, promoted-module dependency closure, case-folded public-id uniqueness, active reserved-symbol corrections, each object's exact module-level provenance resolution, copied license hashes, textual-convention and notification totals, and the report's document hashes. A verified candidate is still not an active or production release; activation remains a separate reviewed operation.

The report also lists stable public object-id collisions and sets `readiness.activation_ready` to false while any remain. Meeting `--minimum-modules` and passing resource checks does not override that integrity gate.

Planning is linear in raw bytes and dependency edges, plus deterministic artifact/object sorting: `O(RB + A log A + O log O + E)` time and `O(Bmax + A + O + E)` memory, where `R=6` fixed notice rules and `Bmax` is the largest artifact text scanned at once. Raw files are hashed and copied as streams/by the filesystem. The decompressed staging object catalog is still the main memory driver; the self-contained object JSON and copied raw corpus are the main disk drivers.
