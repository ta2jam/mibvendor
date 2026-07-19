import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateCorpusExpansionCandidates } from "../scripts/validate-corpus-expansion-candidates.mjs";

const [active, raw, compiled, candidates] = await Promise.all([
  readFile(new URL("../data/mib-catalog.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/license-derived-intake.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/compiled-mib-intake.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/corpus-expansion-candidates.json", import.meta.url), "utf8").then(JSON.parse)
]);

test("corpus expansion candidate set exceeds the unique module target without duplicate inflation", () => {
  assert.deepEqual(validateCorpusExpansionCandidates(active, raw, compiled, candidates), []);
  assert.ok(candidates.counts.unique_modules >= 550);
  assert.equal(candidates.counts.active_modules, active.counts.modules);
  assert.equal(candidates.counts.unique_modules, candidates.counts.active_modules + candidates.counts.candidate_modules);
  assert.equal(candidates.target_met_in_candidate_set, true);
  assert.ok(candidates.counts.variants > candidates.counts.unique_modules);
});

test("duplicate modules and manifest mutation cannot inflate the target", () => {
  const mutated = structuredClone(candidates);
  mutated.modules.push(structuredClone(mutated.modules[0]));
  mutated.counts.unique_modules += 1;
  const failures = validateCorpusExpansionCandidates(active, raw, compiled, mutated);
  assert.ok(failures.some((failure) => failure.includes("Duplicate corpus candidate module")));
  assert.ok(failures.includes("Corpus candidate manifest digest drifted"));
});
