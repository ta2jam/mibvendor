import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJsonSha256 } from "../scripts/canonical-json.mjs";
import {
  normalizeRackTablesModel,
  parseRackTablesKnownSwitches
} from "../scripts/update-project-identity-definitions.mjs";
import { validateProjectIdentityDefinitions } from "../scripts/validate-project-identity-definitions.mjs";

const [manifest, dataset] = await Promise.all([
  readFile(new URL("../data/device-identities/project-definitions-manifest.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/device-identities/project-definitions.json", import.meta.url), "utf8").then(JSON.parse)
]);

test("RackTables project definitions are pinned, deterministic, and raw-text free", async () => {
  assert.deepEqual(await validateProjectIdentityDefinitions(manifest, dataset), []);
  assert.equal(dataset.source_manifest_sha256, canonicalJsonSha256(manifest));
  assert.deepEqual(dataset.counts, {
    source_literal_entries: 304,
    unique_source_keys: 304,
    exact_oid_candidates: 303,
    exact_model_definitions: 270,
    quarantined_entries: 33,
    rejected_enterprise_roots: 1,
    enterprise_families: 24
  });
  assert.equal(JSON.stringify(dataset).includes("RJ-45/10/100/1000T"), false);
  assert.equal(dataset.rights_boundary.source_text_included, false);
  assert.equal(dataset.rights_boundary.raw_api_available, false);
  assert.equal(dataset.dataset_license.spdx, "GPL-2.0-only");
  assert.match(dataset.dataset_license.scope, /project-definitions\.json, data\/device-identities\/runtime-index\.json, and API responses/);
});

test("validator independently rejects an out-of-range OID arc", async () => {
  const unsafe = structuredClone(dataset);
  unsafe.definitions[0].sys_object_id = "1.3.6.1.4.1.9.4294967296";
  assert.ok((await validateProjectIdentityDefinitions(manifest, unsafe)).some((failure) => failure.includes("invalid exact sysObjectID")));
});

test("closed static parser accepts whitespace variants and rejects executable shapes", () => {
  const source = `<?php
$known_switches = array // key is system OID w/o "enterprises" prefix
(
\t'9.6.1.83.10.1' => array
\t(
\t\t'text' => 'SG 300-10: 8 ports',
\t),
\t'12356.101.1.3002'=> array
\t(
\t\t'text' => 'FG310B: 10 ports',
\t),
);
global $swtype_pcre;
`;
  assert.deepEqual(parseRackTablesKnownSwitches(source).map((entry) => entry.source_key), [
    "9.6.1.83.10.1", "12356.101.1.3002"
  ]);
  assert.throws(
    () => parseRackTablesKnownSwitches(source.replace("'9.6.1.83.10.1'", "$dynamic_oid")),
    /non-literal top-level key/
  );
  assert.throws(
    () => parseRackTablesKnownSwitches(source.replace("'SG 300-10: 8 ports'", "get_model_name()")),
    /expected one static text literal/
  );
  assert.throws(
    () => parseRackTablesKnownSwitches(source.replace("9.6.1.83.10.1", "9.6.1.4294967296.1")),
    /numeric OID arc is outside the supported range/
  );
});

test("normalizer strips summaries and quarantines labels without a closed boundary", () => {
  assert.deepEqual(normalizeRackTablesModel("SG 300-10: 8 RJ-45 ports"), { model: "SG 300-10", reason: null });
  assert.deepEqual(normalizeRackTablesModel("4500 26-port: 24 ports"), { model: "4500", reason: null });
  assert.deepEqual(normalizeRackTablesModel("HP A5800AF-48G Switch with 2 Processors (JG225A), 48 ports"), {
    model: "HP A5800AF-48G",
    reason: null
  });
  assert.deepEqual(normalizeRackTablesModel("PowerConnect M6220 blade cabinet switch"), {
    model: null,
    reason: "model-boundary-not-unambiguous"
  });
  for (const unsafe of [
    "Switch 001ba90ba752: 24 ports",
    "Switch 001b.a90b.a752: 24 ports",
    "Switch 00:1b:a9:0b:a7:52: 24 ports",
    "Switch ftp://private.example: 24 ports",
    "Switch www.private.example: 24 ports",
    "Switch api-key=abc: 24 ports",
    "Switch private key: 24 ports",
    "Switch SN:ABC123: 24 ports",
    "Switch hostname=core-1: 24 ports",
    "Switch contact=ops: 24 ports",
    "Switch location=dc-1: 24 ports"
  ]) assert.equal(normalizeRackTablesModel(unsafe).reason, "sensitive-or-non-model-value", unsafe);
});

test("required positive, overlap, conflict, whitespace, and root-review records are retained", () => {
  const definitionByOid = new Map(dataset.definitions.map((record) => [record.sys_object_id, record]));
  assert.equal(definitionByOid.get("1.3.6.1.4.1.9.6.1.83.10.1").model, "SG 300-10");
  assert.equal(definitionByOid.get("1.3.6.1.4.1.9.1.659").model, "WS-C4948-10GE");
  assert.equal(definitionByOid.has("1.3.6.1.4.1.9.1.1208"), false);
  assert.equal(definitionByOid.get("1.3.6.1.4.1.12356.101.1.3002").model, "FG310B");
  assert.equal(dataset.rejections[0].sys_object_id, "1.3.6.1.4.1.4413");
  assert.equal(dataset.rejections[0].reason, "enterprise-root-not-exact-device");
  const registryConflict = dataset.quarantine.find((record) => record.enterprise_number === 10977);
  assert.equal(registryConflict.reason, "registry-vendor-conflict");
  assert.equal(dataset.definitions.some((record) => record.enterprise_number === 10977), false);
  const blocked = new Map([
    ["1.3.6.1.4.1.9.1.1208", "cross-layer-model-conflict"],
    ["1.3.6.1.4.1.9.1.1257", "vendor-symbol-model-conflict"],
    ["1.3.6.1.4.1.11.2.3.7.11.145", "internal-dictionary-conflict"],
    ["1.3.6.1.4.1.11.2.3.7.11.146", "internal-dictionary-conflict"],
    ["1.3.6.1.4.1.11.2.3.7.11.150", "internal-dictionary-conflict"],
    ["1.3.6.1.4.1.10977.11825.11833.97.25451.12800.100.4.4", "registry-vendor-conflict"],
    ["1.3.6.1.4.1.25506.11.1.46", "internal-dictionary-conflict"],
    ["1.3.6.1.4.1.25506.11.1.100", "internal-dictionary-conflict"],
    ["1.3.6.1.4.1.25506.11.1.101", "internal-dictionary-conflict"],
    ["1.3.6.1.4.1.25506.11.1.181", "internal-dictionary-conflict"]
  ]);
  const quarantineByOid = new Map(dataset.quarantine.map((record) => [record.sys_object_id, record]));
  for (const [oid, reason] of blocked) {
    assert.equal(definitionByOid.has(oid), false, oid);
    assert.equal(quarantineByOid.get(oid)?.reason, reason, oid);
  }
});
