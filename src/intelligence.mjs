import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { records as legacyRecords } from "../prototype/data.mjs";
import { parseOid, searchRecords } from "../prototype/core.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

const penDocument = readJson("data/iana-private-enterprise-numbers.json");
const mibCatalog = readJson("data/mib-catalog.json");
const mibObjectDocument = readJson("data/mib-objects.json");
const sourceCatalogDocument = readJson("data/source-catalog.json");
const enterprises = new Map(penDocument.records);
delete penDocument.records;

export const DATA_RELEASE = mibCatalog.data_release;
export const ENTERPRISE_COUNT = enterprises.size;
export const MIB_MODULE_COUNT = mibCatalog.counts.modules;
export const REDISTRIBUTABLE_MODULE_COUNT = mibCatalog.counts.publication_modes.redistributable;
export const DIRECTORY_ONLY_SOURCE_COUNT = mibCatalog.counts.publication_modes["directory-only"];
export const IANA_PEN_SOURCE = Object.freeze({
  url: penDocument.source_url,
  updated: penDocument.source_updated,
  retrieved_at: penDocument.retrieved_at,
  sha256: penDocument.source_sha256,
  rights: penDocument.rights
});

const modules = new Map(mibCatalog.modules.map((module) => [module.id.toUpperCase(), Object.freeze(module)]));
const sources = new Map(sourceCatalogDocument.sources.map((source) => [source.id, Object.freeze(source)]));

const netSnmpPlatforms = [
  [1, "HP-UX 9"], [2, "SunOS 4"], [3, "Solaris"], [4, "OSF/1"], [5, "Ultrix"],
  [6, "HP-UX 10"], [7, "NetBSD"], [8, "FreeBSD"], [9, "IRIX"], [10, "Linux"],
  [11, "BSD/OS"], [12, "OpenBSD"], [13, "Windows"], [14, "HP-UX 11"], [15, "AIX"],
  [16, "macOS"], [17, "DragonFly BSD"], [255, "Unknown platform"]
];

const sysObjectIds = new Map(netSnmpPlatforms.map(([suffix, platform]) => {
  const oid = `1.3.6.1.4.1.8072.3.2.${suffix}`;
  return [oid, Object.freeze({
    oid,
    organization: "net-snmp",
    product_family: "Net-SNMP agent",
    model: null,
    platform,
    identity_type: "agent-platform",
    match_type: "exact",
    confidence: "high",
    provenance: {
      source: "Net-SNMP NET-SNMP-TC",
      source_url: `https://github.com/net-snmp/net-snmp/blob/${mibCatalog.source_snapshots.net_snmp.commit}/mibs/NET-SNMP-TC.txt`,
      source_revision: mibCatalog.source_snapshots.net_snmp.commit,
      rights: "BSD-family",
      checked_at: mibCatalog.generated_at.slice(0, 10)
    }
  })];
}));

const restrictedEnterpriseSources = new Map([
  [9, {
    source_family: "Cisco enterprise MIBs",
    api_output: "denied",
    checked_at: "2026-07-13",
    detail: "Exact product mapping is not published because the reviewed Cisco source does not grant public API-output rights."
  }]
]);

export const SYS_OBJECT_ID_COUNT = sysObjectIds.size;

const legacyModuleImports = Object.freeze({
  "IF-MIB": ["SNMPv2-SMI", "SNMPv2-TC", "SNMPv2-CONF"],
  "SNMPv2-MIB": ["SNMPv2-SMI", "SNMPv2-TC", "SNMPv2-CONF"],
  "HOST-RESOURCES-MIB": ["SNMPv2-SMI", "SNMPv2-TC", "SNMPv2-CONF"],
  "SNMPv2-SMI": [], "SNMPv2-TC": ["SNMPv2-SMI"], "SNMPv2-CONF": ["SNMPv2-SMI"]
});

function syntaxShape(rawSyntax, enums = {}) {
  const raw = rawSyntax ?? null;
  const base = raw?.match(/^(OCTET STRING|OBJECT IDENTIFIER|[A-Za-z][A-Za-z0-9-]*)/)?.[1] ?? "OBJECT IDENTIFIER";
  const builtIns = new Set(["INTEGER", "Integer32", "Unsigned32", "Counter32", "Counter64", "Gauge32", "TimeTicks", "OCTET STRING", "OBJECT IDENTIFIER", "BITS", "IpAddress"]);
  return {
    raw,
    base,
    textual_convention: builtIns.has(base) ? null : base,
    display_hint: null,
    units: null,
    constraints: [...new Set([...(raw?.matchAll(/\(([^()]*(?:\.\.)[^()]*)\)/g) ?? [])].map((match) => match[1]))],
    enums,
    bits: {}
  };
}

export function stableId(record) {
  return `${record.module.toLowerCase()}--${record.symbol.toLowerCase()}`;
}

function publicLegacyObject(record) {
  return {
    id: stableId(record), module: record.module, symbol: record.symbol, oid: record.oid, kind: record.kind,
    syntax: {
      raw: record.syntax,
      base: record.syntaxDetail.base,
      textual_convention: record.syntaxDetail.textualConvention,
      display_hint: record.syntaxDetail.displayHint,
      units: record.syntaxDetail.units,
      constraints: record.syntaxDetail.constraints,
      enums: record.syntaxDetail.enums,
      bits: record.syntaxDetail.bits
    },
    access: record.access,
    status: record.status,
    description: { status: "available", text: record.description },
    revision: record.revision,
    relationships: {
      parent: record.parent, table: record.table, row: record.row,
      indexes: record.index ? [record.index] : [], augments: null,
      notification_objects: record.notificationObjects
    },
    provenance: {
      source: record.source, source_url: record.sourceUrl, source_checked: record.sourceChecked,
      parse_status: record.parseStatus, publication_mode: "metadata-only", raw_download: false,
      rights_tier: "B", scopes: ["independently-authored factual metadata", "mibvendor paraphrase"]
    }
  };
}

function publicCatalogObject(record) {
  const module = modules.get(record.module.toUpperCase());
  return {
    id: record.id, module: record.module, symbol: record.symbol, oid: record.oid, kind: record.kind,
    syntax: syntaxShape(record.syntax, record.enums),
    access: record.access,
    status: record.status,
    description: { status: record.description ? "available" : "not-provided", text: record.description },
    revision: module?.revision ?? null,
    relationships: {
      parent: record.parent, table: null, row: null, indexes: [], augments: null,
      notification_objects: []
    },
    provenance: {
      source: module?.publisher ?? null,
      source_url: module?.source_url ?? null,
      source_revision: module?.source_revision ?? null,
      source_sha256: module?.source_sha256 ?? null,
      artifact_sha256: module?.artifact_sha256 ?? null,
      parse_status: record.oid_resolution,
      publication_mode: "redistributable",
      raw_download: true,
      rights_tier: "A",
      license: module?.license ?? null
    }
  };
}

const catalogResolutionRecords = mibObjectDocument.objects.map((record) => ({
  ...record,
  intent: [],
  related: [],
  table: null,
  row: null,
  index: null,
  notificationObjects: [],
  _catalog: true
}));
const resolutionRecords = [...legacyRecords, ...catalogResolutionRecords];
const byId = new Map(resolutionRecords.map((record) => [stableId(record), record]));
const byOid = new Map();
for (const record of resolutionRecords) {
  const current = byOid.get(record.oid);
  if (!current || (record._catalog && !current._catalog)) byOid.set(record.oid, record);
}

export function publicObject(record) {
  return record._catalog ? publicCatalogObject(record) : publicLegacyObject(record);
}

export function findObject(objectId) {
  return byId.get(objectId) ?? null;
}

function resolveRecord(input) {
  const arcs = parseOid(input);
  if (!arcs) return null;
  for (let length = arcs.length; length > 0; length -= 1) {
    const record = byOid.get(arcs.slice(0, length).join("."));
    if (record) return { arcs, record, instance: arcs.slice(length) };
  }
  return { arcs, record: null, instance: [] };
}

export function searchObjects(query) {
  const normalized = String(query).trim();
  if (!normalized) return [];
  if (/^\.?\d/.test(normalized)) {
    const resolved = resolveRecord(normalized);
    return resolved?.record ? [publicObject(resolved.record)] : [];
  }
  return searchRecords(normalized, resolutionRecords).slice(0, 20).map(publicObject);
}

export function resolveObject(input) {
  const resolved = resolveRecord(input);
  if (!resolved) return { input, status: "invalid" };
  if (!resolved.record) return { input, status: "not_found" };
  return { input, status: "resolved", object: publicObject(resolved.record), instance_suffix: resolved.instance };
}

export function lookupEnterprise(number) {
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) return null;
  const organization = enterprises.get(number);
  if (!organization) return null;
  return {
    number, oid: `1.3.6.1.4.1.${number}`, organization,
    registry_status: organization.toLowerCase().includes("reserved") ? "reserved" : "assigned",
    source: IANA_PEN_SOURCE,
    caveat: "A PEN registration identifies the registry assignee; it does not prove device manufacturer, product model, ownership, or authenticity."
  };
}

export function lookupSysObjectId(input) {
  const arcs = parseOid(input);
  if (!arcs) return { input, status: "invalid" };
  const normalized = arcs.join(".");
  const enterprisePrefix = [1, 3, 6, 1, 4, 1];
  const underEnterprise = enterprisePrefix.every((arc, index) => arcs[index] === arc);
  if (!underEnterprise || arcs.length <= enterprisePrefix.length) return { input, normalized_oid: normalized, status: "not_found", enterprise: null, match: null };
  const enterprise = lookupEnterprise(arcs[enterprisePrefix.length]);
  const match = sysObjectIds.get(normalized) ?? null;
  if (match) return { input, normalized_oid: normalized, status: "resolved", enterprise, match, caveat: "This identifies the agent platform declared by the exact OID, not the hardware model or current firmware." };
  const rightsRestriction = restrictedEnterpriseSources.get(arcs[enterprisePrefix.length]);
  if (enterprise && rightsRestriction) return { input, normalized_oid: normalized, status: "unavailable_due_to_rights", enterprise, match: null, rights: rightsRestriction, caveat: "The PEN registry assignment is visible, but exact product or model data is withheld under the source-specific publication policy." };
  if (enterprise) return { input, normalized_oid: normalized, status: "enterprise_only", enterprise, match: null, caveat: "Only the PEN registry boundary is known. No product or model identity is asserted for this OID." };
  return { input, normalized_oid: normalized, status: "not_found", enterprise: null, match: null };
}

export function publicModule(module) {
  return {
    id: module.id,
    publisher: module.publisher,
    publication_mode: module.publication_mode,
    raw_download: module.raw_download,
    raw_url: module.raw_download ? `/v1/modules/${encodeURIComponent(module.id)}/raw` : null,
    source_url: module.source_url,
    source_revision: module.source_revision,
    source_sha256: module.source_sha256,
    artifact_sha256: module.artifact_sha256,
    revision: module.revision,
    license: module.license,
    dependencies: module.dependencies,
    declared_oid_count: module.declared_oid_count,
    resolved_oid_count: module.resolved_oid_count
  };
}

export function findModule(moduleName) {
  return modules.get(String(moduleName).toUpperCase()) ?? null;
}

export function listModules({ query = "", publisher = "", limit = 50, cursor = 0 } = {}) {
  const q = String(query).trim().toLowerCase();
  const vendor = String(publisher).trim().toLowerCase();
  const filtered = [...modules.values()].filter((module) => (!q || module.id.toLowerCase().includes(q)) && (!vendor || module.publisher.toLowerCase() === vendor));
  return { total: filtered.length, next_cursor: cursor + limit < filtered.length ? cursor + limit : null, results: filtered.slice(cursor, cursor + limit).map(publicModule) };
}

export function rawModule(moduleName) {
  const module = findModule(moduleName);
  if (!module || !module.raw_download || module.publication_mode !== "redistributable") return null;
  const absolute = path.resolve(path.join(projectRoot, "data"), module.raw_path);
  const allowedRoot = path.resolve(projectRoot, "data", "mibs", "redistributable");
  if (!absolute.startsWith(`${allowedRoot}${path.sep}`)) throw new Error("MIB catalog raw path escaped the approved directory");
  return { module: publicModule(module), bytes: readFileSync(absolute) };
}

export function listSources({ mode = "" } = {}) {
  const normalized = String(mode).trim().toLowerCase();
  return [...sources.values()].filter((source) => !normalized || source.publication_mode === normalized);
}

export function findSource(sourceId) {
  return sources.get(sourceId) ?? null;
}

export function moduleDependencies(moduleName) {
  const normalized = String(moduleName).toUpperCase();
  const catalogModule = modules.get(normalized);
  const direct = [...(catalogModule?.dependencies ?? legacyModuleImports[normalized] ?? [])].sort();
  if (!catalogModule && !(normalized in legacyModuleImports) && !legacyRecords.some((record) => record.module === normalized)) return null;
  const transitive = new Set();
  const cyclic = new Set();
  function imports(name) { return modules.get(name)?.dependencies ?? legacyModuleImports[name] ?? []; }
  function present(name) { return modules.has(name) || legacyRecords.some((record) => record.module === name); }
  function visit(current, trail) {
    for (const dependency of imports(current)) {
      const dependencyName = dependency.toUpperCase();
      if (trail.includes(dependencyName)) {
        cyclic.add([...trail.slice(trail.indexOf(dependencyName)), dependencyName].join(" -> "));
        continue;
      }
      if (!direct.includes(dependency)) transitive.add(dependency);
      visit(dependencyName, [...trail, dependencyName]);
    }
  }
  visit(normalized, [normalized]);
  const closure = [...new Set([...direct, ...transitive])].sort();
  const missing = closure.filter((dependency) => !present(dependency.toUpperCase()));
  return {
    module: normalized,
    status: missing.length ? "partial" : "complete",
    direct,
    transitive: [...transitive].sort(),
    missing,
    cyclic: [...cyclic].sort(),
    diagnostics: missing.length ? ["One or more imported modules are outside this rights-cleared public release; the missing state is explicit rather than silently filled from an unapproved file."] : []
  };
}

export const objectRecords = resolutionRecords;
