import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DATA_RELEASE,
  MIB_MODULE_COUNT,
  findModule,
  findSource,
  listModules,
  rawModule,
  resolveObject
} from "../src/intelligence.mjs";

const catalog = JSON.parse(await readFile(new URL("../data/mib-catalog.json", import.meta.url), "utf8"));

test("license-signaled release manifest has its immutable published counts", () => {
  assert.equal(DATA_RELEASE, "license-signaled-2026-07-20.2");
  assert.equal(MIB_MODULE_COUNT, 702);
  assert.equal(catalog.counts.modules, 702);
  assert.equal(catalog.counts.publishers.IETF, 72);
  assert.equal(catalog.counts.publishers.IANA, 20);
  assert.equal(catalog.counts.publishers["Net-SNMP"], 18);
  assert.equal(catalog.counts.resolved_objects, 76606);
  assert.equal(catalog.counts.textual_conventions, 4138);
  assert.equal(catalog.counts.notifications, 1273);
  assert.equal(catalog.counts.stable_object_id_collisions, 0);
  assert.deepEqual(catalog.counts.publication_modes, {
    redistributable: 702,
    "metadata-only": 0,
    "directory-only": 20
  });
  assert.equal(catalog.source_snapshots.ietf_rfc_index.quarantined_rfcs.length, 14);
});

test("raw MIB bytes are served only from an approved manifest row", () => {
  const metadata = findModule("BFD-STD-MIB");
  const raw = rawModule("bfd-std-mib");
  assert.equal(metadata.publication_mode, "redistributable");
  assert.equal(metadata.raw_download, true);
  assert.equal(createHash("sha256").update(raw.bytes).digest("hex"), metadata.artifact_sha256);
  assert.match(raw.bytes.toString("utf8"), /^-- mibvendor redistribution notice/);
  assert.equal(rawModule("CISCO-PRODUCTS-MIB"), null);
});

test("directory-only vendor records expose no extracted MIB fields", () => {
  const source = findSource("cisco");
  assert.equal(source.publication_mode, "directory-only");
  assert.equal(source.content_intake, "quarantine");
  assert.deepEqual(source.public_fields, ["publisher", "official_source_url", "rights_state"]);
  for (const forbidden of ["module", "oid", "symbol", "syntax", "description", "checksum", "raw_file"]) {
    assert.equal(source.public_fields.includes(forbidden), false);
  }
});

test("license-signaled OID resolution separates object and instance suffix", () => {
  const result = resolveObject("1.3.6.1.2.1.222.1.1.1.0");
  assert.equal(result.status, "resolved");
  assert.equal(result.object.id, "bfd-std-mib--bfdadminstatus");
  assert.deepEqual(result.instance_suffix, [0]);
  assert.equal(result.object.provenance.publication_mode, "redistributable");
  assert.equal(result.object.provenance.raw_download, true);
});

test("module listing is bounded and deterministic", () => {
  const page = listModules({ query: "IANA", limit: 5, cursor: 0 });
  assert.ok(page.total >= 20);
  assert.equal(page.results.length, 5);
  assert.equal(page.next_cursor, 5);
  assert.ok(page.results.every((module) => module.raw_download));
});
