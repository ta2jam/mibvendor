import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  constants,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  symlink
} from "node:fs/promises";
import path from "node:path";

import { canonicalJsonSha256 } from "../canonical-json.mjs";
import { validateActiveReleaseEvidence } from "./release-evidence.mjs";

const RELEASE_NAME = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ACTIONS = new Set(["activate", "rollback"]);
const PHASES = new Set(["prepared", "committed", "aborted"]);
const MAX_AUDIT_EVENT_BYTES = 16 * 1024;
const MAX_AUDIT_EVENTS = 20_000;
const AUDIT_DIRECTORY_NAME = "production-publication-audit";
const EVENT_KEYS = new Set([
  "schema_version",
  "sequence",
  "occurred_at",
  "operation_id",
  "action",
  "phase",
  "from_release",
  "to_release",
  "from_target",
  "to_target",
  "predecessor_tree_sha256",
  "target_tree_sha256",
  "reason",
  "evidence_url",
  "prepared_event_sha256",
  "previous_event_sha256",
  "event_sha256"
]);

export class ProductionReleaseSwitchError extends Error {
  constructor(message, code = "release-switch-failed") {
    super(message);
    this.name = "ProductionReleaseSwitchError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new ProductionReleaseSwitchError(message, code);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function releaseTarget(releaseName) {
  return `releases/${releaseName}/app`;
}

function assertReleaseName(value, label) {
  if (typeof value !== "string" || !RELEASE_NAME.test(value)) {
    fail(`${label} must be a v-prefixed semantic release name`, "invalid-release-name");
  }
}

function assertTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    fail("occurred_at must be a valid UTC timestamp", "invalid-timestamp");
  }
  const canonical = new Date(value).toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z")) {
    fail("occurred_at must be a canonical UTC timestamp", "invalid-timestamp");
  }
}

function assertReason(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 1_000) {
    fail("reason must contain 1-1000 characters", "invalid-reason");
  }
}

function assertEvidenceUrl(value) {
  if (value === null) return;
  if (typeof value !== "string" || value.length > 2_048) fail("evidence_url must be HTTPS or null", "invalid-evidence-url");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("evidence_url must be HTTPS or null", "invalid-evidence-url");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.href !== value) {
    fail("evidence_url must be canonical credential-free HTTPS without query or fragment, or null", "invalid-evidence-url");
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function eventDigest(event) {
  const { event_sha256: _eventSha256, ...projection } = event;
  return canonicalJsonSha256(projection);
}

async function digestFile(filePath, before) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const after = await stat(filePath, { bigint: true });
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
    || before.mode !== after.mode
  ) {
    fail(`Release file changed during validation: ${filePath}`, "release-tree-drift");
  }
  return hash.digest("hex");
}

export async function snapshotImmutableReleaseTree(releaseRoot) {
  const absoluteRoot = path.resolve(releaseRoot);
  const rootStat = await lstat(absoluteRoot, { bigint: true }).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    fail(`Release root is not a real directory: ${absoluteRoot}`, "invalid-release-tree");
  }

  const rows = [];
  let files = 0;
  let directories = 1;
  let bytes = 0n;
  rows.push(["directory", ".", Number(rootStat.mode & 0o777n)]);

  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => lexicalCompare(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const metadata = await lstat(absolute, { bigint: true });
      const mode = Number(metadata.mode & 0o777n);
      if (metadata.isSymbolicLink()) {
        fail(`Release trees cannot contain symlinks: ${relative}`, "invalid-release-tree");
      }
      if (metadata.isDirectory()) {
        directories += 1;
        rows.push(["directory", relative, mode]);
        await walk(absolute, relative);
        continue;
      }
      if (!metadata.isFile()) {
        fail(`Release trees cannot contain special files: ${relative}`, "invalid-release-tree");
      }
      files += 1;
      bytes += metadata.size;
      rows.push(["file", relative, mode, metadata.size.toString(), await digestFile(absolute, metadata)]);
    }
  }

  await walk(absoluteRoot, "");
  return Object.freeze({
    sha256: canonicalJsonSha256(rows),
    files,
    directories,
    bytes: bytes.toString()
  });
}

async function requireRegularFile(filePath, label) {
  const metadata = await lstat(filePath).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} is missing or is not a regular file`, "invalid-release-tree");
  }
}

export async function validateProductionReleaseTree(siteRoot, releaseName) {
  assertReleaseName(releaseName, "release");
  const releasesRoot = path.join(siteRoot, "releases");
  const releaseRoot = path.join(releasesRoot, releaseName);
  const appRoot = path.join(releaseRoot, "app");
  const [releaseRealPath, appRealPath] = await Promise.all([
    realpath(releaseRoot).catch(() => null),
    realpath(appRoot).catch(() => null)
  ]);
  if (releaseRealPath !== releaseRoot || appRealPath !== appRoot) {
    fail(`Release ${releaseName} must use real in-tree release/app directories`, "invalid-release-tree");
  }

  await Promise.all([
    requireRegularFile(path.join(appRoot, "VERSION"), `${releaseName} VERSION`),
    requireRegularFile(path.join(appRoot, "server.mjs"), `${releaseName} server.mjs`),
    requireRegularFile(path.join(appRoot, "compose.production.yaml"), `${releaseName} compose.production.yaml`)
  ]);
  const version = (await readFile(path.join(appRoot, "VERSION"), "utf8")).trim();
  if (version !== releaseName.slice(1)) {
    fail(`Release directory ${releaseName} does not match VERSION ${version || "<empty>"}`, "release-version-mismatch");
  }

  const evidence = await validateActiveReleaseEvidence(appRoot);
  if (!evidence.ok) {
    fail(`Release ${releaseName} failed active-release evidence validation: ${evidence.failures.join("; ")}`, "invalid-release-evidence");
  }
  if (evidence.summary.consumer_application_release !== version) {
    fail(`Release ${releaseName} evidence resolved a different consumer version`, "release-version-mismatch");
  }

  return Object.freeze({
    release: releaseName,
    target: releaseTarget(releaseName),
    release_root: releaseRoot,
    app_root: appRoot,
    data_release: evidence.summary.release_id,
    tree: await snapshotImmutableReleaseTree(releaseRoot)
  });
}

function validateAuditEvent(event, index, previousDigest) {
  if (!exactKeys(event, EVENT_KEYS)) fail(`Audit event ${index + 1} has missing or unknown fields`, "invalid-audit");
  if (event.schema_version !== 1 || event.sequence !== index + 1) fail(`Audit event ${index + 1} has invalid schema or sequence`, "invalid-audit");
  assertTimestamp(event.occurred_at);
  if (typeof event.operation_id !== "string" || !/^[0-9a-f-]{36}$/.test(event.operation_id)) fail(`Audit event ${index + 1} has an invalid operation_id`, "invalid-audit");
  if (!ACTIONS.has(event.action) || !PHASES.has(event.phase)) fail(`Audit event ${index + 1} has an invalid action or phase`, "invalid-audit");
  assertReleaseName(event.from_release, `audit event ${index + 1} from_release`);
  assertReleaseName(event.to_release, `audit event ${index + 1} to_release`);
  if (event.from_release === event.to_release) fail(`Audit event ${index + 1} does not change release`, "invalid-audit");
  if (event.from_target !== releaseTarget(event.from_release) || event.to_target !== releaseTarget(event.to_release)) {
    fail(`Audit event ${index + 1} has a non-canonical target`, "invalid-audit");
  }
  if (!DIGEST.test(event.predecessor_tree_sha256) || !DIGEST.test(event.target_tree_sha256)) fail(`Audit event ${index + 1} has an invalid tree digest`, "invalid-audit");
  assertReason(event.reason);
  assertEvidenceUrl(event.evidence_url);
  if (event.previous_event_sha256 !== previousDigest) fail(`Audit event ${index + 1} broke the hash chain`, "invalid-audit");
  if (event.phase === "prepared" && event.prepared_event_sha256 !== null) fail(`Prepared audit event ${index + 1} cannot reference itself`, "invalid-audit");
  if (event.phase !== "prepared" && !DIGEST.test(event.prepared_event_sha256 ?? "")) fail(`Audit event ${index + 1} lacks its prepared event digest`, "invalid-audit");
  if (event.event_sha256 !== eventDigest(event)) fail(`Audit event ${index + 1} digest drifted`, "invalid-audit");
}

export function validateProductionReleaseAudit(events) {
  if (!Array.isArray(events) || events.length > MAX_AUDIT_EVENTS) fail("Release-switch audit is not a bounded event array", "invalid-audit");
  let previousDigest = null;
  let previousTime = -Infinity;
  let activeRelease = null;
  let pending = null;
  for (const [index, event] of events.entries()) {
    validateAuditEvent(event, index, previousDigest);
    const occurredAt = Date.parse(event.occurred_at);
    if (occurredAt < previousTime) fail(`Audit event ${index + 1} is out of chronological order`, "invalid-audit");
    if (event.phase === "prepared") {
      if (pending) fail(`Audit event ${index + 1} starts before the prior operation closes`, "invalid-audit");
      if (activeRelease === null) activeRelease = event.from_release;
      if (event.from_release !== activeRelease) fail(`Audit event ${index + 1} starts from the wrong release`, "invalid-audit");
      pending = event;
    } else {
      if (!pending || event.prepared_event_sha256 !== pending.event_sha256) fail(`Audit event ${index + 1} does not close the current prepared event`, "invalid-audit");
      for (const field of [
        "operation_id", "action", "from_release", "to_release", "from_target", "to_target",
        "predecessor_tree_sha256", "target_tree_sha256", "reason", "evidence_url"
      ]) {
        if (event[field] !== pending[field]) fail(`Audit event ${index + 1} changed prepared field ${field}`, "invalid-audit");
      }
      if (event.phase === "committed") activeRelease = event.to_release;
      pending = null;
    }
    previousDigest = event.event_sha256;
    previousTime = occurredAt;
  }
  return Object.freeze({ active_release: activeRelease, pending, latest_event_sha256: previousDigest });
}

function validateAuditAppend(events, event) {
  return validateProductionReleaseAudit([...events, event]);
}

async function inspectAuditDirectory(auditDirectory) {
  const directoryMetadata = await lstat(auditDirectory).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!directoryMetadata) return { events: [], files: [] };
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink() || await realpath(auditDirectory) !== auditDirectory) {
    fail("Release-switch audit must be a real directory", "invalid-audit");
  }
  if ((directoryMetadata.mode & 0o077) !== 0) fail("Release-switch audit directory must not grant group or other access", "invalid-audit");

  const names = (await readdir(auditDirectory)).sort(lexicalCompare);
  if (names.some((name) => name.startsWith(".next."))) fail("Release-switch audit contains an interrupted append", "audit-recovery-required");
  if (names.length > MAX_AUDIT_EVENTS) fail("Release-switch audit exceeds its event-count bound", "invalid-audit");
  const events = [];
  const files = [];
  for (const [index, name] of names.entries()) {
    const match = /^(\d{8})-([0-9a-f]{64})\.json$/.exec(name);
    if (!match || Number(match[1]) !== index + 1) fail(`Release-switch audit filename is invalid: ${name}`, "invalid-audit");
    const filePath = path.join(auditDirectory, name);
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) fail(`Release-switch audit event is not one regular file: ${name}`, "invalid-audit");
    if (metadata.size < 2 || metadata.size > MAX_AUDIT_EVENT_BYTES) fail(`Release-switch audit event has an invalid size: ${name}`, "invalid-audit");
    if ((metadata.mode & 0o777) !== 0o400) fail(`Release-switch audit event permissions must be exactly 0400: ${name}`, "invalid-audit");
    const bytes = await readFile(filePath);
    if (bytes.at(-1) !== 0x0a) fail(`Release-switch audit event is incomplete: ${name}`, "invalid-audit");
    let event;
    try {
      event = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(`Release-switch audit event contains invalid JSON: ${name}`, "invalid-audit");
    }
    if (event.event_sha256 !== match[2]) fail(`Release-switch audit filename digest drifted: ${name}`, "invalid-audit");
    events.push(event);
    files.push(Object.freeze({ name, sha256: sha256Bytes(bytes) }));
  }
  validateProductionReleaseAudit(events);
  return { events, files };
}

export async function readProductionReleaseAudit(siteDirectory) {
  const siteRoot = await validateSiteRoot(siteDirectory);
  return inspectAuditDirectory(path.join(siteRoot, "operations", AUDIT_DIRECTORY_NAME));
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function ensureAuditDirectory(operations) {
  const auditDirectory = path.join(operations, AUDIT_DIRECTORY_NAME);
  let created = false;
  try {
    await mkdir(auditDirectory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const metadata = await lstat(auditDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(auditDirectory) !== auditDirectory || (metadata.mode & 0o077) !== 0) {
    fail("Release-switch audit directory is unsafe", "invalid-audit");
  }
  if (created) await syncDirectory(operations);
  return auditDirectory;
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function appendAuditEvent(auditDirectory, event) {
  const line = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
  if (line.length > MAX_AUDIT_EVENT_BYTES) fail("Release-switch audit event exceeds its size bound", "invalid-audit");
  const finalName = `${String(event.sequence).padStart(8, "0")}-${event.event_sha256}.json`;
  const finalPath = path.join(auditDirectory, finalName);
  const temporary = path.join(auditDirectory, `.next.${process.pid}.${randomUUID()}`);
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(line);
    await handle.sync();
    await handle.chmod(0o400);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, finalPath);
    await syncDirectory(auditDirectory);
  } finally {
    await rm(temporary, { force: true });
  }
}

function makeAuditEvent({ sequence, occurredAt, operationId, action, phase, predecessor, target, reason, evidenceUrl, preparedDigest, previousDigest }) {
  const event = {
    schema_version: 1,
    sequence,
    occurred_at: occurredAt,
    operation_id: operationId,
    action,
    phase,
    from_release: predecessor.release,
    to_release: target.release,
    from_target: predecessor.target,
    to_target: target.target,
    predecessor_tree_sha256: predecessor.tree.sha256,
    target_tree_sha256: target.tree.sha256,
    reason,
    evidence_url: evidenceUrl,
    prepared_event_sha256: preparedDigest,
    previous_event_sha256: previousDigest,
    event_sha256: null
  };
  event.event_sha256 = eventDigest(event);
  return event;
}

function sameTreeSnapshot(left, right) {
  return left.sha256 === right.sha256
    && left.files === right.files
    && left.directories === right.directories
    && left.bytes === right.bytes;
}

async function validateSiteRoot(siteDirectory) {
  if (typeof siteDirectory !== "string" || !siteDirectory) fail("site is required", "invalid-site");
  const absolute = path.resolve(siteDirectory);
  const siteMetadata = await lstat(absolute).catch(() => null);
  if (!siteMetadata?.isDirectory() || siteMetadata.isSymbolicLink()) fail("site must be a real directory", "invalid-site");
  const siteRoot = await realpath(absolute);
  const releasesRoot = path.join(siteRoot, "releases");
  const releasesMetadata = await lstat(releasesRoot).catch(() => null);
  if (!releasesMetadata?.isDirectory() || releasesMetadata.isSymbolicLink() || await realpath(releasesRoot) !== releasesRoot) {
    fail("site/releases must be a real in-site directory", "invalid-site");
  }
  return siteRoot;
}

async function ensureOperationsDirectory(siteRoot) {
  const operations = path.join(siteRoot, "operations");
  await mkdir(operations, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const metadata = await lstat(operations);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(operations) !== operations) {
    fail("site/operations must be a real directory", "invalid-site");
  }
  if ((metadata.mode & 0o077) !== 0) fail("site/operations must not grant group or other access", "invalid-site");
  return operations;
}

async function inspectActivePointer(siteRoot) {
  const pointer = path.join(siteRoot, "app");
  const metadata = await lstat(pointer).catch(() => null);
  if (!metadata?.isSymbolicLink()) fail("site/app must be a symbolic link", "invalid-active-pointer");
  const target = await readlink(pointer);
  if (path.isAbsolute(target) || path.normalize(target) !== target) fail("site/app must use a canonical relative target", "invalid-active-pointer");
  const match = /^releases\/(v[^/]+)\/app$/.exec(target);
  if (!match || !RELEASE_NAME.test(match[1])) fail("site/app target must be releases/<version>/app", "invalid-active-pointer");
  return { pointer, target, release: match[1], real: await realpath(pointer) };
}

async function atomicReplacePointer(pointer, target) {
  const temporary = `${pointer}.next.${process.pid}.${randomUUID()}`;
  try {
    await symlink(target, temporary, "dir");
    await rename(temporary, pointer);
    await syncDirectory(path.dirname(pointer));
  } finally {
    await rm(temporary, { force: true });
  }
  if (await readlink(pointer) !== target) fail("Atomic app pointer verification failed", "pointer-switch-failed");
}

async function acquireLock(operations) {
  const lockPath = path.join(operations, ".release-switch.lock");
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") fail("Another release switch is active or requires lock recovery", "release-switch-locked");
    throw error;
  }
  const metadata = await lstat(lockPath, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077n) !== 0n) {
    fail("New release-switch lock is unsafe", "invalid-release-switch-lock");
  }
  return Object.freeze({ path: lockPath, operations, dev: metadata.dev, ino: metadata.ino });
}

async function releaseOwnedLock(lock) {
  const metadata = await lstat(lock.path, { bigint: true }).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink() || metadata.dev !== lock.dev || metadata.ino !== lock.ino) {
    return false;
  }
  if ((await readdir(lock.path)).length !== 0) return false;
  try {
    await rmdir(lock.path);
  } catch (error) {
    if (new Set(["ENOENT", "ENOTEMPTY", "EEXIST"]).has(error.code)) return false;
    throw error;
  }
  await syncDirectory(lock.operations);
  return true;
}

async function clearAcknowledgedStaleLock(operations) {
  const lock = path.join(operations, ".release-switch.lock");
  const metadata = await lstat(lock).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) return false;
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || await realpath(lock) !== lock
    || (metadata.mode & 0o077) !== 0
  ) {
    fail("Release-switch lock is unsafe and was not removed", "invalid-release-switch-lock");
  }
  if ((await readdir(lock)).length !== 0) {
    fail("Release-switch lock is not empty and was not removed", "invalid-release-switch-lock");
  }
  try {
    await rmdir(lock);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    fail(`Acknowledged stale lock could not be removed: ${error.message}`, "release-switch-locked");
  }
  await syncDirectory(operations);
  return true;
}

export async function switchProductionAppPointer({
  site,
  action,
  expectedCurrentRelease,
  targetRelease,
  occurredAt,
  reason,
  evidenceUrl = null
}) {
  if (!ACTIONS.has(action)) fail("action must be activate or rollback", "invalid-action");
  assertReleaseName(expectedCurrentRelease, "expected current release");
  assertReleaseName(targetRelease, "target release");
  if (expectedCurrentRelease === targetRelease) fail("target release must differ from the current release", "invalid-release-name");
  assertTimestamp(occurredAt);
  assertReason(reason);
  assertEvidenceUrl(evidenceUrl);

  const siteRoot = await validateSiteRoot(site);
  const operations = await ensureOperationsDirectory(siteRoot);
  const lock = await acquireLock(operations);
  const auditDirectory = path.join(operations, AUDIT_DIRECTORY_NAME);
  try {
    const active = await inspectActivePointer(siteRoot);
    if (active.release !== expectedCurrentRelease) {
      fail(`Active release is ${active.release}, not expected ${expectedCurrentRelease}`, "active-release-drift");
    }

    const audit = await inspectAuditDirectory(auditDirectory);
    const auditState = validateProductionReleaseAudit(audit.events);
    if (auditState.pending) fail("Release-switch audit has an unresolved prepared operation", "audit-recovery-required");
    if (auditState.active_release !== null && auditState.active_release !== active.release) {
      fail("Active app pointer differs from the committed release-switch audit", "active-release-drift");
    }

    const predecessor = await validateProductionReleaseTree(siteRoot, expectedCurrentRelease);
    const target = await validateProductionReleaseTree(siteRoot, targetRelease);
    if (active.real !== predecessor.app_root) fail("Active app symlink does not resolve to the expected release tree", "active-release-drift");

    const activeAfterValidation = await inspectActivePointer(siteRoot);
    if (activeAfterValidation.release !== active.release || activeAfterValidation.target !== active.target || activeAfterValidation.real !== active.real) {
      fail("Active app pointer changed during release validation", "active-release-drift");
    }

    const operationId = randomUUID();
    const prepared = makeAuditEvent({
      sequence: audit.events.length + 1,
      occurredAt,
      operationId,
      action,
      phase: "prepared",
      predecessor,
      target,
      reason,
      evidenceUrl,
      preparedDigest: null,
      previousDigest: audit.events.at(-1)?.event_sha256 ?? null
    });
    validateAuditAppend(audit.events, prepared);
    await ensureAuditDirectory(operations);
    await appendAuditEvent(auditDirectory, prepared);

    try {
      const [predecessorRecheck, targetRecheck] = await Promise.all([
        snapshotImmutableReleaseTree(predecessor.release_root),
        snapshotImmutableReleaseTree(target.release_root)
      ]);
      if (!sameTreeSnapshot(predecessor.tree, predecessorRecheck) || !sameTreeSnapshot(target.tree, targetRecheck)) {
        fail("A release tree changed after validation and before the app pointer switch", "release-tree-drift");
      }
      const pointerRecheck = await inspectActivePointer(siteRoot);
      if (pointerRecheck.release !== active.release || pointerRecheck.target !== active.target || pointerRecheck.real !== active.real) {
        fail("Active app pointer changed after validation and before replacement", "active-release-drift");
      }
      await atomicReplacePointer(active.pointer, target.target);
    } catch (error) {
      const pointerAfterFailure = await inspectActivePointer(siteRoot).catch(() => null);
      const predecessorStillActive = pointerAfterFailure
        && pointerAfterFailure.release === predecessor.release
        && pointerAfterFailure.target === predecessor.target
        && pointerAfterFailure.real === predecessor.app_root;
      if (!predecessorStillActive) {
        throw new ProductionReleaseSwitchError(
          `App pointer state requires recovery after a prepared switch: ${error.message}`,
          "audit-recovery-required"
        );
      }
      const aborted = makeAuditEvent({
        sequence: prepared.sequence + 1,
        occurredAt,
        operationId,
        action,
        phase: "aborted",
        predecessor,
        target,
        reason,
        evidenceUrl,
        preparedDigest: prepared.event_sha256,
        previousDigest: prepared.event_sha256
      });
      try {
        validateAuditAppend([...audit.events, prepared], aborted);
        await appendAuditEvent(auditDirectory, aborted);
      } catch (auditError) {
        throw new ProductionReleaseSwitchError(
          `App pointer stayed on ${predecessor.target}, but the abort audit needs recovery: ${auditError.message}`,
          "audit-recovery-required"
        );
      }
      throw error;
    }

    const committed = makeAuditEvent({
      sequence: prepared.sequence + 1,
      occurredAt,
      operationId,
      action,
      phase: "committed",
      predecessor,
      target,
      reason,
      evidenceUrl,
      preparedDigest: prepared.event_sha256,
      previousDigest: prepared.event_sha256
    });
    try {
      validateAuditAppend([...audit.events, prepared], committed);
      await appendAuditEvent(auditDirectory, committed);
    } catch (error) {
      throw new ProductionReleaseSwitchError(
        `App pointer moved to ${target.target}, but the commit audit needs recovery: ${error.message}`,
        "audit-recovery-required"
      );
    }

    const finalPointer = await inspectActivePointer(siteRoot);
    const finalAudit = await inspectAuditDirectory(auditDirectory);
    const finalAuditState = validateProductionReleaseAudit(finalAudit.events);
    if (finalPointer.release !== target.release || finalPointer.real !== target.app_root || finalAuditState.active_release !== target.release || finalAuditState.pending) {
      fail("Committed app pointer and release-switch audit did not reconcile", "audit-recovery-required");
    }

    return Object.freeze({
      scope: "filesystem-app-pointer-only",
      action,
      from_release: predecessor.release,
      to_release: target.release,
      active_target: await readlink(active.pointer),
      predecessor_tree: predecessor.tree,
      target_tree: target.tree,
      audit_directory: auditDirectory,
      audit_event_sha256: committed.event_sha256,
      running_container_changed: false,
      traffic_changed: false,
      container_restart_required: true,
      release_env_update_required: true
    });
  } finally {
    await releaseOwnedLock(lock);
  }
}

async function removeInterruptedAuditTemps(auditDirectory) {
  const metadata = await lstat(auditDirectory).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) return [];
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(auditDirectory) !== auditDirectory) {
    fail("Release-switch audit directory is unsafe", "invalid-audit");
  }
  const removed = [];
  for (const name of await readdir(auditDirectory)) {
    if (!name.startsWith(".next.")) continue;
    const temporary = path.join(auditDirectory, name);
    const temporaryMetadata = await lstat(temporary);
    if (!temporaryMetadata.isFile() || temporaryMetadata.isSymbolicLink() || temporaryMetadata.nlink !== 1) {
      fail(`Interrupted audit temporary is unsafe: ${name}`, "invalid-audit");
    }
    await rm(temporary);
    removed.push(name);
  }
  if (removed.length) await syncDirectory(auditDirectory);
  return removed.sort(lexicalCompare);
}

export async function recoverProductionReleaseAudit({ site, occurredAt, clearStaleLock = false }) {
  assertTimestamp(occurredAt);
  if (typeof clearStaleLock !== "boolean") fail("clearStaleLock must be boolean", "invalid-stale-lock-acknowledgement");
  const siteRoot = await validateSiteRoot(site);
  const operations = await ensureOperationsDirectory(siteRoot);
  const stale_lock_cleared = clearStaleLock
    ? await clearAcknowledgedStaleLock(operations)
    : false;
  const lock = await acquireLock(operations);
  const auditDirectory = path.join(operations, AUDIT_DIRECTORY_NAME);
  try {
    const removed_temporaries = await removeInterruptedAuditTemps(auditDirectory);
    const audit = await inspectAuditDirectory(auditDirectory);
    const state = validateProductionReleaseAudit(audit.events);
    if (!state.pending) {
      const active = await inspectActivePointer(siteRoot);
      if (state.active_release !== null && state.active_release !== active.release) {
        fail("Committed release-switch audit differs from the active app pointer and has no pending operation", "audit-recovery-required");
      }
      const activeTree = await validateProductionReleaseTree(siteRoot, active.release);
      if (active.real !== activeTree.app_root) fail("Active app pointer does not resolve to its validated release tree", "audit-recovery-required");
      return Object.freeze({
        scope: "filesystem-app-pointer-only",
        recovered: false,
        active_release: active.release,
        removed_temporaries,
        stale_lock_cleared,
        running_container_changed: false,
        traffic_changed: false,
        container_restart_required: false,
        release_env_update_required: false
      });
    }

    const active = await inspectActivePointer(siteRoot);
    const predecessor = await validateProductionReleaseTree(siteRoot, state.pending.from_release);
    const target = await validateProductionReleaseTree(siteRoot, state.pending.to_release);
    if (
      predecessor.tree.sha256 !== state.pending.predecessor_tree_sha256
      || target.tree.sha256 !== state.pending.target_tree_sha256
    ) {
      fail("Pending release-switch audit tree digests no longer match", "audit-recovery-required");
    }

    let phase;
    if (active.release === predecessor.release && active.real === predecessor.app_root) phase = "aborted";
    else if (active.release === target.release && active.real === target.app_root) phase = "committed";
    else fail("Active app pointer matches neither side of the pending operation", "audit-recovery-required");

    const closing = makeAuditEvent({
      sequence: audit.events.length + 1,
      occurredAt,
      operationId: state.pending.operation_id,
      action: state.pending.action,
      phase,
      predecessor,
      target,
      reason: state.pending.reason,
      evidenceUrl: state.pending.evidence_url,
      preparedDigest: state.pending.event_sha256,
      previousDigest: audit.events.at(-1).event_sha256
    });
    validateAuditAppend(audit.events, closing);
    await appendAuditEvent(auditDirectory, closing);
    const reconciled = validateProductionReleaseAudit((await inspectAuditDirectory(auditDirectory)).events);
    if (reconciled.pending || reconciled.active_release !== active.release) fail("Recovered audit did not reconcile with app pointer", "audit-recovery-required");
    return Object.freeze({
      scope: "filesystem-app-pointer-only",
      recovered: true,
      phase,
      active_release: active.release,
      removed_temporaries,
      stale_lock_cleared,
      audit_event_sha256: closing.event_sha256,
      running_container_changed: false,
      traffic_changed: false,
      container_restart_required: phase === "committed",
      release_env_update_required: phase === "committed"
    });
  } finally {
    await releaseOwnedLock(lock);
  }
}
