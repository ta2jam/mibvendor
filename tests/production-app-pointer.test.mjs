import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readProductionReleaseAudit,
  snapshotImmutableReleaseTree,
  validateProductionReleaseAudit
} from "../scripts/lib/production-app-pointer.mjs";
import { derivePublicationControlState, publicationControlEventDigest } from "../src/publication-controls.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const commandPath = path.join(repositoryRoot, "scripts", "switch-production-app-pointer.mjs");
const GENERATED_AT = "2026-07-20T07:59:00.000Z";
const ACTIVATED_AT = "2026-07-20T08:00:00Z";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, bytes);
  return bytes;
}

function publicationEvent(sequence, action, targetId, previous, applicationVersion, occurredAt) {
  const value = {
    sequence,
    occurred_at: occurredAt,
    action,
    target_type: "release",
    target_id: targetId,
    reason: `${action} release-switch fixture`,
    evidence_url: action === "promotion"
      ? `https://example.invalid/releases/tag/v${applicationVersion}`
      : "https://example.invalid/release-switch-fixture",
    supersedes_event_sha256: null,
    previous_event_sha256: previous,
    event_sha256: null
  };
  value.event_sha256 = publicationControlEventDigest(value);
  return value;
}

function controls(events) {
  const state = derivePublicationControlState(events);
  return {
    schema_version: 1,
    active_data_release: state.activeRelease,
    updated_at: events.at(-1).occurred_at,
    disabled_sources: [...state.disabledSources].sort(),
    disabled_modules: [...state.disabledModules].sort(),
    events
  };
}

function fixtureServerSource(dataRelease, marker) {
  return `
    import { createServer } from "node:http";
    const dataRelease = ${JSON.stringify(dataRelease)};
    const marker = ${JSON.stringify(marker)};
    export function createFixtureServer() {
      return createServer((request, response) => {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        response.setHeader("content-type", "application/json; charset=utf-8");
        if (pathname === "/v1/data-release") {
          response.end(JSON.stringify({ data_release: dataRelease }));
          return;
        }
        const match = /^\\/v1\\/objects\\/(old|new)$/.exec(pathname);
        if (match && match[1] === marker) {
          response.end(JSON.stringify({ data_release: dataRelease, object: { id: marker } }));
          return;
        }
        response.statusCode = 404;
        response.end(JSON.stringify({ status: 404 }));
      });
    }
  `;
}

async function buildRelease(site, directoryRelease, applicationVersion, dataRelease, predecessorDataRelease, marker) {
  const releaseRoot = path.join(site, "releases", directoryRelease);
  const appRoot = path.join(releaseRoot, "app");
  const data = path.join(appRoot, "data");
  const evidenceDirectory = path.join(data, "releases", dataRelease);
  const moduleId = `${marker.toUpperCase()}-MIB`;
  const objectId = `${marker}-mib--root`;
  const sourceId = `${marker}-source`;
  const catalog = {
    schema_version: 1,
    data_release: dataRelease,
    policy: "fail-closed",
    counts: {
      modules: 1,
      resolved_objects: 1,
      textual_conventions: 0,
      notifications: 0,
      stable_object_id_collisions: 0,
      publishers: { Fixture: 1 },
      publication_modes: { redistributable: 1, "metadata-only": 0, "directory-only": 0 }
    },
    modules: [{ id: moduleId, source_id: sourceId, publisher: "Fixture", publication_mode: "redistributable" }]
  };
  const objects = {
    schema_version: 1,
    data_release: dataRelease,
    objects: [{ id: objectId, module: moduleId, symbol: "root", oid: marker === "old" ? "1.3.6.1" : "1.3.6.2" }]
  };
  const sources = {
    schema_version: 1,
    data_release: dataRelease,
    sources: [{ id: sourceId, publication_mode: "redistributable" }]
  };
  const baseline = publicationEvent(1, "baseline", predecessorDataRelease, null, applicationVersion, "2026-07-20T07:58:00Z");
  const promotion = publicationEvent(2, "promotion", dataRelease, baseline.event_sha256, applicationVersion, ACTIVATED_AT);
  const activationControls = controls([baseline, promotion]);

  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(path.join(appRoot, "VERSION"), `${applicationVersion}\n`);
  await writeFile(path.join(appRoot, "server.mjs"), fixtureServerSource(dataRelease, marker));
  await writeFile(path.join(appRoot, "compose.production.yaml"), "name: synthetic-release-switch\nservices: {}\n");
  const catalogBytes = await writeJson(path.join(data, "mib-catalog.json"), catalog);
  const objectBytes = await writeJson(path.join(data, "mib-objects.json"), objects);
  const sourceBytes = await writeJson(path.join(data, "source-catalog.json"), sources);
  const snapshotBytes = await writeJson(path.join(evidenceDirectory, "publication-controls-at-activation.json"), activationControls);
  const report = {
    schema_version: 1,
    release_id: dataRelease,
    generated_at: GENERATED_AT,
    baseline_data_release: predecessorDataRelease,
    activation_state: "candidate-not-active",
    policy: "fail-closed",
    counts: {
      active_modules_preserved: 0,
      promoted_modules: 1,
      final_modules: 1,
      promoted_objects: 1,
      final_objects: 1,
      textual_conventions: 0,
      notifications: 0,
      stable_object_id_collisions: 0,
      rejected_artifacts: 0
    },
    readiness: {
      minimum_modules: 1,
      final_module_count: 1,
      target_met: true,
      module_gap: 0,
      stable_object_ids_unique: true,
      activation_ready: true
    },
    selected: [{ module: moduleId, source_id: sourceId, resolved_objects: 1 }],
    rejected: [],
    object_id_collisions: [],
    files: {
      "data/mib-catalog.json": sha256(catalogBytes),
      "data/mib-objects.json": sha256(objectBytes),
      "data/source-catalog.json": sha256(sourceBytes)
    }
  };
  const reportBytes = await writeJson(path.join(evidenceDirectory, "corpus-release-report.json"), report);
  await writeJson(path.join(evidenceDirectory, "activation.json"), {
    schema_version: 1,
    data_release: dataRelease,
    predecessor_data_release: predecessorDataRelease,
    candidate_generated_at: GENERATED_AT,
    activated_at: ACTIVATED_AT,
    application_release: applicationVersion,
    candidate_report_sha256: sha256(reportBytes),
    documents: {
      mib_catalog_sha256: sha256(catalogBytes),
      mib_objects_sha256: sha256(objectBytes),
      source_catalog_sha256: sha256(sourceBytes),
      publication_controls_sha256: sha256(snapshotBytes)
    },
    publication_control_event_sha256: promotion.event_sha256,
    activation_basis: "Synthetic production release-switch fixture."
  });
  await writeJson(path.join(data, "publication-controls.json"), activationControls);
  return { releaseRoot, appRoot };
}

async function createSite() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "mibvendor-production-switch-"));
  const site = path.join(parent, "site");
  await mkdir(path.join(site, "releases"), { recursive: true });
  return { parent, site };
}

function commandArguments(site, action, from, to, occurredAt) {
  return [
    commandPath,
    "--site", site,
    "--action", action,
    "--from", from,
    "--to", to,
    "--occurred-at", occurredAt,
    "--reason", `Synthetic ${action} verification.`,
    "--evidence-url", "https://example.invalid/production-app-pointer"
  ];
}

function runCommand(site, action, from, to, occurredAt) {
  return spawnSync(process.execPath, commandArguments(site, action, from, to, occurredAt), { encoding: "utf8" });
}

function runCommandAsync(site, action, from, to, occurredAt) {
  const child = spawn(process.execPath, commandArguments(site, action, from, to, occurredAt), { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return {
    child,
    completed: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
    })
  };
}

function runRecovery(site, occurredAt, clearStaleLock = false) {
  const argumentsList = [
    commandPath,
    "--site", site,
    "--action", "recover",
    "--occurred-at", occurredAt
  ];
  if (clearStaleLock) argumentsList.push("--clear-stale-lock", "yes");
  return spawnSync(process.execPath, argumentsList, { encoding: "utf8" });
}

function probeRuntime(appPointer) {
  const runner = `
    const { once } = await import("node:events");
    const { pathToFileURL } = await import("node:url");
    const module = await import(pathToFileURL(process.env.APP_SERVER).href);
    const server = module.createFixtureServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = \`http://127.0.0.1:\${server.address().port}\`;
    async function request(route) {
      const response = await fetch(base + route);
      return { status: response.status, body: await response.json() };
    }
    try {
      process.stdout.write(JSON.stringify({
        release: await request("/v1/data-release"),
        old: await request("/v1/objects/old"),
        new: await request("/v1/objects/new")
      }));
    } finally {
      server.close();
      await once(server, "close");
    }
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", runner], {
    encoding: "utf8",
    env: { ...process.env, APP_SERVER: path.join(appPointer, "server.mjs") }
  }));
}

test("production command atomically activates and rolls back immutable runtime trees with an external append-only audit", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const oldRelease = await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  const newRelease = await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  await symlink("releases/v1.0.0/app", path.join(fixture.site, "app"), "dir");
  const oldBefore = await snapshotImmutableReleaseTree(oldRelease.releaseRoot);
  const newBefore = await snapshotImmutableReleaseTree(newRelease.releaseRoot);

  const activated = runCommand(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:10:00Z");
  assert.equal(activated.status, 0, activated.stderr);
  const activatedOutput = JSON.parse(activated.stdout);
  assert.equal(activatedOutput.scope, "filesystem-app-pointer-only");
  assert.equal(activatedOutput.active_target, "releases/v1.1.0/app");
  assert.equal(activatedOutput.running_container_changed, false);
  assert.equal(activatedOutput.traffic_changed, false);
  assert.equal(activatedOutput.container_restart_required, true);
  assert.equal(activatedOutput.release_env_update_required, true);
  assert.equal(await readlink(path.join(fixture.site, "app")), "releases/v1.1.0/app");
  const activeRuntime = probeRuntime(path.join(fixture.site, "app"));
  assert.equal(activeRuntime.release.body.data_release, "switch-new-1");
  assert.equal(activeRuntime.old.status, 404);
  assert.equal(activeRuntime.new.status, 200);

  const auditAfterActivation = await readProductionReleaseAudit(fixture.site);
  assert.equal(auditAfterActivation.events.length, 2);
  assert.deepEqual(auditAfterActivation.events.map((event) => [event.action, event.phase]), [
    ["activate", "prepared"],
    ["activate", "committed"]
  ]);
  assert.equal(validateProductionReleaseAudit(auditAfterActivation.events).active_release, "v1.1.0");
  const firstAuditEvent = path.join(fixture.site, "operations", "production-publication-audit", auditAfterActivation.files[0].name);
  await chmod(firstAuditEvent, 0o500);
  await assert.rejects(readProductionReleaseAudit(fixture.site), /permissions must be exactly 0400/);
  await chmod(firstAuditEvent, 0o400);
  assert.equal((await readProductionReleaseAudit(fixture.site)).events.length, 2);
  await assert.rejects(access(path.join(newRelease.releaseRoot, "production-publication-audit")));

  const noOpRecovery = runRecovery(fixture.site, "2026-07-20T08:10:30Z");
  assert.equal(noOpRecovery.status, 0, noOpRecovery.stderr);
  assert.deepEqual(JSON.parse(noOpRecovery.stdout), {
    scope: "filesystem-app-pointer-only",
    recovered: false,
    active_release: "v1.1.0",
    removed_temporaries: [],
    stale_lock_cleared: false,
    running_container_changed: false,
    traffic_changed: false,
    container_restart_required: false,
    release_env_update_required: false
  });

  const rolledBack = runCommand(fixture.site, "rollback", "v1.1.0", "v1.0.0", "2026-07-20T08:11:00Z");
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.equal(JSON.parse(rolledBack.stdout).active_target, "releases/v1.0.0/app");
  const rollbackRuntime = probeRuntime(path.join(fixture.site, "app"));
  assert.equal(rollbackRuntime.release.body.data_release, "switch-old-1");
  assert.equal(rollbackRuntime.old.status, 200);
  assert.equal(rollbackRuntime.new.status, 404);

  const auditAfterRollback = await readProductionReleaseAudit(fixture.site);
  assert.deepEqual(auditAfterRollback.files.slice(0, auditAfterActivation.files.length), auditAfterActivation.files);
  assert.deepEqual(auditAfterRollback.events.map((event) => [event.action, event.phase]), [
    ["activate", "prepared"],
    ["activate", "committed"],
    ["rollback", "prepared"],
    ["rollback", "committed"]
  ]);
  assert.equal(validateProductionReleaseAudit(auditAfterRollback.events).active_release, "v1.0.0");
  assert.deepEqual(await snapshotImmutableReleaseTree(oldRelease.releaseRoot), oldBefore);
  assert.deepEqual(await snapshotImmutableReleaseTree(newRelease.releaseRoot), newBefore);
});

test("explicit recovery closes a prepared audit from the atomic pointer state without mutating releases", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const oldRelease = await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  const newRelease = await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  await symlink("releases/v1.0.0/app", path.join(fixture.site, "app"), "dir");
  const oldBefore = await snapshotImmutableReleaseTree(oldRelease.releaseRoot);
  const newBefore = await snapshotImmutableReleaseTree(newRelease.releaseRoot);
  const activation = runCommand(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:14:00Z");
  assert.equal(activation.status, 0, activation.stderr);

  const committedAudit = await readProductionReleaseAudit(fixture.site);
  const auditDirectory = path.join(fixture.site, "operations", "production-publication-audit");
  await rm(path.join(auditDirectory, committedAudit.files[1].name));
  await writeFile(path.join(auditDirectory, ".next.interrupted-write"), "incomplete");
  await mkdir(path.join(fixture.site, "operations", ".release-switch.lock"), { mode: 0o700 });
  await assert.rejects(readProductionReleaseAudit(fixture.site), /interrupted append/);

  const refusedWithoutAcknowledgement = runRecovery(fixture.site, "2026-07-20T08:15:00Z");
  assert.equal(refusedWithoutAcknowledgement.status, 1);
  assert.match(refusedWithoutAcknowledgement.stderr, /release-switch-locked/);
  const recovered = runRecovery(fixture.site, "2026-07-20T08:15:00Z", true);
  assert.equal(recovered.status, 0, recovered.stderr);
  const recoveryOutput = JSON.parse(recovered.stdout);
  assert.equal(recoveryOutput.recovered, true);
  assert.equal(recoveryOutput.phase, "committed");
  assert.equal(recoveryOutput.active_release, "v1.1.0");
  assert.equal(recoveryOutput.running_container_changed, false);
  assert.equal(recoveryOutput.traffic_changed, false);
  assert.equal(recoveryOutput.stale_lock_cleared, true);
  assert.deepEqual(recoveryOutput.removed_temporaries, [".next.interrupted-write"]);
  const audit = await readProductionReleaseAudit(fixture.site);
  assert.deepEqual(audit.events.map((event) => event.phase), ["prepared", "committed"]);
  assert.equal(validateProductionReleaseAudit(audit.events).active_release, "v1.1.0");
  const runtime = probeRuntime(path.join(fixture.site, "app"));
  assert.equal(runtime.old.status, 404);
  assert.equal(runtime.new.status, 200);
  assert.deepEqual(await snapshotImmutableReleaseTree(oldRelease.releaseRoot), oldBefore);
  assert.deepEqual(await snapshotImmutableReleaseTree(newRelease.releaseRoot), newBefore);
});

test("aborted recovery reports that no container or release-env change is required", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  const pointer = path.join(fixture.site, "app");
  await symlink("releases/v1.0.0/app", pointer, "dir");
  const activation = runCommand(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:14:30Z");
  assert.equal(activation.status, 0, activation.stderr);
  const committedAudit = await readProductionReleaseAudit(fixture.site);
  await rm(path.join(fixture.site, "operations", "production-publication-audit", committedAudit.files[1].name));
  await rm(pointer);
  await symlink("releases/v1.0.0/app", pointer, "dir");

  const recovery = runRecovery(fixture.site, "2026-07-20T08:15:30Z");
  assert.equal(recovery.status, 0, recovery.stderr);
  const output = JSON.parse(recovery.stdout);
  assert.equal(output.phase, "aborted");
  assert.equal(output.active_release, "v1.0.0");
  assert.equal(output.running_container_changed, false);
  assert.equal(output.traffic_changed, false);
  assert.equal(output.container_restart_required, false);
  assert.equal(output.release_env_update_required, false);
  assert.deepEqual((await readProductionReleaseAudit(fixture.site)).events.map((event) => event.phase), ["prepared", "aborted"]);
});

test("target validation failure leaves the active pointer, audit, and both release trees unchanged", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const oldRelease = await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  const badRelease = await buildRelease(fixture.site, "v1.2.0", "1.2.1", "switch-bad-1", "switch-old-1", "new");
  await symlink("releases/v1.0.0/app", path.join(fixture.site, "app"), "dir");
  const pointerBefore = await readlink(path.join(fixture.site, "app"));
  const oldBefore = await snapshotImmutableReleaseTree(oldRelease.releaseRoot);
  const badBefore = await snapshotImmutableReleaseTree(badRelease.releaseRoot);

  const result = runCommand(fixture.site, "activate", "v1.0.0", "v1.2.0", "2026-07-20T08:12:00Z");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release-version-mismatch/);
  assert.equal(await readlink(path.join(fixture.site, "app")), pointerBefore);
  await assert.rejects(access(path.join(fixture.site, "operations", "production-publication-audit")));
  assert.deepEqual(await snapshotImmutableReleaseTree(oldRelease.releaseRoot), oldBefore);
  assert.deepEqual(await snapshotImmutableReleaseTree(badRelease.releaseRoot), badBefore);
});

test("predecessor validation failure blocks activation before the audit or pointer changes", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const badPredecessor = await buildRelease(fixture.site, "v1.0.0", "1.0.1", "switch-old-1", "switch-baseline-1", "old");
  const target = await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  await symlink("releases/v1.0.0/app", path.join(fixture.site, "app"), "dir");
  const predecessorBefore = await snapshotImmutableReleaseTree(badPredecessor.releaseRoot);
  const targetBefore = await snapshotImmutableReleaseTree(target.releaseRoot);

  const result = runCommand(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:13:00Z");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release-version-mismatch/);
  assert.equal(await readlink(path.join(fixture.site, "app")), "releases/v1.0.0/app");
  await assert.rejects(access(path.join(fixture.site, "operations", "production-publication-audit")));
  assert.deepEqual(await snapshotImmutableReleaseTree(badPredecessor.releaseRoot), predecessorBefore);
  assert.deepEqual(await snapshotImmutableReleaseTree(target.releaseRoot), targetBefore);
});

test("non-canonical pointers, release-tree symlinks, and broad operations permissions fail closed", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  const target = await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  const pointer = path.join(fixture.site, "app");
  const auditDirectory = path.join(fixture.site, "operations", "production-publication-audit");
  await symlink("releases/v1.0.0/app/../app", pointer, "dir");

  const escapedPointer = runCommand(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:13:30Z");
  assert.equal(escapedPointer.status, 1);
  assert.match(escapedPointer.stderr, /invalid-active-pointer/);
  assert.equal(await readlink(pointer), "releases/v1.0.0/app/../app");
  await assert.rejects(access(auditDirectory));

  await rm(pointer);
  await symlink("releases/v1.0.0/app", pointer, "dir");
  const external = path.join(fixture.parent, "outside-server.mjs");
  await writeFile(external, "export default null;\n");
  await rm(path.join(target.appRoot, "server.mjs"));
  await symlink(external, path.join(target.appRoot, "server.mjs"));
  const escapedRelease = runCommand(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:13:31Z");
  assert.equal(escapedRelease.status, 1);
  assert.match(escapedRelease.stderr, /invalid-release-tree/);
  assert.equal(await readlink(pointer), "releases/v1.0.0/app");
  await assert.rejects(access(auditDirectory));

  await chmod(path.join(fixture.site, "operations"), 0o755);
  const broadPermissions = runCommand(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:13:32Z");
  assert.equal(broadPermissions.status, 1);
  assert.match(broadPermissions.stderr, /site\/operations must not grant group or other access/);
  assert.equal(await readlink(pointer), "releases/v1.0.0/app");
  await assert.rejects(access(auditDirectory));
});

test("release drift between validation and replacement fails closed without moving the app pointer", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const oldRelease = await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  const target = await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  const marker = path.join(target.releaseRoot, "zzzz-drift-marker.txt");
  await writeFile(marker, "before\n");
  await writeFile(path.join(target.appRoot, "zzzz-validation-padding.bin"), Buffer.alloc(32 * 1024 * 1024, 0x61));
  await symlink("releases/v1.0.0/app", path.join(fixture.site, "app"), "dir");
  const predecessorBefore = await snapshotImmutableReleaseTree(oldRelease.releaseRoot);
  const targetBefore = await snapshotImmutableReleaseTree(target.releaseRoot);

  const running = runCommandAsync(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:16:00Z");
  const auditDirectory = path.join(fixture.site, "operations", "production-publication-audit");
  const deadline = Date.now() + 5_000;
  let preparedVisible = false;
  while (Date.now() < deadline) {
    const names = await readdir(auditDirectory).catch(() => []);
    if (names.some((name) => name.startsWith("00000001-"))) {
      preparedVisible = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(preparedVisible, true, "prepared audit event was not observable before timeout");
  await writeFile(marker, "changed between validation and replacement\n");
  const result = await running.completed;
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /release-tree-drift/);
  assert.equal(await readlink(path.join(fixture.site, "app")), "releases/v1.0.0/app");
  const audit = await readProductionReleaseAudit(fixture.site);
  assert.deepEqual(audit.events.map((event) => event.phase), ["prepared", "aborted"]);
  assert.equal(validateProductionReleaseAudit(audit.events).active_release, "v1.0.0");
  assert.deepEqual(await snapshotImmutableReleaseTree(oldRelease.releaseRoot), predecessorBefore);
  assert.notEqual((await snapshotImmutableReleaseTree(target.releaseRoot)).sha256, targetBefore.sha256);
});

test("a backdated audit event is rejected before the pointer or audit changes", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  await symlink("releases/v1.0.0/app", path.join(fixture.site, "app"), "dir");
  const activated = runCommand(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:20:00Z");
  assert.equal(activated.status, 0, activated.stderr);
  const auditBefore = await readProductionReleaseAudit(fixture.site);

  const backdated = runCommand(fixture.site, "rollback", "v1.1.0", "v1.0.0", "2026-07-20T08:19:00Z");
  assert.equal(backdated.status, 1);
  assert.match(backdated.stderr, /invalid-audit/);
  assert.match(backdated.stderr, /chronological order/);
  assert.equal(await readlink(path.join(fixture.site, "app")), "releases/v1.1.0/app");
  assert.deepEqual(await readProductionReleaseAudit(fixture.site), auditBefore);
});

test("recovery rejects committed-audit pointer drift instead of reporting a no-op", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  const pointer = path.join(fixture.site, "app");
  await symlink("releases/v1.0.0/app", pointer, "dir");
  const activated = runCommand(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:21:00Z");
  assert.equal(activated.status, 0, activated.stderr);
  const auditBefore = await readProductionReleaseAudit(fixture.site);
  await rm(pointer);
  await symlink("releases/v1.0.0/app", pointer, "dir");

  const recovery = runRecovery(fixture.site, "2026-07-20T08:22:00Z");
  assert.equal(recovery.status, 1);
  assert.match(recovery.stderr, /audit-recovery-required/);
  assert.match(recovery.stderr, /no pending operation/);
  assert.deepEqual(await readProductionReleaseAudit(fixture.site), auditBefore);
  assert.equal(await readlink(pointer), "releases/v1.0.0/app");
});

test("a pointer change after prepare stays pending for recovery instead of being falsely audited as aborted", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  const target = await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  await writeFile(path.join(target.appRoot, "zzzz-pointer-race-padding.bin"), Buffer.alloc(32 * 1024 * 1024, 0x61));
  const pointer = path.join(fixture.site, "app");
  await symlink("releases/v1.0.0/app", pointer, "dir");

  const running = runCommandAsync(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:24:00Z");
  const auditDirectory = path.join(fixture.site, "operations", "production-publication-audit");
  const deadline = Date.now() + 5_000;
  let preparedVisible = false;
  while (Date.now() < deadline) {
    const names = await readdir(auditDirectory).catch(() => []);
    if (names.some((name) => name.startsWith("00000001-"))) {
      preparedVisible = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(preparedVisible, true, "prepared audit event was not observable before timeout");
  const replacement = `${pointer}.external`;
  await symlink("releases/v1.1.0/app", replacement, "dir");
  await rename(replacement, pointer);

  const result = await running.completed;
  assert.equal(result.status, 1);
  assert.match(result.stderr, /audit-recovery-required/);
  const pending = await readProductionReleaseAudit(fixture.site);
  assert.deepEqual(pending.events.map((event) => event.phase), ["prepared"]);
  assert.equal(await readlink(pointer), "releases/v1.1.0/app");

  const recovered = runRecovery(fixture.site, "2026-07-20T08:25:00Z");
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).phase, "committed");
  assert.deepEqual((await readProductionReleaseAudit(fixture.site)).events.map((event) => event.phase), ["prepared", "committed"]);
});

test("a replaced lock is never recursively removed by the operation that originally acquired it", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  await buildRelease(fixture.site, "v1.0.0", "1.0.0", "switch-old-1", "switch-baseline-1", "old");
  const target = await buildRelease(fixture.site, "v1.1.0", "1.1.0", "switch-new-1", "switch-old-1", "new");
  await writeFile(path.join(target.appRoot, "zzzz-lock-race-padding.bin"), Buffer.alloc(32 * 1024 * 1024, 0x61));
  await symlink("releases/v1.0.0/app", path.join(fixture.site, "app"), "dir");

  const running = runCommandAsync(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:26:00Z");
  const lock = path.join(fixture.site, "operations", ".release-switch.lock");
  const deadline = Date.now() + 5_000;
  let lockVisible = false;
  while (Date.now() < deadline) {
    try {
      await access(lock);
      lockVisible = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  assert.equal(lockVisible, true, "release-switch lock was not observable before timeout");
  await rm(lock, { recursive: true, force: true });
  await mkdir(lock, { mode: 0o700 });
  const sentinel = path.join(lock, "different-owner");
  await writeFile(sentinel, "do not remove\n");

  const result = await running.completed;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(sentinel, "utf8"), "do not remove\n");
  assert.equal(await readlink(path.join(fixture.site, "app")), "releases/v1.1.0/app");
});

test("credential-bearing evidence URLs are rejected without echoing the credential", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const argumentsList = commandArguments(fixture.site, "activate", "v1.0.0", "v1.1.0", "2026-07-20T08:23:00Z");
  argumentsList[argumentsList.indexOf("--evidence-url") + 1] = "https://operator:do-not-log@example.invalid/evidence";
  const result = spawnSync(process.execPath, argumentsList, { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid-evidence-url/);
  assert.doesNotMatch(result.stderr, /do-not-log/);
  await assert.rejects(access(path.join(fixture.site, "operations")));
});

test("host wrapper runs the pointer command in an isolated Docker process with release trees mounted read-only", async (context) => {
  const fixture = await createSite();
  context.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const appRoot = path.join(fixture.site, "releases", "v1.0.0", "app");
  const deployDirectory = path.join(appRoot, "deploy");
  const scriptsDirectory = path.join(appRoot, "scripts");
  const fakeBin = path.join(fixture.parent, "fake-bin");
  await Promise.all([
    mkdir(deployDirectory, { recursive: true }),
    mkdir(scriptsDirectory, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
    mkdir(path.join(fixture.site, "backups"), { recursive: true })
  ]);
  const wrapper = path.join(deployDirectory, "switch-release-pointer");
  await copyFile(path.join(repositoryRoot, "deploy", "switch-release-pointer"), wrapper);
  await chmod(wrapper, 0o755);
  await writeFile(path.join(scriptsDirectory, "switch-production-app-pointer.mjs"), "// command fixture\n");
  await writeFile(path.join(fixture.site, ".env"), "SECRET=must-not-be-readable\n");
  await writeFile(path.join(fixture.site, "release.env"), "APP_VERSION=1.0.0\n");
  const capture = path.join(fixture.parent, "docker-arguments.txt");
  const fakeDocker = path.join(fakeBin, "docker");
  await writeFile(fakeDocker, "#!/bin/sh\nprintf '%s\\n' '---' \"$@\" >> \"$DOCKER_CAPTURE\"\n");
  await chmod(fakeDocker, 0o755);

  const result = spawnSync(wrapper, ["--action", "recover", "--occurred-at", "2026-07-20T08:17:00Z"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      DOCKER_CAPTURE: capture,
      MIBVENDOR_SITE_ROOT: fixture.site,
      MIBVENDOR_RELEASE_SWITCH_IMAGE: "untrusted-override:latest"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = (await readFile(capture, "utf8")).split("---\n").filter(Boolean).map((entry) => entry.trim().split("\n"));
  assert.doesNotMatch(await readFile(capture, "utf8"), /must-not-be-readable/);
  assert.equal(calls.length, 2, "wrapper must not operate on the running Compose service");
  assert.deepEqual(calls[0], ["image", "inspect", "mibvendor:1.0.0"]);
  const run = calls[1];
  const siteReal = await realpath(fixture.site);
  const appReal = path.join(siteReal, "releases", "v1.0.0", "app");
  assert.equal(run[0], "run");
  for (const required of [
    "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--entrypoint", "node", "mibvendor:1.0.0",
    path.join(appReal, "scripts", "switch-production-app-pointer.mjs"),
    "--site", siteReal, "--action", "recover"
  ]) assert.ok(run.includes(required), `missing Docker argument ${required}`);
  for (const mount of [
    `type=bind,src=${siteReal},dst=${siteReal}`,
    `type=bind,src=${siteReal}/releases,dst=${siteReal}/releases,readonly`,
    `type=bind,src=/dev/null,dst=${siteReal}/.env,readonly`,
    `type=bind,src=/dev/null,dst=${siteReal}/release.env,readonly`
  ]) {
    assert.ok(run.some((argument, index) => argument === "--mount" && run[index + 1] === mount), `missing Docker mount ${mount}`);
  }
  const backupsMask = `${siteReal}/backups:ro,noexec,nosuid,nodev,size=1m,mode=000`;
  assert.ok(run.some((argument, index) => argument === "--tmpfs" && run[index + 1] === backupsMask), "backups must be masked by a read-only empty tmpfs");
  assert.equal(run.includes("--env-file"), false);
  assert.equal(run.includes("compose"), false);
  assert.equal(run.includes("restart"), false);
  const imageIndex = run.indexOf("mibvendor:1.0.0");
  assert.equal(run[imageIndex + 1], path.join(appReal, "scripts", "switch-production-app-pointer.mjs"));

  const captureBeforeUnexpectedPath = await readFile(capture, "utf8");
  await writeFile(path.join(fixture.site, "private-token"), "must-not-enter-container\n");
  const refused = spawnSync(wrapper, ["--action", "recover", "--occurred-at", "2026-07-20T08:18:00Z"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      DOCKER_CAPTURE: capture,
      MIBVENDOR_SITE_ROOT: fixture.site
    }
  });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /unexpected top-level site path would be exposed/);
  assert.doesNotMatch(refused.stderr, /must-not-enter-container/);
  assert.equal(await readFile(capture, "utf8"), captureBeforeUnexpectedPath);
});
