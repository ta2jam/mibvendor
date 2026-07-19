import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { scanArtifactRestrictiveNotices } from "./lib/artifact-restrictive-notices.mjs";

const root = process.cwd();
const dataRoot = path.join(root, "data");
const approvedRoot = path.join(dataRoot, "mibs", "redistributable");
const failures = [];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

const catalog = JSON.parse(await readFile(path.join(dataRoot, "mib-catalog.json"), "utf8"));
const objects = JSON.parse(await readFile(path.join(dataRoot, "mib-objects.json"), "utf8"));
const sources = JSON.parse(await readFile(path.join(dataRoot, "source-catalog.json"), "utf8"));

if (catalog.policy !== "fail-closed") failures.push("MIB catalog policy must be fail-closed");
if (catalog.data_release !== objects.data_release || catalog.data_release !== sources.data_release) failures.push("MIB catalog, object catalog, and source catalog releases differ");
if (catalog.modules.length !== catalog.counts.modules) failures.push("Module count does not match manifest rows");
if (objects.objects.length !== catalog.counts.resolved_objects) failures.push("Resolved object count does not match object rows");
if (catalog.counts.publishers.IANA !== 20) failures.push("The authoritative IANA-maintained MIB inventory must contain 20 modules");
if (catalog.counts.publishers["Net-SNMP"] !== 18) failures.push("The pinned Net-SNMP project inventory must contain 18 modules");
if (catalog.counts.publishers.IETF < 70) failures.push("Unexpectedly small rights-approved IETF module inventory");

const moduleIds = new Set();
const rawPaths = new Set();
const resolvedByModule = new Map();
for (const object of objects.objects) {
  if (!/^\d+(?:\.\d+)+$/.test(object.oid)) failures.push(`Invalid OID for ${object.id}`);
  if (!object.id.startsWith(`${object.module.toLowerCase()}--`)) failures.push(`Unstable object id: ${object.id}`);
  resolvedByModule.set(object.module, (resolvedByModule.get(object.module) ?? 0) + 1);
}

for (const module of catalog.modules) {
  if (moduleIds.has(module.id)) failures.push(`Duplicate module id: ${module.id}`);
  moduleIds.add(module.id);
  if (module.publication_mode !== "redistributable" || module.raw_download !== true) failures.push(`Public raw module is not explicitly redistributable: ${module.id}`);
  if (!/^[0-9a-f]{64}$/.test(module.source_sha256) || !/^[0-9a-f]{64}$/.test(module.artifact_sha256)) failures.push(`Invalid checksum for ${module.id}`);
  if (!module.source_url.startsWith("https://") || !module.license.url.startsWith("https://")) failures.push(`Non-HTTPS provenance for ${module.id}`);
  if (module.resolved_oid_count !== (resolvedByModule.get(module.id) ?? 0)) failures.push(`Resolved object count mismatch for ${module.id}`);
  const absolute = path.resolve(dataRoot, module.raw_path);
  if (!absolute.startsWith(`${approvedRoot}${path.sep}`)) {
    failures.push(`Raw path escapes approved root: ${module.id}`);
    continue;
  }
  rawPaths.add(absolute);
  let bytes;
  try {
    bytes = await readFile(absolute);
  } catch {
    failures.push(`Missing raw file for ${module.id}`);
    continue;
  }
  if (digest(bytes) !== module.artifact_sha256) failures.push(`Artifact checksum mismatch for ${module.id}`);
  const text = bytes.toString("utf8");
  const parsedName = text.match(/^\s*(?:--[^\n]*\n\s*)*([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS(?:\s+IMPLICIT\s+TAGS)?\s*::=\s*BEGIN/m)?.[1]
    ?? text.match(/^\s*([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS(?:\s+IMPLICIT\s+TAGS)?\s*::=\s*BEGIN/m)?.[1];
  if (parsedName !== module.id) failures.push(`Raw module identity mismatch for ${module.id}: ${parsedName}`);
  if (module.source_id === "ietf-post-2008" && (!text.startsWith("-- mibvendor redistribution notice") || module.license.spdx !== "BSD-3-Clause")) failures.push(`IETF license notice missing for ${module.id}`);
  if (module.source_id === "iana-maintained-mibs" && (module.source_sha256 !== module.artifact_sha256 || module.license.spdx !== "CC0-1.0")) failures.push(`IANA raw snapshot was modified or mislicensed: ${module.id}`);
  if (module.source_id === "net-snmp" && module.license.spdx !== "LicenseRef-Net-SNMP") failures.push(`Net-SNMP license mapping missing for ${module.id}`);
  const restrictiveNotices = scanArtifactRestrictiveNotices(text);
  if (restrictiveNotices.length) {
    const evidence = restrictiveNotices.map((notice) => `${notice.rule_id}@${notice.line_start}-${notice.line_end}:${notice.excerpt_sha256}`).join(",");
    failures.push(`Restrictive artifact notice conflicts with raw publication for ${module.id}: ${evidence}`);
  }
}

for (const file of (await walk(approvedRoot)).filter((candidate) => candidate.endsWith(".mib"))) {
  if (!rawPaths.has(file)) failures.push(`Unmanifested raw MIB file: ${path.relative(root, file)}`);
}

for (const object of objects.objects) {
  if (!moduleIds.has(object.module)) failures.push(`Object belongs to an unapproved module: ${object.id}`);
}

const sourceIds = new Set();
for (const source of sources.sources) {
  if (sourceIds.has(source.id)) failures.push(`Duplicate source id: ${source.id}`);
  sourceIds.add(source.id);
  if (!new Set(["redistributable", "metadata-only", "directory-only"]).has(source.publication_mode)) failures.push(`Unknown source publication mode: ${source.id}`);
  if (source.publication_mode === "directory-only") {
    const allowed = new Set(["official_source_url", "publisher", "rights_state"]);
    if (source.public_fields.length !== allowed.size || source.public_fields.some((field) => !allowed.has(field))) failures.push(`Directory-only source leaks content fields: ${source.id}`);
    if (source.content_intake !== "quarantine") failures.push(`Directory-only source is not quarantined: ${source.id}`);
  }
}

for (const module of catalog.modules) {
  const source = sources.sources.find((candidate) => candidate.id === module.source_id);
  if (!source || source.publication_mode !== "redistributable" || source.scopes.raw_download !== "approved") failures.push(`Module source is not approved for raw download: ${module.id}`);
}

const netSnmpLicense = await readFile(path.join(approvedRoot, "net-snmp", "COPYING"));
if (digest(netSnmpLicense) !== catalog.source_snapshots.net_snmp.license_sha256) failures.push("Pinned Net-SNMP COPYING checksum mismatch");

if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`MIB catalog passed: ${catalog.modules.length} raw modules, ${objects.objects.length} resolved OID nodes, ${sources.sources.length} reviewed sources.`);
}
