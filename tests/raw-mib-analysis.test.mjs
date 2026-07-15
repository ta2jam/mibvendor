import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { validateRawMibAnalysis } from "../scripts/validate-raw-mib-analysis.mjs";

const [candidates, intake, active, aliases, analysis, objects, types] = await Promise.all([
  readFile(new URL("../data/corpus-expansion-candidates.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/license-derived-intake.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/mib-catalog.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/mib-module-aliases.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/raw-mib-analysis.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/raw-mib-objects-staging.json.gz", import.meta.url)).then((bytes) => JSON.parse(gunzipSync(bytes))),
  readFile(new URL("../data/raw-mib-types-staging.json.gz", import.meta.url)).then((bytes) => JSON.parse(gunzipSync(bytes)))
]);

test("raw analysis covers every selected module and reports an open gate honestly", () => {
  assert.deepEqual(validateRawMibAnalysis(candidates, intake, active, aliases, analysis, objects, types), []);
  assert.equal(analysis.counts.modules, 252);
  assert.ok(analysis.counts.resolved_objects > 30_000);
  assert.ok(analysis.counts.unresolved_objects > 0);
  assert.equal(analysis.parser_gate, "open");
});

test("raw parser success cannot be claimed while partial modules remain", () => {
  const mutated = structuredClone(analysis);
  mutated.parser_gate = "passed";
  const failures = validateRawMibAnalysis(candidates, intake, active, aliases, mutated, objects, types);
  assert.ok(failures.includes("Raw MIB parser gate claim drifted"));
  assert.ok(failures.includes("Raw MIB analysis manifest digest drifted"));
});

test("dependency aliases remain evidence-bound and do not hide real missing modules", () => {
  assert.equal(analysis.counts.missing_dependency_edges, 6);
  const dns = analysis.modules.find((module) => module.module === "DNS-SERVER-MIB");
  assert.deepEqual(dns.dependencies.find((dependency) => dependency.module === "RFC-1213"), {
    module: "RFC-1213",
    state: "alias-selected-raw",
    resolved_as: "RFC1213-MIB"
  });
  const mutatedAliases = structuredClone(aliases);
  mutatedAliases.aliases[0].canonical_artifact_id = "missing:evidence";
  const failures = validateRawMibAnalysis(candidates, intake, active, mutatedAliases, analysis, objects, types);
  assert.ok(failures.includes("MIB module alias canonical evidence drifted RFC-1213"));
  assert.ok(failures.includes("MIB module alias artifact evidence missing RFC-1213"));
});
