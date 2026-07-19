import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateCompiledMibIntake } from "../scripts/validate-compiled-mib-intake.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [discovery, active, manifest, objects] = await Promise.all([
  readFile(path.join(root, "data", "source-discovery.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "mib-catalog.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "compiled-mib-intake.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "compiled-mib-objects-staging.json"), "utf8").then(JSON.parse)
]);

test("compiled MIB intake statically extracts a large module and object set", async () => {
  assert.deepEqual(await validateCompiledMibIntake(root, discovery, active, manifest, objects), []);
  assert.ok(manifest.counts.artifacts >= 270);
  assert.ok(manifest.counts.objects >= 20_000);
  assert.equal(manifest.parser_security, "static-analysis-only-no-python-execution");
  assert.equal(manifest.activation_state, "staged-not-active");
});

test("compiled notification tuple suffixes are retained without executing Python", () => {
  const bySymbol = new Map(objects.objects.filter((object) => object.module === "RFC1382-MIB").map((object) => [object.symbol, object]));
  assert.equal(bySymbol.get("x25Restart")?.oid, "1.3.6.1.2.1.10.5.0.1");
  assert.equal(bySymbol.get("x25Reset")?.oid, "1.3.6.1.2.1.10.5.0.2");
});

test("compiled MIB execution and count claims fail closed", async () => {
  const mutated = structuredClone(manifest);
  mutated.parser_security = "execute-python";
  mutated.counts.objects -= 1;
  const failures = await validateCompiledMibIntake(root, discovery, active, mutated, objects);
  assert.ok(failures.includes("Compiled MIB parser security boundary drifted"));
  assert.ok(failures.includes("Compiled MIB top-level count drift"));
});
