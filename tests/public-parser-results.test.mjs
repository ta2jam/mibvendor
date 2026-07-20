import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

const validator = "experiments/parser-bakeoff/scripts/validate_public_multiarch_results.py";
const manifestPath = "experiments/parser-bakeoff/public-corpus/manifest.json";
const versions = {
  pysmi: "2.0.0",
  libsmi: "0.5.0",
  "net-snmp": "5.9.4.pre2",
};
const sourceCommit = "1".repeat(40);
const observableFeatures = new Set([
  "augments",
  "imports",
  "notification-type",
  "revision",
  "table-index",
  "textual-convention",
  "trap-type-v1",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function oneMeasurement() {
  return {
    returncode: 0,
    timed_out: false,
    wall_seconds: 0,
    user_cpu_seconds: 0,
    system_cpu_seconds: 0,
    peak_child_rss_kib_so_far: 1024,
  };
}

function runMeasurement(candidate) {
  return candidate === "libsmi"
    ? { lint: oneMeasurement(), dump: oneMeasurement() }
    : oneMeasurement();
}

async function resultFixture(testContext) {
  const root = await mkdtemp(path.join(tmpdir(), "mibvendor-public-results-"));
  testContext.after(() => rm(root, { recursive: true, force: true }));
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const directories = {
    amd64: path.join(root, "amd64"),
    arm64: path.join(root, "arm64"),
  };
  await Promise.all(Object.values(directories).map((directory) => mkdir(directory)));
  for (const [architecture, directory] of Object.entries(directories)) {
    const machine = architecture === "amd64" ? "x86_64" : "aarch64";
    for (const [candidate, version] of Object.entries(versions)) {
      const cases = manifest.cases.map((item) => {
        const featureChecks = Object.fromEntries(
          item.features.filter((feature) => observableFeatures.has(feature)).map((feature) => [feature, true]),
        );
        return {
          id: item.id,
          module: item.module,
          success: true,
          timed_out: false,
          normalized_output_deterministic: true,
          normalized_sha256: "a".repeat(64),
          feature_checks: featureChecks,
          diagnostic_bytes: 0,
          diagnostic_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          runs: [
            { success: true, measurement: runMeasurement(candidate), normalized_sha256: "a".repeat(64) },
            { success: true, measurement: runMeasurement(candidate), normalized_sha256: "a".repeat(64) },
          ],
        };
      });
      const featureCheckTotal = cases.reduce(
        (total, item) => total + Object.keys(item.feature_checks).length,
        0,
      );
      const document = {
        schema_version: 1,
        candidate,
        version,
        execution_mode: "container",
        source_commit: sourceCommit,
        host: { platform: "Linux-6.8.0", machine, python: "3.12.11" },
        corpus: {
          id: manifest.corpus_id,
          sha256: manifest.corpus_sha256,
          manifest_sha256: sha256(manifestBytes),
          catalog_sha256: manifest.catalog_sha256,
          catalog_data_release: manifest.catalog_data_release,
          cases: 100,
          expectation: "observe",
        },
        summary: {
          cases: 100,
          parse_success: 100,
          timeout_cases: 0,
          normalized_deterministic_cases: 100,
          feature_checks_passed: featureCheckTotal,
          feature_checks_total: featureCheckTotal,
          total_measured_wall_seconds: 0,
          total_user_cpu_seconds: 0,
          total_system_cpu_seconds: 0,
          peak_child_rss_kib: 1024,
          installed_footprint_bytes: 1,
          container_image_bytes: 1,
        },
        cases,
      };
      await writeFile(path.join(directory, `${candidate}.json`), `${JSON.stringify(document, null, 2)}\n`);
    }
  }
  return directories;
}

function validate(directories) {
  return spawnSync(
    "python3",
    [validator, "--expected-source-commit", sourceCommit, directories.amd64, directories.arm64],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

test("complete Linux amd64 and arm64 evidence passes without closing parser selection", async (testContext) => {
  const directories = await resultFixture(testContext);
  const result = validate(directories);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.public_bakeoff_evidence_gate, "passed");
  assert.equal(summary.canonical_parser_gate, "open");
  assert.equal(summary.cases, 100);
  assert.equal(summary.candidates, 3);
});

test("two result folders cannot impersonate two architectures", async (testContext) => {
  const directories = await resultFixture(testContext);
  const file = path.join(directories.arm64, "pysmi.json");
  const document = JSON.parse(await readFile(file, "utf8"));
  document.host.machine = "x86_64";
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
  const result = validate(directories);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /machine is not aarch64/);
});

test("architecture-specific normalized output is rejected", async (testContext) => {
  const directories = await resultFixture(testContext);
  const file = path.join(directories.arm64, "libsmi.json");
  const document = JSON.parse(await readFile(file, "utf8"));
  document.cases[0].normalized_sha256 = "b".repeat(64);
  document.cases[0].runs = [
    { ...document.cases[0].runs[0], normalized_sha256: "b".repeat(64) },
    { ...document.cases[0].runs[1], normalized_sha256: "b".repeat(64) },
  ];
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
  const result = validate(directories);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /observed output differs across architectures/);
});

test("empty feature evidence cannot pass the public result gate", async (testContext) => {
  const directories = await resultFixture(testContext);
  const file = path.join(directories.amd64, "pysmi.json");
  const document = JSON.parse(await readFile(file, "utf8"));
  document.cases[0].feature_checks = {};
  document.summary.feature_checks_passed -= 1;
  document.summary.feature_checks_total -= 1;
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
  const result = validate(directories);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /feature checks are invalid/);
});

test("candidate results must bind the exact public manifest", async (testContext) => {
  const directories = await resultFixture(testContext);
  const file = path.join(directories.arm64, "net-snmp.json");
  const document = JSON.parse(await readFile(file, "utf8"));
  document.corpus.manifest_sha256 = "b".repeat(64);
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
  const result = validate(directories);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not bound to the active manifest/);
});

test("missing per-run measurements cannot pass the public result gate", async (testContext) => {
  const directories = await resultFixture(testContext);
  const file = path.join(directories.amd64, "pysmi.json");
  const document = JSON.parse(await readFile(file, "utf8"));
  delete document.cases[0].runs[0].measurement;
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
  const result = validate(directories);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /measurement shape drifted/);
});
