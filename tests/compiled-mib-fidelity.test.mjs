import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateCompiledMibFidelity } from "../scripts/validate-compiled-mib-fidelity.mjs";

const [candidates, fidelity] = await Promise.all([
  readFile(new URL("../data/corpus-expansion-candidates.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/compiled-mib-fidelity.json", import.meta.url), "utf8").then(JSON.parse)
]);

test("compiled fidelity compares cross-format modules and leaves unverified selections open", () => {
  assert.deepEqual(validateCompiledMibFidelity(candidates, fidelity), []);
  assert.ok(fidelity.counts.comparable_modules > 0);
  assert.ok(fidelity.counts.exact_oid_ratio > 0 && fidelity.counts.exact_oid_ratio <= 1);
  assert.ok(fidelity.counts.unverified_selected_compiled_modules > 0);
  assert.equal(fidelity.counts.unverified_selected_compiled_modules, fidelity.counts.selected_compiled_modules);
  assert.equal(fidelity.gate, "open");
});

test("compiled fidelity gate cannot be promoted by assertion", () => {
  const mutated = structuredClone(fidelity);
  mutated.gate = "passed";
  const failures = validateCompiledMibFidelity(candidates, mutated);
  assert.ok(failures.includes("Compiled MIB fidelity gate claim drifted"));
  assert.ok(failures.includes("Compiled MIB fidelity digest drifted"));
});
