import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateLicenseDerivedIntake } from "../scripts/validate-license-derived-intake.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const discovery = JSON.parse(await readFile(path.join(root, "data", "source-discovery.json"), "utf8"));
const activeCatalog = JSON.parse(await readFile(path.join(root, "data", "mib-catalog.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "data", "license-derived-intake.json"), "utf8"));

test("license-derived MIB intake is complete, pinned, and staged", async () => {
  assert.deepEqual(await validateLicenseDerivedIntake(root, discovery, activeCatalog, manifest), []);
  assert.equal(manifest.schema_version, 2);
  assert.ok(manifest.counts.artifacts >= 1_200);
  assert.equal(manifest.counts.retained_artifacts + manifest.counts.restrictive_notice_quarantined, manifest.counts.artifacts);
  assert.equal(
    manifest.counts.collision_free_candidates
      + manifest.counts.active_module_collisions
      + manifest.counts.module_declaration_missing
      + manifest.counts.restrictive_notice_quarantined,
    manifest.counts.artifacts
  );
  assert.ok(manifest.counts.collision_free_candidates > 0);
  assert.ok(manifest.counts.active_module_collisions > 0);
  assert.ok(manifest.counts.restrictive_notice_quarantined > 0);
  assert.equal(manifest.activation_state, "staged-not-active");
  assert.equal(manifest.parser_gate, "open");
  assert.equal(manifest.active_data_release_at_generation, activeCatalog.data_release);
  assert.ok(manifest.sources.every((source) => source.license.spdx !== "NOASSERTION"));
});

test("staging traversal, activation, and unapproved candidates fail closed", async () => {
  const mutated = structuredClone(manifest);
  const retained = mutated.artifacts.find((artifact) => artifact.retention_state === "retained");
  mutated.activation_state = "active";
  mutated.parser_gate = "passed";
  retained.staged_path = "../outside.mib";
  mutated.artifacts.find((artifact) => artifact !== retained).id = discovery.candidates.find((candidate) => candidate.publication_mode === "quarantine").id;
  const failures = await validateLicenseDerivedIntake(root, discovery, activeCatalog, mutated);
  assert.ok(failures.includes("License-derived intake escaped staging"));
  assert.ok(failures.includes("License-derived intake parser gate was over-promoted"));
  assert.ok(failures.some((failure) => failure.includes("Unsafe staged artifact path")));
  assert.ok(failures.some((failure) => failure.includes("Ineligible intake artifact")));
  assert.ok(failures.includes("Eligible MIB intake coverage drifted"));
});

test("production image excludes license-derived staging", async () => {
  const dockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /data\/mibs\/redistributable\//);
  assert.doesNotMatch(dockerfile, /data\/staging/);
  assert.doesNotMatch(dockerfile, /data\/mibs\/\.\/data\/mibs/);
});

test("an unmanifested staging file fails validation", async () => {
  const mutated = structuredClone(manifest);
  const removedIndex = mutated.artifacts.findIndex((artifact) => artifact.retention_state === "retained" && artifact.module !== null && artifact.active_module_collision === false);
  mutated.artifacts.splice(removedIndex, 1);
  mutated.counts.artifacts -= 1;
  mutated.counts.retained_artifacts -= 1;
  mutated.counts.collision_free_candidates -= 1;
  const failures = await validateLicenseDerivedIntake(root, discovery, activeCatalog, mutated);
  assert.ok(failures.some((failure) => failure.includes("Unmanifested staged file")));
  assert.ok(failures.includes("Eligible MIB intake coverage drifted"));
});

test("case-only source paths remain distinct on case-insensitive filesystems", async () => {
  const caseGroups = new Map();
  for (const artifact of manifest.artifacts.filter((candidate) => candidate.retention_state === "retained")) {
    const key = `${artifact.source_id}:${artifact.source_path.normalize("NFD").toLowerCase()}`;
    caseGroups.set(key, [...(caseGroups.get(key) ?? []), artifact]);
  }
  const collisions = [...caseGroups.values()].filter((artifacts) => artifacts.length > 1);
  assert.ok(collisions.length > 0);
  for (const artifacts of collisions) {
    assert.equal(new Set(artifacts.map((artifact) => artifact.staged_path.normalize("NFD").toLowerCase())).size, artifacts.length);
  }
});

test("restrictive-notice artifacts retain evidence but no public raw bytes", async () => {
  const quarantined = manifest.artifacts.filter((artifact) => artifact.retention_state === "metadata-only-evidence");
  assert.equal(quarantined.length, manifest.counts.restrictive_notice_quarantined);
  for (const artifact of quarantined) {
    assert.equal(artifact.staged_path, null);
    assert.equal(artifact.publication_mode, "quarantine");
    assert.equal(artifact.activation_state, "quarantined-not-retained");
    assert.ok(artifact.restrictive_notice_conflicts.length > 0);
    await assert.rejects(readFile(path.join(root, "data", artifact.excluded_staged_path)));
  }
});

test("a quarantined record cannot point at retained public bytes", async () => {
  const mutated = structuredClone(manifest);
  const quarantined = mutated.artifacts.find((artifact) => artifact.retention_state === "metadata-only-evidence");
  const retained = mutated.artifacts.find((artifact) => artifact.retention_state === "retained");
  quarantined.excluded_staged_path = retained.staged_path;
  const failures = await validateLicenseDerivedIntake(root, discovery, activeCatalog, mutated);
  assert.ok(failures.some((failure) => failure.includes("Quarantined raw artifact was retained")));
  assert.ok(failures.some((failure) => failure.includes("Quarantined raw artifact exists")));
});
