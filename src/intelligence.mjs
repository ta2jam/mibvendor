import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { records as legacyRecords } from "../prototype/data.mjs";
import { createSearchIndex, parseOid, rankSearchIndex } from "../prototype/core.mjs";
import {
  IDENTITY_PUBLICATION_CONTROL_REVISION,
  IDENTITY_PUBLICATION_STATE,
  IDENTITY_RELEASE,
  createDeviceIdentityEngine
} from "./device-identity.mjs";
import { derivePublicationControlState, isPublicationEnabled, validatePublicationControls } from "./publication-controls.mjs";

export { IDENTITY_PUBLICATION_CONTROL_REVISION, IDENTITY_PUBLICATION_STATE, IDENTITY_RELEASE };

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

const penDocument = readJson("data/iana-private-enterprise-numbers.json");
const mibCatalog = readJson("data/mib-catalog.json");
const mibObjectDocument = readJson("data/mib-objects.json");
const sourceCatalogDocument = readJson("data/source-catalog.json");
const publicationControlDocument = readJson("data/publication-controls.json");
const enterprises = new Map(penDocument.records);
delete penDocument.records;

export const DATA_RELEASE = mibCatalog.data_release;
export const ENTERPRISE_COUNT = enterprises.size;
export const IANA_PEN_SOURCE = Object.freeze({
  url: penDocument.source_url,
  updated: penDocument.source_updated,
  retrieved_at: penDocument.retrieved_at,
  sha256: penDocument.source_sha256,
  rights: penDocument.rights
});

const allModules = new Map(mibCatalog.modules.map((module) => [module.id.toUpperCase(), Object.freeze(module)]));
const allSources = new Map(sourceCatalogDocument.sources.map((source) => [source.id, Object.freeze(source)]));
const controlFailures = validatePublicationControls(publicationControlDocument, {
  releaseId: DATA_RELEASE,
  sourceIds: new Set(allSources.keys()),
  moduleIds: new Set([...allModules.values()].map((module) => module.id))
});
if (controlFailures.length) throw new Error(`Publication control validation failed: ${controlFailures.join("; ")}`);
const publicationControls = derivePublicationControlState(publicationControlDocument.events);
const modules = new Map([...allModules].filter(([, module]) => isPublicationEnabled({
  sourceId: module.source_id,
  moduleId: module.id
}, publicationControls)));
const sources = new Map([...allSources].filter(([sourceId]) => !publicationControls.disabledSources.has(sourceId)));
export const MIB_MODULE_COUNT = modules.size;

const publicationModes = ["redistributable", "metadata-only", "directory-only"];

function publicationModeCounts(records) {
  const counts = Object.fromEntries(publicationModes.map((mode) => [mode, 0]));
  for (const record of records) {
    if (Object.hasOwn(counts, record.publication_mode)) counts[record.publication_mode] += 1;
  }
  return Object.freeze(counts);
}

function countActiveTextualConventions() {
  if (publicationControls.disabledSources.size === 0
    && publicationControls.disabledModules.size === 0
    && Number.isSafeInteger(mibCatalog.counts.textual_conventions)) {
    return mibCatalog.counts.textual_conventions;
  }
  const approvedRoot = path.resolve(projectRoot, "data", "mibs", "redistributable");
  let count = 0;
  for (const module of modules.values()) {
    if (module.publication_mode !== "redistributable" || !module.raw_download) continue;
    const absolute = path.resolve(path.join(projectRoot, "data"), module.raw_path);
    if (!absolute.startsWith(`${approvedRoot}${path.sep}`)) {
      throw new Error("MIB catalog raw path escaped the approved directory");
    }
    const source = readFileSync(absolute, "utf8").replace(/--[^\r\n]*/g, "");
    count += [...source.matchAll(/\b[A-Za-z][A-Za-z0-9-]*\s*::=\s*TEXTUAL-CONVENTION\b/g)].length;
  }
  return count;
}

const modulePublicationModeCounts = publicationModeCounts(modules.values());
const sourcePublicationModeCounts = publicationModeCounts(sources.values());
if (allModules.size !== mibCatalog.counts.modules) {
  throw new Error("Active MIB catalog module count does not match its published module rows");
}
export const REDISTRIBUTABLE_MODULE_COUNT = modulePublicationModeCounts.redistributable;
export const DIRECTORY_ONLY_SOURCE_COUNT = sourcePublicationModeCounts["directory-only"];

const netSnmpPlatforms = [
  [1, "HP-UX 9"], [2, "SunOS 4"], [3, "Solaris"], [4, "OSF/1"], [5, "Ultrix"],
  [6, "HP-UX 10"], [7, "NetBSD"], [8, "FreeBSD"], [9, "IRIX"], [10, "Linux"],
  [11, "BSD/OS"], [12, "OpenBSD"], [13, "Windows"], [14, "HP-UX 11"], [15, "AIX"],
  [16, "macOS"], [17, "DragonFly BSD"], [255, "Unknown platform"]
];

function identityEvidenceEnabled(sourceId, moduleIds) {
  if (publicationControls.disabledSources.has(sourceId)) return false;
  return moduleIds.every((moduleId) => {
    const module = allModules.get(moduleId.toUpperCase());
    return module?.source_id === sourceId && isPublicationEnabled({ sourceId, moduleId: module.id }, publicationControls);
  });
}

const sysObjectIds = new Map();
if (identityEvidenceEnabled("net-snmp", ["NET-SNMP-TC"])) {
  for (const [suffix, platform] of netSnmpPlatforms) {
    const oid = `1.3.6.1.4.1.8072.3.2.${suffix}`;
    sysObjectIds.set(oid, Object.freeze({
    oid,
    enterprise_number: 8072,
    organization_name: "net-snmp",
    organization_key: null,
    organization: "net-snmp",
    product_family: "Net-SNMP agent",
    model: null,
    platform,
    identity_type: "agent-platform",
    match_type: "exact",
    claim_strength: "platform",
    claim_scope: "agent-platform",
    confidence: "high",
    source_assignment_confidence: "high",
    provenance: {
      source_id: "net-snmp",
      source: "Net-SNMP NET-SNMP-TC",
      source_url: `https://github.com/net-snmp/net-snmp/blob/${mibCatalog.source_snapshots.net_snmp.commit}/mibs/NET-SNMP-TC.txt`,
      source_revision: mibCatalog.source_snapshots.net_snmp.commit,
      sha256: "bf111deffcc7c36262d2e47ff8fd7d49eee8a3f1bdad6236367660da6854a233",
      rights: "BSD-family",
      checked_at: mibCatalog.generated_at.slice(0, 10)
    }
    }));
  }
}

const sigScaleRevision = "14259b9e52a5cd7ff0fd60b33728da616792887d";
const sigScaleProductOid = "1.3.6.1.4.1.50386.1.1";
if (identityEvidenceEnabled("sigscale-mibs", ["SIGSCALE-PRODUCTS-MIB", "SIGSCALE-SMI"])) sysObjectIds.set(sigScaleProductOid, Object.freeze({
  oid: sigScaleProductOid,
  enterprise_number: 50386,
  organization_name: "SigScale Global Inc.",
  organization_key: null,
  organization: "SigScale Global Inc.",
  product_family: "SigScale OCS",
  model: null,
  platform: "SigScale OCS",
  identity_type: "software-platform",
  match_type: "exact",
  claim_strength: "platform",
  claim_scope: "agent-platform",
  confidence: "high",
  source_assignment_confidence: "high",
  provenance: {
    source_id: "sigscale-mibs",
    source: "SigScale SIGSCALE-PRODUCTS-MIB",
    source_url: `https://raw.githubusercontent.com/sigscale/sigscale_mibs/${sigScaleRevision}/mibs/SIGSCALE-PRODUCTS-MIB.mib`,
    source_revision: sigScaleRevision,
    source_path: "mibs/SIGSCALE-PRODUCTS-MIB.mib",
    git_blob_oid: "a310c190af01583e6b5268fc2a64fd79f0acaf45",
    sha256: "53f5cb591c5af28c2c9783b8f7e0b897059202771cf6b931b72e639f25d793a1",
    source_license: "Apache-2.0",
    license_basis: "repository-license-signal",
    license: {
      source_path: "COPYING",
      source_url: `https://raw.githubusercontent.com/sigscale/sigscale_mibs/${sigScaleRevision}/COPYING`,
      git_blob_oid: "75a336e15b7221bbe4bde9fece1cd56ee7ee7230",
      sha256: "4e9f558225b7842cf062ed9104f031217e95c421de59140e6f066b307a2ce9f3"
    },
    field_evidence: [
      {
        fields: ["oid", "product_family", "platform", "claim_strength"],
        symbols: ["sigscaleProducts", "ocs"],
        source_path: "mibs/SIGSCALE-PRODUCTS-MIB.mib",
        source_url: `https://raw.githubusercontent.com/sigscale/sigscale_mibs/${sigScaleRevision}/mibs/SIGSCALE-PRODUCTS-MIB.mib`,
        git_blob_oid: "a310c190af01583e6b5268fc2a64fd79f0acaf45",
        sha256: "53f5cb591c5af28c2c9783b8f7e0b897059202771cf6b931b72e639f25d793a1"
      },
      {
        fields: ["oid", "organization", "enterprise_number"],
        symbols: ["sigscale", "sigscaleProducts"],
        source_path: "mibs/SIGSCALE-SMI.mib",
        source_url: `https://raw.githubusercontent.com/sigscale/sigscale_mibs/${sigScaleRevision}/mibs/SIGSCALE-SMI.mib`,
        git_blob_oid: "de4506d8f9400ca611b34f15344f0379169972ea",
        sha256: "87b745effea740fb55de6edffa637e5d9b14021712fa4c5ef3c5ed732633a85c"
      }
    ],
    claim_boundary: "The reviewed source assigns a platform sysObjectID; it does not assert an exact hardware model.",
    checked_at: "2026-07-20"
  }
}));

const deviceIdentityEngine = createDeviceIdentityEngine({
  lookupEnterprise,
  builtinClaims: [...sysObjectIds.values()]
});
export const IDENTITY_STATISTICS = deviceIdentityEngine.statistics;
export const IDENTITY_SOURCES = deviceIdentityEngine.sources;
export const SYS_OBJECT_ID_COUNT = IDENTITY_STATISTICS.sys_object_id_mappings;

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
  const relationships = catalogRelationships(record);
  return {
    id: record.id, module: record.module, symbol: record.symbol, oid: record.oid, kind: catalogObjectKind(record, relationships),
    syntax: syntaxShape(record.syntax, record.enums),
    access: record.access,
    status: record.status,
    description: { status: record.description ? "available" : "not-provided", text: record.description },
    revision: module?.revision ?? null,
    relationships: {
      parent: record.parent, table: relationships.table, row: relationships.row,
      indexes: record.index ? [record.index] : [], augments: null,
      notification_objects: record.notificationObjects ?? []
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

function legacyRecordPublicationEnabled(record) {
  const moduleId = record.module.toUpperCase();
  const activeModule = allModules.get(moduleId);
  if (activeModule) {
    return isPublicationEnabled({ sourceId: activeModule.source_id, moduleId: activeModule.id }, publicationControls);
  }
  return !publicationControls.disabledModules.has(moduleId);
}

const publicationEnabledLegacyRecords = legacyRecords.filter(legacyRecordPublicationEnabled);
const publicationEnabledLegacyModuleNames = new Set(publicationEnabledLegacyRecords.map((record) => record.module.toUpperCase()));
const legacyByStableId = new Map(legacyRecords.map((record) => [stableId(record), record]));
const legacyStableIds = new Set(legacyByStableId.keys());
const catalogResolutionRecords = mibObjectDocument.objects
  .filter((record) => modules.has(record.module.toUpperCase()))
  .map((record) => {
    const editorial = legacyByStableId.get(record.id);
    return {
      ...record,
      intent: editorial?.intent ?? [],
      related: editorial?.related ?? [],
      table: editorial?.table ?? null,
      row: editorial?.row ?? null,
      index: editorial?.index ?? null,
      notificationObjects: editorial?.notificationObjects ?? [],
      _catalog: true
    };
  });
const catalogByQualifiedSymbol = new Map(catalogResolutionRecords.map((record) => [`${record.module.toUpperCase()}\0${record.symbol.toLowerCase()}`, record]));
const catalogStableIds = new Set(catalogResolutionRecords.map((record) => record.id));
const supplementalResolutionRecords = publicationEnabledLegacyRecords.filter((record) => !catalogStableIds.has(stableId(record)));
const resolutionRecords = [...supplementalResolutionRecords, ...catalogResolutionRecords];
const resolutionSearchIndex = createSearchIndex(resolutionRecords);

function catalogRelationships(record) {
  if (!record._catalog || record.kind !== "object-type" || !record.access || record.access === "not-accessible") {
    return { table: record.table ?? null, row: record.row ?? null };
  }
  const parent = catalogByQualifiedSymbol.get(`${record.module.toUpperCase()}\0${String(record.parent).toLowerCase()}`);
  if (!parent || parent.kind !== "object-type" || parent.access !== "not-accessible") {
    return { table: record.table ?? null, row: record.row ?? null };
  }
  const table = catalogByQualifiedSymbol.get(`${record.module.toUpperCase()}\0${String(parent.parent).toLowerCase()}`);
  return {
    row: record.row ?? parent.symbol,
    table: record.table ?? table?.symbol ?? parent.parent ?? null
  };
}

function catalogObjectKind(record, relationships = catalogRelationships(record)) {
  if (!record._catalog || record.kind !== "object-type" || !record.access || record.access === "not-accessible") return record.kind;
  return relationships.row ? "column" : "scalar";
}
const moduleRootObjects = new Map();
const catalogRecordsByModule = new Map();
for (const record of catalogResolutionRecords) {
  const key = record.module.toUpperCase();
  const records = catalogRecordsByModule.get(key) ?? [];
  records.push(record);
  catalogRecordsByModule.set(key, records);
}
for (const module of modules.values()) {
  const moduleRecords = catalogRecordsByModule.get(module.id.toUpperCase()) ?? [];
  const moduleOids = new Set(moduleRecords.map((record) => record.oid));
  const roots = moduleRecords.filter((record) => {
    const arcs = record.oid.split(".");
    for (let length = arcs.length - 1; length > 0; length -= 1) {
      if (moduleOids.has(arcs.slice(0, length).join("."))) return false;
    }
    return true;
  }).sort((left, right) => left.oid.localeCompare(right.oid, "en", { numeric: true }));
  moduleRootObjects.set(module.id.toUpperCase(), roots.map((record) => Object.freeze({
    id: stableId(record),
    symbol: record.symbol,
    oid: record.oid,
    kind: record.kind
  })));
}

if (mibObjectDocument.objects.length !== mibCatalog.counts.resolved_objects) {
  throw new Error("Active MIB catalog count does not match its published object document");
}

const catalogNotificationCount = publicationControls.disabledSources.size === 0
  && publicationControls.disabledModules.size === 0
  && Number.isSafeInteger(mibCatalog.counts.notifications)
  ? mibCatalog.counts.notifications
  : catalogResolutionRecords.filter((record) => record.kind === "notification-type" || record.kind === "notification").length;
const supplementalNotificationCount = supplementalResolutionRecords.filter((record) => record.kind === "notification" || record.kind === "notification-type").length;

export const PUBLIC_CORPUS_STATISTICS = Object.freeze({
  scope: "active-public-release",
  modules: Object.freeze({
    total: MIB_MODULE_COUNT,
    publication_modes: modulePublicationModeCounts
  }),
  oid_nodes: Object.freeze({
    catalog_oid_nodes: catalogResolutionRecords.length,
    supplemental_legacy_records: supplementalResolutionRecords.length,
    searchable_records: resolutionRecords.length
  }),
  definitions: Object.freeze({
    textual_conventions: Object.freeze({
      active_module_definitions: countActiveTextualConventions(),
      searchable_records: 0
    }),
    notifications: Object.freeze({
      catalog_oid_nodes: catalogNotificationCount,
      supplemental_searchable_records: supplementalNotificationCount,
      searchable_records: catalogNotificationCount + supplementalNotificationCount
    })
  }),
  identity: Object.freeze({
    enterprise_records: ENTERPRISE_COUNT,
    sys_object_id_mappings: SYS_OBJECT_ID_COUNT,
    identity_release: IDENTITY_RELEASE,
    exact_models: IDENTITY_STATISTICS.exact_models,
    product_families: IDENTITY_STATISTICS.product_families,
    platforms: IDENTITY_STATISTICS.platforms,
    project_observation_oids: IDENTITY_STATISTICS.project_observation_oids,
    project_definition_oids: IDENTITY_STATISTICS.project_definition_oids,
    project_identity_oid_coverage: IDENTITY_STATISTICS.project_identity_oid_coverage
  }),
  sources: Object.freeze({
    total: sources.size,
    publication_modes: sourcePublicationModeCounts
  }),
  publication_controls: Object.freeze({
    event_count: publicationControlDocument.events.length,
    disabled_sources: publicationControls.disabledSources.size,
    disabled_modules: publicationControls.disabledModules.size,
    latest_event_sha256: publicationControlDocument.events.at(-1).event_sha256
  })
});

const byId = new Map(resolutionRecords.map((record) => [stableId(record), record]));
const duplicateRecordsByOid = new Map();
const byOid = new Map();
for (const record of resolutionRecords) {
  const current = byOid.get(record.oid);
  if (current) {
    const duplicates = duplicateRecordsByOid.get(record.oid) ?? [current];
    duplicates.push(record);
    duplicateRecordsByOid.set(record.oid, duplicates);
  }
  const recordPreferred = legacyStableIds.has(stableId(record));
  const currentPreferred = current ? legacyStableIds.has(stableId(current)) : false;
  if (!current || (record._catalog && !current._catalog) || (recordPreferred && !currentPreferred)) byOid.set(record.oid, record);
}

// These are explicit standards-root owners and the three source classes from
// the predecessor rights-cleared baseline. Publisher-name heuristics are
// intentionally forbidden: an arbitrary vendor module may repeat these OIDs.
const standardRootModulePriority = new Map([
  ["SNMPV2-SMI", 0],
  ["RFC1155-SMI", 1],
  ["RFC1065-SMI", 2],
  ["RFC1213-MIB", 3]
]);
const baselineSourcePriority = new Map([
  ["iana-maintained-mibs", 0],
  ["ietf-post-2008", 1],
  ["net-snmp", 2]
]);

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function navigationPreference(record, context) {
  const moduleName = record.module.toUpperCase();
  const sourceId = modules.get(moduleName)?.source_id ?? "";
  let category = 4;
  if (moduleName === context.moduleName) category = 0;
  else if (context.directImports.has(moduleName)) category = 1;
  else if (standardRootModulePriority.has(moduleName)) category = 2;
  else if (baselineSourcePriority.has(sourceId)) category = 3;
  return [
    category,
    standardRootModulePriority.get(moduleName) ?? Number.MAX_SAFE_INTEGER,
    baselineSourcePriority.get(sourceId) ?? Number.MAX_SAFE_INTEGER,
    record._catalog ? 0 : 1,
    moduleName,
    stableId(record)
  ];
}

function compareNavigationRecords(left, right, context) {
  const leftPreference = navigationPreference(left, context);
  const rightPreference = navigationPreference(right, context);
  for (let index = 0; index < 4; index += 1) {
    if (leftPreference[index] !== rightPreference[index]) return leftPreference[index] - rightPreference[index];
  }
  return lexicalCompare(leftPreference[4], rightPreference[4])
    || lexicalCompare(leftPreference[5], rightPreference[5]);
}

function selectNavigationRecord(oid, context) {
  const candidates = duplicateRecordsByOid.get(oid);
  if (!candidates) return byOid.get(oid) ?? null;
  let selected = null;
  for (const candidate of candidates) {
    if (!selected || compareNavigationRecords(candidate, selected, context) < 0) selected = candidate;
  }
  return selected;
}

const childrenByParentOid = new Map();
const parentOidByOid = new Map();
for (const record of byOid.values()) {
  const arcs = record.oid.split(".");
  let parentOid = null;
  for (let length = arcs.length - 1; length > 0; length -= 1) {
    const candidate = arcs.slice(0, length).join(".");
    if (byOid.has(candidate)) {
      parentOid = candidate;
      break;
    }
  }
  parentOidByOid.set(record.oid, parentOid);
  if (!parentOid) continue;
  const children = childrenByParentOid.get(parentOid) ?? [];
  children.push(record);
  childrenByParentOid.set(parentOid, children);
}
for (const children of childrenByParentOid.values()) {
  children.sort((left, right) => left.oid.localeCompare(right.oid, "en", { numeric: true }) || stableId(left).localeCompare(stableId(right)));
}

const descendantCountByOid = new Map();
function descendantCount(oid) {
  const cached = descendantCountByOid.get(oid);
  if (cached !== undefined) return cached;
  const count = (childrenByParentOid.get(oid) ?? []).reduce((total, child) => total + 1 + descendantCount(child.oid), 0);
  descendantCountByOid.set(oid, count);
  return count;
}

export function publicObject(record) {
  return record._catalog ? publicCatalogObject(record) : publicLegacyObject(record);
}

export function findObject(objectId) {
  const input = String(objectId);
  const arcs = parseOid(input);
  if (arcs) return byOid.get(arcs.join(".")) ?? null;
  return byId.get(input.toLowerCase()) ?? null;
}

export function objectNavigation(objectId, {
  childCursor = 0,
  childLimit = 50,
  subtreeDepth = 2,
  subtreeLimit = 100
} = {}) {
  const record = findObject(objectId);
  if (!record) return null;

  const moduleName = record.module.toUpperCase();
  const directImports = new Set(
    (modules.get(moduleName)?.dependencies ?? legacyModuleImports[moduleName] ?? [])
      .map((dependency) => dependency.toUpperCase())
  );
  const navigationContext = { moduleName, directImports };

  const ancestors = [];
  let ancestorOid = parentOidByOid.get(record.oid);
  while (ancestorOid) {
    const ancestor = selectNavigationRecord(ancestorOid, navigationContext);
    if (!ancestor) break;
    ancestors.push(publicObject(ancestor));
    ancestorOid = parentOidByOid.get(ancestorOid);
  }
  ancestors.reverse();

  const directChildren = childrenByParentOid.get(record.oid) ?? [];
  const totalDescendants = descendantCount(record.oid);
  const contextualRecord = (candidate) => selectNavigationRecord(candidate.oid, navigationContext) ?? candidate;
  const selectedChildren = directChildren
    .slice(childCursor, childCursor + childLimit)
    .map(contextualRecord)
    .map(publicObject);
  const queue = directChildren.map((child) => ({ record: contextualRecord(child), depth: 1 }));
  const nodes = [];
  let position = 0;
  while (position < queue.length && nodes.length < subtreeLimit) {
    const entry = queue[position];
    position += 1;
    if (entry.depth > subtreeDepth) continue;
    nodes.push({
      depth: entry.depth,
      direct_child_count: (childrenByParentOid.get(entry.record.oid) ?? []).length,
      object: publicObject(entry.record)
    });
    if (entry.depth < subtreeDepth) {
      for (const child of childrenByParentOid.get(entry.record.oid) ?? []) {
        queue.push({ record: contextualRecord(child), depth: entry.depth + 1 });
      }
    }
  }

  return {
    object: publicObject(record),
    ancestors,
    direct_children: {
      total: directChildren.length,
      cursor: childCursor,
      limit: childLimit,
      next_cursor: childCursor + childLimit < directChildren.length ? childCursor + childLimit : null,
      results: selectedChildren
    },
    subtree: {
      depth: subtreeDepth,
      limit: subtreeLimit,
      descendant_count: totalDescendants,
      returned_count: nodes.length,
      truncated: nodes.length < totalDescendants,
      nodes
    }
  };
}

function resolveRecord(input) {
  const arcs = parseOid(input);
  if (!arcs) return null;
  let exactStructuralRecord = null;
  for (let length = arcs.length; length > 0; length -= 1) {
    const record = byOid.get(arcs.slice(0, length).join("."));
    if (!record) continue;
    const instance = arcs.slice(length);
    const kind = record._catalog ? catalogObjectKind(record) : record.kind;
    if (instance.length === 0) {
      if (kind === "scalar" || kind === "column") return { arcs, record, instance };
      exactStructuralRecord = record;
      continue;
    }
    if ((kind === "scalar" && instance.length === 1 && instance[0] === 0) || (kind === "column" && instance.length >= 1)) {
      return { arcs, record, instance };
    }
  }
  if (exactStructuralRecord) return { arcs, record: exactStructuralRecord, instance: [] };
  return { arcs, record: null, instance: [] };
}

export function searchObjects(query) {
  const normalized = String(query).trim();
  if (!normalized) return [];
  if (/^\.?\d/.test(normalized)) {
    const resolved = resolveRecord(normalized);
    return resolved?.record ? [publicObject(resolved.record)] : [];
  }
  return rankSearchIndex(normalized, resolutionSearchIndex).map(({ record }) => publicObject(record));
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
  return deviceIdentityEngine.lookup(input);
}

export function assessDeviceIdentity(signals) {
  return deviceIdentityEngine.assess(signals);
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
    root_objects: moduleRootObjects.get(module.id.toUpperCase()) ?? [],
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function localLicense(module) {
  const source = allSources.get(module.source_id);
  const licenseFile = source?.license?.files?.[0];
  if (licenseFile) {
    const licenseRoot = path.resolve(projectRoot, "data", "mibs", "redistributable", "license-derived", source.id, "licenses");
    const absolute = path.resolve(licenseRoot, path.basename(licenseFile.source_path));
    if (!absolute.startsWith(`${licenseRoot}${path.sep}`)) throw new Error("License path escaped the approved directory");
    const bytes = readFileSync(absolute);
    if (sha256(bytes) !== licenseFile.sha256) throw new Error(`Retained license checksum drifted for ${source.id}`);
    return { bytes, source_path: licenseFile.source_path, sha256: licenseFile.sha256 };
  }
  if (module.source_id === "net-snmp") {
    const bytes = readFileSync(path.join(projectRoot, "data", "mibs", "redistributable", "net-snmp", "COPYING"));
    return { bytes, source_path: "COPYING", sha256: sha256(bytes) };
  }
  const notice = [
    `${module.license.name} (${module.license.spdx})`,
    `License terms: ${module.license.url}`,
    `Original source: ${module.source_url}`,
    "The exact MIB file in this archive retains its source notice. Keep this notice with redistributed copies.",
    ""
  ].join("\n");
  const bytes = Buffer.from(notice, "utf8");
  return { bytes, source_path: "generated-license-notice", sha256: sha256(bytes) };
}

export function rawModuleDistribution(moduleName) {
  const raw = rawModule(moduleName);
  if (!raw) return null;
  const module = findModule(moduleName);
  const license = localLicense(module);
  const mibName = `${module.id}.mib`;
  const provenance = Buffer.from(`${JSON.stringify({
    schema_version: 1,
    data_release: DATA_RELEASE,
    module: publicModule(module),
    files: {
      [mibName]: { sha256: module.artifact_sha256, role: "exact-source-artifact" },
      "LICENSE.txt": { sha256: license.sha256, role: "retained-license-or-notice", source_path: license.source_path }
    }
  }, null, 2)}\n`, "utf8");
  return {
    module: raw.module,
    entries: [
      { name: mibName, bytes: raw.bytes },
      { name: "LICENSE.txt", bytes: license.bytes },
      { name: "PROVENANCE.json", bytes: provenance }
    ]
  };
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
  const legacyModuleAvailable = publicationEnabledLegacyModuleNames.has(normalized);
  const direct = [...(catalogModule?.dependencies ?? (legacyModuleAvailable ? legacyModuleImports[normalized] : []) ?? [])].sort();
  if (!catalogModule && !legacyModuleAvailable) return null;
  const transitive = new Set();
  const cyclic = new Set();
  function imports(name) { return modules.get(name)?.dependencies ?? (publicationEnabledLegacyModuleNames.has(name) ? legacyModuleImports[name] : []) ?? []; }
  function present(name) { return modules.has(name) || publicationEnabledLegacyModuleNames.has(name); }
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
