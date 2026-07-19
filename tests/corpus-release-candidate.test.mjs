import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { scanArtifactRestrictiveNotices } from "../scripts/lib/artifact-restrictive-notices.mjs";
import { buildReleaseCandidate, verifyReleaseCandidate } from "../scripts/lib/corpus-release-candidate.mjs";

const RELEASE = "synthetic-candidate-1";
const GENERATED_AT = "2026-07-20T10:00:00.000Z";

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mibvendor-release-input-"));
  const data = path.join(root, "data");
  const activeRaw = "ACTIVE-MIB DEFINITIONS ::= BEGIN\nactive OBJECT IDENTIFIER ::= { 1 3 }\nEND\n";
  const activeSha = sha(activeRaw);
  await mkdir(path.join(data, "mibs", "redistributable", "active"), { recursive: true });
  await writeFile(path.join(data, "mibs", "redistributable", "active", "ACTIVE-MIB.mib"), activeRaw);
  await json(path.join(data, "mib-catalog.json"), {
    schema_version: 1,
    data_release: "active-1",
    generated_at: "2026-07-19T00:00:00Z",
    policy: "fail-closed",
    inventory_scope: "Synthetic active fixture.",
    source_snapshots: {},
    counts: { modules: 1, resolved_objects: 1, publishers: { Active: 1 }, publication_modes: { redistributable: 1, "metadata-only": 0, "directory-only": 0 } },
    modules: [{
      id: "ACTIVE-MIB", publisher: "Active", source_id: "active", publication_mode: "redistributable", raw_download: true,
      source_url: "https://example.test/ACTIVE-MIB", source_revision: "active-rev", source_sha256: activeSha, artifact_sha256: activeSha,
      raw_path: "mibs/redistributable/active/ACTIVE-MIB.mib", license: { spdx: "MIT", name: "MIT", url: "https://example.test/LICENSE", notice_required: true },
      revision: null, dependencies: [], declared_oid_count: 1, resolved_oid_count: 1
    }]
  });
  await json(path.join(data, "mib-objects.json"), { schema_version: 1, data_release: "active-1", objects: [{ id: "active-mib--active", module: "ACTIVE-MIB", symbol: "active", oid: "1.3", kind: "object-identifier", syntax: null, access: null, status: null, description: null, enums: {}, parent: null, oid_resolution: "source-absolute" }] });
  await json(path.join(data, "source-catalog.json"), { schema_version: 1, data_release: "active-1", sources: [{ id: "active", publisher: "Active", official_source_url: "https://example.test", rights_evidence_url: "https://example.test/LICENSE", checked_at: "2026-07-19", publication_mode: "redistributable", content_intake: "approved", scopes: { raw_download: "approved" }, public_fields: [] }] });

  const license = "Synthetic MIT license\n";
  const licenseSha = sha(license);
  const source = {
    id: "safe-source", repository: "example/safe", commit: "a".repeat(40),
    license: { spdx: "MIT", name: "MIT License", basis: "repository-license-signal", files: [{ source_path: "LICENSE", staged_path: "staging/license-derived/raw-mibs/safe-source/licenses/LICENSE", pinned_url: `https://raw.githubusercontent.com/example/safe/${"a".repeat(40)}/LICENSE`, git_blob_oid: "b".repeat(40), sha256: licenseSha }] }, artifact_count: 7
  };
  await mkdir(path.join(data, "staging", "license-derived", "raw-mibs", "safe-source", "licenses"), { recursive: true });
  await writeFile(path.join(data, source.license.files[0].staged_path), license);

  const definitions = [
    { id: "good", module: "GOOD-MIB", dependencies: ["ACTIVE-MIB"] },
    { id: "conflict-a", module: "CONFLICT-MIB", dependencies: [], suffix: "-- variant a\n" },
    { id: "conflict-b", module: "CONFLICT-MIB", dependencies: [], suffix: "-- variant b\n" },
    { id: "exact-a", module: "EXACT-MIB", dependencies: [], rawOverride: "EXACT-MIB DEFINITIONS ::= BEGIN\nexact OBJECT IDENTIFIER ::= { 1 3 6 9 }\nEND\n" },
    { id: "exact-b", module: "EXACT-MIB", dependencies: [], rawOverride: "EXACT-MIB DEFINITIONS ::= BEGIN\nexact OBJECT IDENTIFIER ::= { 1 3 6 9 }\nEND\n" },
    { id: "missing", module: "MISSING-MIB", dependencies: ["ABSENT-MIB"] },
    { id: "dependent", module: "DEPENDENT-MIB", dependencies: ["MISSING-MIB"] },
    { id: "copyright", module: "COPYRIGHT-MIB", dependencies: [], prefix: "-- Copyright 2026 Example. All rights reserved. Example is a trademark.\n" },
    { id: "restricted", module: "RESTRICTED-MIB", dependencies: [], prefix: "-- No part of this material may be copied,\n-- distributed, or disclosed without written permission.\n" },
    { id: "confidential", module: "CONFIDENTIAL-MIB", dependencies: [], prefix: "-- This specification embodies confidential and proprietary\n-- intellectual property.\n" },
    { id: "notice-dependent", module: "NOTICE-DEPENDENT-MIB", dependencies: ["RESTRICTED-MIB"] },
    { id: "bad-license", module: "BAD-LICENSE-MIB", dependencies: [], badLicense: true },
    { id: "bad-name", module: "EXPECTED-MIB", declared: "OTHER-MIB", dependencies: [] }
  ];
  const artifacts = [];
  const discoveryCandidates = [];
  const analysisModules = [];
  const stagedObjects = [];
  const variantsByModule = new Map();
  for (const definition of definitions) {
    const declared = definition.declared ?? definition.module;
    const raw = definition.rawOverride ?? `${definition.prefix ?? ""}${declared} DEFINITIONS ::= BEGIN\n${definition.id.replaceAll("-", "")} OBJECT IDENTIFIER ::= { 1 3 6 ${definition.id.length} }\nEND\n${definition.suffix ?? ""}`;
    const artifactSha = sha(raw);
    const sourcePath = `mibs/${definition.id}.mib`;
    const artifactId = `safe-source:${sourcePath}`;
    const stagedPath = `staging/license-derived/raw-mibs/safe-source/files/${sourcePath}`;
    await mkdir(path.dirname(path.join(data, stagedPath)), { recursive: true });
    await writeFile(path.join(data, stagedPath), raw);
    const artifact = {
      id: artifactId, source_id: "safe-source", module: definition.module, source_path: sourcePath, staged_path: stagedPath,
      pinned_url: `https://raw.githubusercontent.com/example/safe/${source.commit}/${sourcePath}`, source_revision: source.commit,
      git_blob_oid: sha(raw).slice(0, 40), bytes: Buffer.byteLength(raw), source_sha256: artifactSha, artifact_sha256: artifactSha,
      license_spdx: "MIT", license_basis: definition.badLicense ? "unknown" : "repository-license-signal", publication_mode: "redistributable",
      activation_state: "staged", intake_validation: "module-declaration-only", parser_status: "not-run", active_module_collision: false
    };
    artifacts.push(artifact);
    discoveryCandidates.push({ id: artifactId, source_id: "safe-source", repository: source.repository, source_type: "mib-file", path: sourcePath, git_blob_oid: artifact.git_blob_oid, bytes: artifact.bytes, pinned_url: artifact.pinned_url, repository_license_spdx: "MIT", repository_license_status: "license-derived-approval", rights_review: "approved-by-repository-license-signal", publication_mode: "redistributable", content_intake: "not-fetched" });
    analysisModules.push({ module: definition.module, selected_artifact_id: artifactId, source_id: "safe-source", artifact_sha256: artifactSha, parser_method: "deterministic-static-smi-no-external-execution", parser_status: "static-pass", declared_object_count: 1, resolved_object_count: 1, unresolved_object_count: 0, textual_convention_count: 0, macro_count: 0, semantic_definition_count: 1, duplicate_symbol_count: 0, duplicate_symbols: [], dependency_count: definition.dependencies.length, missing_dependency_count: 0, dependencies: definition.dependencies.map((module) => ({ module, state: module === "ACTIVE-MIB" ? "active" : "selected-raw" })) });
    stagedObjects.push({ id: `${definition.module.toLowerCase()}--${definition.id}`, module: definition.module, symbol: definition.id, oid: `1.3.6.${definition.id.length}`, kind: "object-identifier", syntax: null, access: null, status: null, description: null, enums: {}, parent: null, oid_resolution: "source-absolute", source_id: "safe-source", source_artifact_id: artifactId, activation_state: "staged", parser_method: "deterministic-static-smi-no-external-execution" });
    const variants = variantsByModule.get(definition.module) ?? [];
    variants.push({ module: definition.module, format: "raw", source_id: "safe-source", artifact_id: artifactId, sha256: artifactSha, parser_status: "static-pass" });
    variantsByModule.set(definition.module, variants);
  }
  await json(path.join(data, "license-derived-intake.json"), { schema_version: 1, generated_at: GENERATED_AT, policy: "license-signal", activation_state: "staged", parser_gate: "open", active_data_release_at_generation: "active-1", counts: {}, sources: [source], artifacts });
  await json(path.join(data, "source-discovery.json"), { schema_version: 1, generated_at: GENERATED_AT, policy: "fail-closed", counts: {}, sources: [{ id: "safe-source", provider: "github", repository: source.repository, homepage: "https://example.test", source_roles: ["mib-corpus"], default_branch: "main", commit: source.commit, commit_url: `https://github.com/${source.repository}/commit/${source.commit}`, tree_complete: true, repository_license: { status: "license-derived-approval", spdx: "MIT", name: "MIT License", api_url: source.license.files[0].pinned_url, files: [], caveat: "synthetic" }, minimum_candidate_count: 1, candidate_count: definitions.length }], candidates: discoveryCandidates });
  await json(path.join(data, "corpus-expansion-candidates.json"), { schema_version: 1, generated_at: GENERATED_AT, baseline_data_release: "active-1", activation_state: "candidate-not-active", target_unique_module_count: 550, counts: {}, target_met_in_candidate_set: false, manifest_sha256: "0".repeat(64), modules: [...variantsByModule].map(([module, variants]) => { const distinct = new Set(variants.map((variant) => variant.sha256)).size; return { module, activation_state: "candidate", selected_artifact_id: variants[0].artifact_id, selected_format: "raw", selected_source_id: "safe-source", selected_sha256: variants[0].sha256, selection_policy: "synthetic", variant_count: variants.length, distinct_content_count: distinct, conflict_state: variants.length === 1 ? "single" : distinct === 1 ? "exact-duplicate" : "content-variants", variants }; }) });
  await json(path.join(data, "raw-mib-analysis.json"), { schema_version: 1, generated_at: GENERATED_AT, activation_state: "staging-analysis-only", baseline_data_release: "active-1", parser_gate: "open", parser_security: {}, counts: {}, manifest_sha256: "0".repeat(64), modules: analysisModules });
  await writeFile(path.join(data, "raw-mib-objects-staging.json.gz"), gzipSync(`${JSON.stringify({ schema_version: 1, activation_state: "staged", objects: stagedObjects })}\n`, { mtime: 0 }));
  return root;
}

async function treeSnapshot(root) {
  async function walk(directory) {
    const rows = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) rows.push(...await walk(absolute));
      else rows.push([path.relative(root, absolute), sha(await readFile(absolute))]);
    }
    return rows;
  }
  return (await walk(root)).sort(([left], [right]) => left.localeCompare(right));
}

test("release candidate gates fail closed and dependency rejection cascades", async () => {
  const input = await fixture();
  const output = await mkdtemp(path.join(tmpdir(), "mibvendor-release-parent-"));
  const candidate = path.join(output, "candidate");
  const { report } = await buildReleaseCandidate(input, candidate, { releaseId: RELEASE, generatedAt: GENERATED_AT, minimumModules: 550 });
  assert.deepEqual(report.selected.map((row) => row.module), ["CONFLICT-MIB", "COPYRIGHT-MIB", "EXACT-MIB", "GOOD-MIB"]);
  assert.equal(report.counts.active_modules_preserved, 1);
  assert.equal(report.counts.final_modules, 5);
  assert.equal(report.readiness.target_met, false);
  assert.equal(report.readiness.module_gap, 545);
  assert.equal(report.readiness.stable_object_ids_unique, true);
  assert.equal(report.readiness.restrictive_notice_conflicts_absent, true);
  assert.equal(report.counts.blocking_preserved_artifact_notice_conflicts, 0);
  assert.deepEqual(report.object_id_collisions, []);
  const reasons = new Map(report.rejected.map((row) => [row.artifact_id, row]));
  assert.ok(reasons.get("safe-source:mibs/bad-license.mib").reasons.includes("artifact-publication-policy-not-approved"));
  assert.ok(reasons.get("safe-source:mibs/bad-name.mib").reasons.includes("module-declaration-mismatch"));
  assert.deepEqual(reasons.get("safe-source:mibs/missing.mib").missing_dependencies, ["ABSENT-MIB"]);
  assert.deepEqual(reasons.get("safe-source:mibs/dependent.mib").missing_dependencies, ["MISSING-MIB"]);
  assert.deepEqual(reasons.get("safe-source:mibs/notice-dependent.mib").missing_dependencies, ["RESTRICTED-MIB"]);
  const restricted = reasons.get("safe-source:mibs/restricted.mib");
  assert.equal(restricted.stage, "artifact-notice-gate");
  assert.ok(restricted.reasons.includes("artifact-restrictive-notice-conflict"));
  assert.deepEqual(restricted.restrictive_notice_conflicts, [{
    rule_id: "no-part-copy-use-or-distribution",
    category: "prohibited-use-or-redistribution",
    line_start: 1,
    line_end: 2,
    excerpt_sha256: sha("-- No part of this material may be copied,\n-- distributed, or disclosed without written permission.")
  }]);
  const confidential = reasons.get("safe-source:mibs/confidential.mib");
  assert.equal(confidential.stage, "artifact-notice-gate");
  assert.deepEqual(confidential.restrictive_notice_conflicts, [{
    rule_id: "confidential-proprietary-claim",
    category: "confidentiality",
    line_start: 1,
    line_end: 2,
    excerpt_sha256: sha("-- This specification embodies confidential and proprietary\n-- intellectual property.")
  }]);
  const conflictReview = report.variant_reviews.find((row) => row.module === "CONFLICT-MIB");
  assert.equal(conflictReview.conflict_state, "content-variants");
  assert.equal(conflictReview.variants.find((variant) => variant.artifact_id.endsWith("conflict-a.mib")).state, "promoted");
  assert.equal(conflictReview.variants.find((variant) => variant.artifact_id.endsWith("conflict-b.mib")).state, "non-active-alternate");
  const exactReview = report.variant_reviews.find((row) => row.module === "EXACT-MIB");
  assert.equal(exactReview.variants.filter((variant) => variant.state === "promoted").length, 1);
  assert.equal(exactReview.variants.filter((variant) => variant.state === "non-active-alternate").length, 1);
  const catalog = JSON.parse(await readFile(path.join(candidate, "data", "mib-catalog.json"), "utf8"));
  const conflictModule = catalog.modules.find((module) => module.id === "CONFLICT-MIB");
  assert.equal(conflictModule.variant_selection.conflict_state, "content-variants");
  assert.equal(conflictModule.artifact_sha256, report.selected.find((row) => row.module === "CONFLICT-MIB").artifact_sha256);
  assert.equal(conflictModule.license.basis, "repository-license-signal");
  assert.ok(conflictModule.activation_basis);
  const objects = JSON.parse(await readFile(path.join(candidate, "data", "mib-objects.json"), "utf8"));
  const promoted = objects.objects.find((object) => object.module === "CONFLICT-MIB");
  assert.equal(promoted.symbol, "conflict-a");
  for (const redundant of ["source_id", "source_artifact_id", "activation_state", "parser_method", "provenance"]) assert.equal(Object.hasOwn(promoted, redundant), false);
});

test("notice scanner ignores standalone copyright, rights-reserved, and trademark lines", () => {
  const text = "-- Copyright 2026 Example Corporation.\n-- All rights reserved. Example is a trademark.\nSAFE-MIB DEFINITIONS ::= BEGIN\nEND\n";
  assert.deepEqual(scanArtifactRestrictiveNotices(text), []);
});

test("a restrictive notice in a preserved artifact is disclosed and blocks activation", async () => {
  const input = await fixture();
  const data = path.join(input, "data");
  const rawPath = path.join(data, "mibs", "redistributable", "active", "ACTIVE-MIB.mib");
  const raw = "-- For internal use only\nACTIVE-MIB DEFINITIONS ::= BEGIN\nactive OBJECT IDENTIFIER ::= { 1 3 }\nEND\n";
  await writeFile(rawPath, raw);
  const catalogPath = path.join(data, "mib-catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog.modules[0].source_sha256 = sha(raw);
  catalog.modules[0].artifact_sha256 = sha(raw);
  await json(catalogPath, catalog);

  const parent = await mkdtemp(path.join(tmpdir(), "mibvendor-preserved-notice-parent-"));
  const output = path.join(parent, "candidate");
  const { report, verification } = await buildReleaseCandidate(input, output, { releaseId: RELEASE, generatedAt: GENERATED_AT });
  assert.equal(verification.ok, true);
  assert.equal(report.readiness.restrictive_notice_conflicts_absent, false);
  assert.equal(report.readiness.activation_ready, false);
  assert.equal(report.counts.blocking_preserved_artifact_notice_conflicts, 1);
  assert.deepEqual(report.artifact_notice_gate.blocking_preserved_artifacts[0].restrictive_notice_conflicts, [{
    rule_id: "restricted-audience-only",
    category: "restricted-audience",
    line_start: 1,
    line_end: 1,
    excerpt_sha256: sha("-- For internal use only")
  }]);

  const reportPath = path.join(output, "data", "corpus-release-report.json");
  const tampered = JSON.parse(await readFile(reportPath, "utf8"));
  tampered.artifact_notice_gate.blocking_preserved_artifacts[0].restrictive_notice_conflicts[0].excerpt_sha256 = "0".repeat(64);
  await json(reportPath, tampered);
  const tamperedVerification = await verifyReleaseCandidate(output);
  assert.equal(tamperedVerification.ok, false);
  assert.ok(tamperedVerification.failures.includes("restrictive artifact-notice conflict disclosure mismatch"));
});

test("a failing manifest-selected variant never falls back to a passing alternate", async () => {
  const input = await fixture();
  const analysisPath = path.join(input, "data", "raw-mib-analysis.json");
  const analysis = JSON.parse(await readFile(analysisPath, "utf8"));
  analysis.modules.find((module) => module.selected_artifact_id.endsWith("conflict-a.mib")).parser_status = "static-partial";
  await json(analysisPath, analysis);
  const parent = await mkdtemp(path.join(tmpdir(), "mibvendor-no-fallback-parent-"));
  const { report } = await buildReleaseCandidate(input, path.join(parent, "candidate"), { releaseId: RELEASE, generatedAt: GENERATED_AT });
  assert.equal(report.selected.some((row) => row.module === "CONFLICT-MIB"), false);
  const review = report.variant_reviews.find((row) => row.module === "CONFLICT-MIB");
  assert.equal(review.variants.find((variant) => variant.artifact_id.endsWith("conflict-a.mib")).state, "selected-not-promoted");
  assert.equal(review.variants.find((variant) => variant.artifact_id.endsWith("conflict-b.mib")).state, "non-active-alternate");
  assert.ok(report.rejected.find((row) => row.artifact_id.endsWith("conflict-a.mib")).reasons.includes("parser-not-static-pass"));
});

test("case-folded public object-id collisions reject the whole module before dependency closure", async () => {
  const input = await fixture();
  const data = path.join(input, "data");
  const stagedPath = path.join(data, "raw-mib-objects-staging.json.gz");
  const staged = JSON.parse(gunzipSync(await readFile(stagedPath)).toString("utf8"));
  const good = staged.objects.find((object) => object.module === "GOOD-MIB");
  staged.objects.push({ ...good, id: "good-mib--GOOD", symbol: "GOOD", oid: "1.3.6.999" });
  await writeFile(stagedPath, gzipSync(`${JSON.stringify(staged)}\n`, { mtime: 0 }));

  const analysisPath = path.join(data, "raw-mib-analysis.json");
  const analysis = JSON.parse(await readFile(analysisPath, "utf8"));
  const goodAnalysis = analysis.modules.find((module) => module.module === "GOOD-MIB");
  goodAnalysis.declared_object_count = 2;
  goodAnalysis.resolved_object_count = 2;
  const missingAnalysis = analysis.modules.find((module) => module.module === "MISSING-MIB");
  missingAnalysis.dependencies = [{ module: "GOOD-MIB", state: "selected-raw" }];
  await json(analysisPath, analysis);

  const parent = await mkdtemp(path.join(tmpdir(), "mibvendor-id-collision-parent-"));
  const { report } = await buildReleaseCandidate(input, path.join(parent, "candidate"), { releaseId: RELEASE, generatedAt: GENERATED_AT });
  assert.equal(report.selected.some((row) => ["GOOD-MIB", "MISSING-MIB", "DEPENDENT-MIB"].includes(row.module)), false);
  const rejectedGood = report.rejected.find((row) => row.module === "GOOD-MIB");
  assert.equal(rejectedGood.stage, "object-identity-gate");
  assert.ok(rejectedGood.reasons.includes("duplicate-case-folded-public-object-id"));
  assert.deepEqual(rejectedGood.public_object_id_collisions, [{
    id: "good-mib--good",
    module: "GOOD-MIB",
    symbols: ["good", "GOOD"],
    oids: ["1.3.6.4", "1.3.6.999"]
  }]);
  assert.deepEqual(report.rejected.find((row) => row.module === "MISSING-MIB").missing_dependencies, ["GOOD-MIB"]);
  assert.deepEqual(report.rejected.find((row) => row.module === "DEPENDENT-MIB").missing_dependencies, ["MISSING-MIB"]);
});

test("legacy active reserved grammar-keyword pseudo-objects are excluded and counts are corrected", async () => {
  const input = await fixture();
  const data = path.join(input, "data");
  const objectsPath = path.join(data, "mib-objects.json");
  const objects = JSON.parse(await readFile(objectsPath, "utf8"));
  objects.objects.push({ ...objects.objects[0], id: "active-mib--syntax", symbol: "SYNTAX", oid: "1.3.1" });
  await json(objectsPath, objects);
  const catalogPath = path.join(data, "mib-catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog.modules[0].resolved_oid_count = 2;
  catalog.counts.resolved_objects = 2;
  await json(catalogPath, catalog);

  const parent = await mkdtemp(path.join(tmpdir(), "mibvendor-reserved-correction-parent-"));
  const output = path.join(parent, "candidate");
  const { report, verification } = await buildReleaseCandidate(input, output, { releaseId: RELEASE, generatedAt: GENERATED_AT });
  assert.equal(verification.ok, true);
  assert.equal(report.counts.active_reserved_symbol_rows_excluded, 1);
  assert.deepEqual(report.corrections.active_module_resolved_count_adjustments, [{
    module: "ACTIVE-MIB",
    before_resolved_oid_count: 2,
    excluded_rows: 1,
    after_resolved_oid_count: 1
  }]);
  const candidateObjects = JSON.parse(await readFile(path.join(output, "data", "mib-objects.json"), "utf8"));
  const candidateCatalog = JSON.parse(await readFile(path.join(output, "data", "mib-catalog.json"), "utf8"));
  assert.equal(candidateObjects.objects.some((object) => object.symbol === "SYNTAX"), false);
  assert.equal(candidateCatalog.modules.find((module) => module.id === "ACTIVE-MIB").resolved_oid_count, 1);

  const reportPath = path.join(output, "data", "corpus-release-report.json");
  const tamperedReport = JSON.parse(await readFile(reportPath, "utf8"));
  tamperedReport.corrections.active_module_resolved_count_adjustments[0].excluded_rows = 2;
  await json(reportPath, tamperedReport);
  const tamperedVerification = await verifyReleaseCandidate(output);
  assert.equal(tamperedVerification.ok, false);
  assert.ok(tamperedVerification.failures.includes("active module correction mismatch: ACTIVE-MIB"));
});

test("same inputs and explicit timestamp produce byte-identical candidate trees", async () => {
  const input = await fixture();
  const parent = await mkdtemp(path.join(tmpdir(), "mibvendor-repro-parent-"));
  const first = path.join(parent, "first");
  const second = path.join(parent, "second");
  await buildReleaseCandidate(input, first, { releaseId: RELEASE, generatedAt: GENERATED_AT });
  await buildReleaseCandidate(input, second, { releaseId: RELEASE, generatedAt: GENERATED_AT });
  assert.deepEqual(await treeSnapshot(first), await treeSnapshot(second));
});

test("candidate verifier detects post-build tampering", async () => {
  const input = await fixture();
  const parent = await mkdtemp(path.join(tmpdir(), "mibvendor-tamper-parent-"));
  const output = path.join(parent, "candidate");
  await buildReleaseCandidate(input, output, { releaseId: RELEASE, generatedAt: GENERATED_AT });
  await writeFile(path.join(output, "data", "mibs", "redistributable", "license-derived", "safe-source", "files", "mibs", "good.mib"), "tampered\n");
  const verification = await verifyReleaseCandidate(output);
  assert.equal(verification.ok, false);
  assert.ok(verification.failures.some((failure) => failure.includes("raw checksum mismatch: GOOD-MIB")));
});

test("candidate verifier requires every object to resolve to one manifest module", async () => {
  const input = await fixture();
  const parent = await mkdtemp(path.join(tmpdir(), "mibvendor-object-module-parent-"));
  const output = path.join(parent, "candidate");
  await buildReleaseCandidate(input, output, { releaseId: RELEASE, generatedAt: GENERATED_AT });
  const objectPath = path.join(output, "data", "mib-objects.json");
  const reportPath = path.join(output, "data", "corpus-release-report.json");
  const objects = JSON.parse(await readFile(objectPath, "utf8"));
  objects.objects.find((object) => object.module === "GOOD-MIB").module = "ABSENT-MIB";
  const objectBytes = `${JSON.stringify(objects, null, 2)}\n`;
  await writeFile(objectPath, objectBytes);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  report.files["data/mib-objects.json"] = sha(objectBytes);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const verification = await verifyReleaseCandidate(output);
  assert.equal(verification.ok, false);
  assert.ok(verification.failures.some((failure) => failure.includes("object does not resolve to exactly one manifest module")));
});

test("a mismatched staged license rejects every artifact from that source", async () => {
  const input = await fixture();
  await writeFile(path.join(input, "data", "staging", "license-derived", "raw-mibs", "safe-source", "licenses", "LICENSE"), "changed license\n");
  const parent = await mkdtemp(path.join(tmpdir(), "mibvendor-license-parent-"));
  const { report } = await buildReleaseCandidate(input, path.join(parent, "candidate"), { releaseId: RELEASE, generatedAt: GENERATED_AT });
  assert.equal(report.counts.promoted_modules, 0);
  assert.ok(report.rejected.every((row) => row.reasons.includes("license-checksum-mismatch") || row.reasons.includes("active-variant-preserved")));
});
