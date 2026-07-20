import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  assert.equal(analysis.counts.modules, candidates.modules.filter((module) => module.selected_format === "raw").length);
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

test("an empty raw selection cannot vacuously pass the parser gate", () => {
  const emptyAnalysis = {
    ...structuredClone(analysis),
    parser_gate: "open",
    counts: Object.fromEntries(Object.keys(analysis.counts).map((key) => [key, 0])),
    manifest_sha256: null,
    modules: []
  };
  emptyAnalysis.manifest_sha256 = createHash("sha256").update(JSON.stringify({ ...emptyAnalysis, manifest_sha256: null })).digest("hex");
  const emptyObjects = { schema_version: 1, activation_state: "staged-not-active", objects: [] };
  const emptyTypes = { schema_version: 1, activation_state: "staged-not-active", definitions: [] };
  assert.deepEqual(validateRawMibAnalysis({ modules: [] }, { artifacts: [] }, active, { schema_version: 1, aliases: [] }, emptyAnalysis, emptyObjects, emptyTypes), []);

  const overclaimed = { ...emptyAnalysis, parser_gate: "passed", manifest_sha256: null };
  overclaimed.manifest_sha256 = createHash("sha256").update(JSON.stringify({ ...overclaimed, manifest_sha256: null })).digest("hex");
  assert.ok(validateRawMibAnalysis({ modules: [] }, { artifacts: [] }, active, { schema_version: 1, aliases: [] }, overclaimed, emptyObjects, emptyTypes)
    .includes("Raw MIB parser gate claim drifted"));
});

test("dependency aliases remain evidence-bound and do not hide real missing modules", () => {
  assert.ok(analysis.counts.missing_dependency_edges > 0);
  const dns = analysis.modules.find((module) => module.module === "DNS-SERVER-MIB");
  assert.deepEqual(dns.dependencies.find((dependency) => dependency.module === "RFC-1213"), {
    module: "RFC-1213",
    state: "alias-active",
    resolved_as: "RFC1213-MIB"
  });
  assert.equal(analysis.modules.find((module) => module.module === "CPQHLTH-MIB")?.dependencies.find((dependency) => dependency.module === "CPQHOST-MIB")?.state, "missing");
  const mutatedAliases = structuredClone(aliases);
  mutatedAliases.aliases[0].canonical_artifact_id = "missing:evidence";
  const failures = validateRawMibAnalysis(candidates, intake, active, mutatedAliases, analysis, objects, types);
  assert.ok(failures.includes("MIB module alias canonical evidence drifted RFC-1213"));
  assert.ok(failures.includes("MIB module alias artifact evidence missing RFC-1213"));
});

test("active alias targets retain an exact raw-artifact provenance chain", () => {
  const mutatedActive = structuredClone(active);
  mutatedActive.modules.find((module) => module.id === "RFC1213-MIB").activation_basis.source_artifact_id = "other:artifact";
  const activeFailures = validateRawMibAnalysis(candidates, intake, mutatedActive, aliases, analysis, objects, types);
  assert.ok(activeFailures.includes("MIB module alias canonical evidence drifted RFC-1213"));

  const mutatedCandidates = structuredClone(candidates);
  mutatedCandidates.modules.find((module) => module.module === "RFC-1212").selected_sha256 = "0".repeat(64);
  const candidateFailures = validateRawMibAnalysis(mutatedCandidates, intake, active, aliases, analysis, objects, types);
  assert.ok(candidateFailures.includes("MIB module alias canonical evidence drifted RFC1212"));
});
