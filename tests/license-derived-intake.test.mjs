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
  assert.equal(manifest.counts.artifacts, 24);
  assert.equal(manifest.counts.collision_free_candidates, 23);
  assert.equal(manifest.counts.active_module_collisions, 1);
  assert.equal(manifest.activation_state, "staged-not-active");
  assert.equal(manifest.parser_gate, "open");
  assert.equal(manifest.active_data_release_at_generation, activeCatalog.data_release);
  assert.ok(manifest.sources.every((source) => source.license.spdx !== "NOASSERTION"));
});

test("staging traversal, activation, and unapproved candidates fail closed", async () => {
  const mutated = structuredClone(manifest);
  mutated.activation_state = "active";
  mutated.parser_gate = "passed";
  mutated.artifacts[0].staged_path = "../outside.mib";
  mutated.artifacts[1].id = discovery.candidates.find((candidate) => candidate.publication_mode === "quarantine").id;
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
  mutated.artifacts.pop();
  mutated.counts.artifacts -= 1;
  mutated.counts.collision_free_candidates -= 1;
  const failures = await validateLicenseDerivedIntake(root, discovery, activeCatalog, mutated);
  assert.ok(failures.some((failure) => failure.includes("Unmanifested staged file")));
  assert.ok(failures.includes("Eligible MIB intake coverage drifted"));
});
