import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const validator = "experiments/parser-bakeoff/scripts/validate_corpus_intake.py";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function validFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "mibvendor-corpus-"));
  const evidence = "APPROVED FOR TESTING\n";
  await writeFile(path.join(directory, "approval.txt"), evidence);
  const categories = [
    ...Array(20).fill("ietf-iana"),
    ...Array(20).fill("vendor-valid"),
    ...Array(20).fill("vendor-broken"),
    ...Array(20).fill("revision-pair"),
    ...Array(20).fill("collision-import"),
  ];
  const cases = [];
  for (const [index, category] of categories.entries()) {
    const number = String(index + 1).padStart(3, "0");
    const file = `case-${number}.mib`;
    const content = `TEST-CASE-${number} DEFINITIONS ::= BEGIN\nEND\n`;
    await writeFile(path.join(directory, file), content);
    cases.push({
      id: `case-${number}`,
      category,
      module: `TEST-CASE-${number}`,
      file,
      expected: category === "vendor-broken" ? "failure" : "success",
      source_id: category === "ietf-iana" ? "ietf-post-2008" : "cisco",
      source_url: `https://example.invalid/source/${number}`,
      acquired_at: "2026-07-14",
      sha256: digest(content),
      rights: {
        testing_status: "approved",
        evidence_ref: "approval.txt",
        evidence_sha256: digest(evidence),
        redistribution_status: "denied",
      },
      ...(category === "revision-pair"
        ? { comparison_group: `revision-${String(Math.floor((index - 60) / 2) + 1).padStart(2, "0")}` }
        : {}),
    });
  }
  const manifest = path.join(directory, "manifest.json");
  await writeFile(manifest, `${JSON.stringify({ schema_version: 1, corpus_id: "phase0.test", cases }, null, 2)}\n`);
  return { directory, manifest, cases };
}

async function fixtureFor(testContext) {
  const fixture = await validFixture();
  testContext.after(() => rm(fixture.directory, { recursive: true, force: true }));
  return fixture;
}

function validate(manifest, directory) {
  return spawnSync(
    "python3",
    [validator, manifest, "--corpus-dir", directory, "--evidence-dir", directory],
    {
    cwd: process.cwd(),
    encoding: "utf8",
    },
  );
}

test("a rights-approved balanced private corpus passes intake", async (testContext) => {
  const fixture = await fixtureFor(testContext);
  const result = validate(fixture.manifest, fixture.directory);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.cases, 100);
  assert.equal(summary.unique_files, 100);
  assert.equal(summary.rights_testing_scope, "approved");
  assert.equal(summary.unique_rights_evidence_files, 1);
});

test("duplicate content cannot inflate the 100-case gate", async (testContext) => {
  const fixture = await fixtureFor(testContext);
  fixture.cases[1].file = fixture.cases[0].file;
  fixture.cases[1].sha256 = fixture.cases[0].sha256;
  await writeFile(
    fixture.manifest,
    `${JSON.stringify({ schema_version: 1, corpus_id: "phase0.test", cases: fixture.cases }, null, 2)}\n`,
  );
  const result = validate(fixture.manifest, fixture.directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate case file/);
});

test("an unapproved testing scope is rejected", async (testContext) => {
  const fixture = await fixtureFor(testContext);
  fixture.cases[40].rights.testing_status = "unknown";
  await writeFile(
    fixture.manifest,
    `${JSON.stringify({ schema_version: 1, corpus_id: "phase0.test", cases: fixture.cases }, null, 2)}\n`,
  );
  const result = validate(fixture.manifest, fixture.directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no approved testing scope/);
});

test("a corpus file changed after approval is rejected", async (testContext) => {
  const fixture = await fixtureFor(testContext);
  await writeFile(path.join(fixture.directory, fixture.cases[0].file), "CHANGED\n");
  const result = validate(fixture.manifest, fixture.directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256 does not match its file/);
});

test("a path traversal cannot escape the private corpus root", async (testContext) => {
  const fixture = await fixtureFor(testContext);
  fixture.cases[0].file = "../outside.mib";
  await writeFile(
    fixture.manifest,
    `${JSON.stringify({ schema_version: 1, corpus_id: "phase0.test", cases: fixture.cases }, null, 2)}\n`,
  );
  const result = validate(fixture.manifest, fixture.directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /file escapes corpus root/);
});

test("a rights file changed after approval is rejected", async (testContext) => {
  const fixture = await fixtureFor(testContext);
  await writeFile(path.join(fixture.directory, "approval.txt"), "REVOKED\n");
  const result = validate(fixture.manifest, fixture.directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rights evidence SHA-256 does not match its file/);
});

test("category counts cannot be rebalanced on paper", async (testContext) => {
  const fixture = await fixtureFor(testContext);
  fixture.cases[99].category = "vendor-valid";
  await writeFile(
    fixture.manifest,
    `${JSON.stringify({ schema_version: 1, corpus_id: "phase0.test", cases: fixture.cases }, null, 2)}\n`,
  );
  const result = validate(fixture.manifest, fixture.directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /category counts/);
});
