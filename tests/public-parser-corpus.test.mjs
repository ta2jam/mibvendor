import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const validator = "experiments/parser-bakeoff/scripts/public_corpus_gate.py";
const canonicalManifest = "experiments/parser-bakeoff/public-corpus/manifest.json";

function validate(manifest = canonicalManifest) {
  return spawnSync("python3", [validator, "--manifest", manifest], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

async function mutatedManifest(testContext, mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), "mibvendor-public-corpus-"));
  testContext.after(() => rm(directory, { recursive: true, force: true }));
  const document = JSON.parse(await readFile(canonicalManifest, "utf8"));
  mutate(document);
  const manifest = path.join(directory, "manifest.json");
  await writeFile(manifest, `${JSON.stringify(document, null, 2)}\n`);
  return manifest;
}

test("the deterministic 100-file public parser corpus passes eligibility only", () => {
  const result = validate();
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.cases, 100);
  assert.equal(summary.unique_files, 100);
  assert.equal(summary.unique_content_hashes, 100);
  assert.equal(summary.eligibility_gate, "passed");
  assert.equal(summary.canonical_parser_gate, "open");
  assert.ok(summary.distinct_sources >= 8);
  assert.ok(summary.maximum_source_cases <= 30);
});

test("duplicate bytes cannot inflate the public 100-case gate", async (testContext) => {
  const manifest = await mutatedManifest(testContext, (document) => {
    document.cases[1].sha256 = document.cases[0].sha256;
  });
  const result = validate(manifest);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate case content/);
});

test("a public corpus manifest cannot claim parser results or canonical selection", async (testContext) => {
  const manifest = await mutatedManifest(testContext, (document) => {
    document.scope.parser_results = "passed";
    document.scope.canonical_parser_gate = "passed";
  });
  const result = validate(manifest);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /falsely claims parser results|falsely closes canonical parser selection/);
});

test("positive public fixtures cannot be relabeled as known parser successes", async (testContext) => {
  const manifest = await mutatedManifest(testContext, (document) => {
    document.cases[0].expected = "success";
  });
  const result = validate(manifest);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /overstates a parser expectation/);
});

test("corpus selection cannot drift from the deterministic catalog projection", async (testContext) => {
  const manifest = await mutatedManifest(testContext, (document) => {
    [document.cases[0], document.cases[1]] = [document.cases[1], document.cases[0]];
  });
  const result = validate(manifest);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /differs from deterministic catalog selection/);
});
