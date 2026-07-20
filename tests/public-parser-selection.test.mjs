import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, "experiments/parser-bakeoff/scripts/select_public_parser.py");
const commit = "94e60809f3a01a8ba482ffc7319c8dc8a358fd30";
const publicAmd64 = path.join(root, "experiments/parser-bakeoff/results/2026-07-20-public-linux-amd64");
const publicArm64 = path.join(root, "experiments/parser-bakeoff/results/2026-07-20-public-linux-arm64");
const edgeAmd64 = path.join(root, "experiments/parser-bakeoff/results/2026-07-13-linux-amd64");
const edgeArm64 = path.join(root, "experiments/parser-bakeoff/results/2026-07-14-linux-arm64");
const committedSelection = path.join(root, "experiments/parser-bakeoff/results/2026-07-20-public-validation/parser-selection.json");

function select({ amd64 = publicAmd64, arm64 = publicArm64, output }) {
  return spawnSync("python3", [
    script,
    "--expected-source-commit", commit,
    "--output", output,
    amd64,
    arm64,
    edgeAmd64,
    edgeArm64,
  ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
}

async function weakenPysmi(directory) {
  const file = path.join(directory, "pysmi.json");
  const document = JSON.parse(await readFile(file, "utf8"));
  let changed = 0;
  for (const row of document.cases) {
    if (!row.success || changed === 5) continue;
    row.success = false;
    for (const run of row.runs) run.success = false;
    for (const feature of Object.keys(row.feature_checks)) row.feature_checks[feature] = false;
    changed += 1;
  }
  assert.equal(changed, 5);
  document.summary.parse_success = document.cases.filter((row) => row.success).length;
  const checks = document.cases.flatMap((row) => Object.values(row.feature_checks));
  document.summary.feature_checks_passed = checks.filter(Boolean).length;
  document.summary.feature_checks_total = checks.length;
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
}

test("native public and CC0 evidence select only PySMI 2.0.0", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "mibvendor-parser-selection-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(temporary, { recursive: true, force: true })));
  const output = path.join(temporary, "selection.json");
  const result = select({ output });
  assert.equal(result.status, 0, result.stderr);
  const [actual, expected] = await Promise.all([readFile(output), readFile(committedSelection)]);
  assert.deepEqual(actual, expected);
  const document = JSON.parse(actual);
  assert.equal(document.status, "passed");
  assert.equal(document.canonical_parser, "pysmi");
  assert.equal(document.canonical_parser_version, "2.0.0");
  assert.equal(document.candidates.pysmi.qualified, true);
  assert.equal(document.candidates.libsmi.qualified, false);
  assert.equal(document.candidates["net-snmp"].qualified, false);
  assert.equal(document.execution_contract.warm_shared_process_benchmark, "not-applicable-to-selected-contract");
});

test("selection fails closed when no candidate meets the public parse threshold", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "mibvendor-parser-selection-negative-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(temporary, { recursive: true, force: true })));
  const amd64 = path.join(temporary, "amd64");
  const arm64 = path.join(temporary, "arm64");
  await Promise.all([cp(publicAmd64, amd64, { recursive: true }), cp(publicArm64, arm64, { recursive: true })]);
  await Promise.all([weakenPysmi(amd64), weakenPysmi(arm64)]);
  const result = select({ amd64, arm64, output: path.join(temporary, "selection.json") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected exactly one qualifying parser, found \[\]/);
});
