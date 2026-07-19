import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publicationControlEventDigest } from "../src/publication-controls.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseControls = JSON.parse(await readFile(path.join(root, "data/publication-controls.json"), "utf8"));
const linkedDataFiles = [
  "iana-private-enterprise-numbers.json",
  "mib-catalog.json",
  "mib-objects.json",
  "source-catalog.json"
];

function controlsWithDisabled({ sources = [], modules = [] } = {}) {
  const document = structuredClone(baseControls);
  let previous = document.events.at(-1).event_sha256;
  let timestamp = Date.parse(document.events.at(-1).occurred_at);
  for (const [targetType, targetIds] of [["source", sources], ["module", modules]]) {
    for (const targetId of targetIds) {
      timestamp += 60_000;
      const event = {
        sequence: document.events.length + 1,
        occurred_at: new Date(timestamp).toISOString().replace(".000Z", "Z"),
        action: "disable",
        target_type: targetType,
        target_id: targetId,
        reason: "Synthetic kill-switch isolation test.",
        evidence_url: null,
        supersedes_event_sha256: null,
        previous_event_sha256: previous,
        event_sha256: null
      };
      event.event_sha256 = publicationControlEventDigest(event);
      document.events.push(event);
      previous = event.event_sha256;
    }
  }
  document.disabled_sources = [...sources].sort();
  document.disabled_modules = [...modules].sort();
  document.updated_at = document.events.at(-1).occurred_at;
  return document;
}

async function runIsolated(t, disabled = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "mibvendor-kill-switch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const subdirectory of ["src", "prototype", "scripts", "data"]) {
    await mkdir(path.join(directory, subdirectory), { recursive: true });
  }
  for (const relativePath of [
    "src/intelligence.mjs",
    "src/publication-controls.mjs",
    "prototype/core.mjs",
    "prototype/data.mjs",
    "scripts/canonical-json.mjs"
  ]) {
    await copyFile(path.join(root, relativePath), path.join(directory, relativePath));
  }
  for (const filename of linkedDataFiles) {
    await symlink(path.join(root, "data", filename), path.join(directory, "data", filename));
  }
  await symlink(path.join(root, "data", "mibs"), path.join(directory, "data", "mibs"));
  await writeFile(
    path.join(directory, "data", "publication-controls.json"),
    `${JSON.stringify(controlsWithDisabled(disabled), null, 2)}\n`,
    "utf8"
  );

  const runner = `
    const intelligence = await import(process.env.MIBVENDOR_INTELLIGENCE_FIXTURE);
    const ifSearch = intelligence.searchObjects("interface status");
    const bfdDependencies = intelligence.moduleDependencies("BFD-STD-MIB");
    const sigScaleDependencies = intelligence.moduleDependencies("SIGSCALE-PRODUCTS-MIB");
    process.stdout.write(JSON.stringify({
      ifSearchIds: ifSearch.map((record) => record.id),
      ifObject: Boolean(intelligence.findObject("if-mib--ifoperstatus")),
      ifRaw: Boolean(intelligence.rawModule("IF-MIB")),
      ifDependencies: intelligence.moduleDependencies("IF-MIB"),
      bfdMissing: bfdDependencies?.missing ?? null,
      sigScaleRaw: Boolean(intelligence.rawModule("SIGSCALE-PRODUCTS-MIB")),
      sigScaleDependencies,
      netSnmpIdentity: intelligence.lookupSysObjectId("1.3.6.1.4.1.8072.3.2.16").status,
      sigScaleIdentity: intelligence.lookupSysObjectId("1.3.6.1.4.1.50386.1.1").status,
      sysObjectIdCount: intelligence.SYS_OBJECT_ID_COUNT,
      statisticsSysObjectIdCount: intelligence.PUBLIC_CORPUS_STATISTICS.identity.sys_object_id_mappings,
      supplementalRecords: intelligence.PUBLIC_CORPUS_STATISTICS.oid_nodes.supplemental_legacy_records
    }));
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", runner], {
    encoding: "utf8",
    env: {
      ...process.env,
      MIBVENDOR_INTELLIGENCE_FIXTURE: pathToFileURL(path.join(directory, "src/intelligence.mjs")).href
    },
    maxBuffer: 2 * 1024 * 1024
  });
  return JSON.parse(output);
}

function assertIfModuleHidden(result) {
  assert.equal(result.ifSearchIds.includes("if-mib--ifoperstatus"), false);
  assert.equal(result.ifObject, false);
  assert.equal(result.ifRaw, false);
  assert.equal(result.ifDependencies, null);
  assert.ok(result.bfdMissing.includes("IF-MIB"));
  assert.equal(result.supplementalRecords, 0);
}

test("no kill switch preserves current object, raw, dependency, and identity outputs", async (t) => {
  const result = await runIsolated(t);
  assert.ok(result.ifSearchIds.includes("if-mib--ifoperstatus"));
  assert.equal(result.ifObject, true);
  assert.equal(result.ifRaw, true);
  assert.equal(result.ifDependencies.status, "complete");
  assert.equal(result.bfdMissing.includes("IF-MIB"), false);
  assert.equal(result.netSnmpIdentity, "resolved");
  assert.equal(result.sigScaleIdentity, "resolved");
  assert.equal(result.sysObjectIdCount, 19);
  assert.equal(result.statisticsSysObjectIdCount, 19);
  assert.equal(result.supplementalRecords, 0);
});

test("source kill switches cover legacy objects, raw bytes, dependencies, and static identities", async (t) => {
  const result = await runIsolated(t, { sources: ["osnmpd-mibs", "net-snmp", "sigscale-mibs"] });
  assertIfModuleHidden(result);
  assert.equal(result.sigScaleRaw, false);
  assert.equal(result.sigScaleDependencies, null);
  assert.equal(result.netSnmpIdentity, "enterprise_only");
  assert.equal(result.sigScaleIdentity, "enterprise_only");
  assert.equal(result.sysObjectIdCount, 0);
  assert.equal(result.statisticsSysObjectIdCount, 0);
});

test("module kill switches cover legacy objects, dependency presence, and identity owner modules", async (t) => {
  const result = await runIsolated(t, { modules: ["IF-MIB", "NET-SNMP-TC", "SIGSCALE-PRODUCTS-MIB"] });
  assertIfModuleHidden(result);
  assert.equal(result.sigScaleRaw, false);
  assert.equal(result.sigScaleDependencies, null);
  assert.equal(result.netSnmpIdentity, "enterprise_only");
  assert.equal(result.sigScaleIdentity, "enterprise_only");
  assert.equal(result.sysObjectIdCount, 0);
  assert.equal(result.statisticsSysObjectIdCount, 0);
});

test("disabling a secondary identity evidence module invalidates only that mapping", async (t) => {
  const result = await runIsolated(t, { modules: ["SIGSCALE-SMI"] });
  assert.equal(result.ifObject, true);
  assert.equal(result.ifRaw, true);
  assert.equal(result.netSnmpIdentity, "resolved");
  assert.equal(result.sigScaleIdentity, "enterprise_only");
  assert.equal(result.sigScaleRaw, true);
  assert.equal(result.sigScaleDependencies.status, "partial");
  assert.ok(result.sigScaleDependencies.missing.includes("SIGSCALE-SMI"));
  assert.equal(result.sysObjectIdCount, 18);
  assert.equal(result.statisticsSysObjectIdCount, 18);
});
