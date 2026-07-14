import { readFileSync } from "node:fs";

import { records } from "../prototype/data.mjs";
import { parseOid, resolveOid, searchRecords } from "../prototype/core.mjs";

const penDocument = JSON.parse(readFileSync(
  new URL("../data/iana-private-enterprise-numbers.json", import.meta.url),
  "utf8"
));
const enterprises = new Map(penDocument.records);
delete penDocument.records;

export const DATA_RELEASE = "alpha-intelligence-2026-07-14.1";
export const ENTERPRISE_COUNT = enterprises.size;
export const IANA_PEN_SOURCE = Object.freeze({
  url: penDocument.source_url,
  updated: penDocument.source_updated,
  retrieved_at: penDocument.retrieved_at,
  sha256: penDocument.source_sha256,
  rights: penDocument.rights
});

const netSnmpPlatforms = [
  [1, "HP-UX 9"],
  [2, "SunOS 4"],
  [3, "Solaris"],
  [4, "OSF/1"],
  [5, "Ultrix"],
  [6, "HP-UX 10"],
  [7, "NetBSD"],
  [8, "FreeBSD"],
  [9, "IRIX"],
  [10, "Linux"],
  [11, "BSD/OS"],
  [12, "OpenBSD"],
  [13, "Windows"],
  [14, "HP-UX 11"],
  [15, "AIX"],
  [16, "macOS"],
  [17, "DragonFly BSD"],
  [255, "Unknown platform"]
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
      source_url: "https://github.com/net-snmp/net-snmp/blob/ebe576ae028a25bd706c86125f7b737cf5173d69/mibs/NET-SNMP-TC.txt",
      source_revision: "ebe576ae028a25bd706c86125f7b737cf5173d69",
      rights: "BSD-family",
      checked_at: "2026-07-14"
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

const moduleImports = Object.freeze({
  "IF-MIB": ["SNMPv2-SMI", "SNMPv2-TC", "SNMPv2-CONF"],
  "SNMPv2-MIB": ["SNMPv2-SMI", "SNMPv2-TC", "SNMPv2-CONF"],
  "HOST-RESOURCES-MIB": ["SNMPv2-SMI", "SNMPv2-TC", "SNMPv2-CONF"],
  "SNMPv2-SMI": [],
  "SNMPv2-TC": ["SNMPv2-SMI"],
  "SNMPv2-CONF": ["SNMPv2-SMI"]
});

const presentModules = new Set(records.map((record) => record.module));

export function stableId(record) {
  return `${record.module.toLowerCase()}--${record.symbol.toLowerCase()}`;
}

export function publicObject(record) {
  return {
    id: stableId(record),
    module: record.module,
    symbol: record.symbol,
    oid: record.oid,
    kind: record.kind,
    syntax: {
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
    description: {
      status: "available",
      text: record.description
    },
    revision: record.revision,
    relationships: {
      parent: record.parent,
      table: record.table,
      row: record.row,
      indexes: record.index ? [record.index] : [],
      augments: null,
      notification_objects: record.notificationObjects
    },
    provenance: {
      source: record.source,
      source_url: record.sourceUrl,
      source_checked: record.sourceChecked,
      parse_status: record.parseStatus,
      publication_status: record.publicationStatus,
      rights_tier: "A",
      scopes: record.rightsScopes
    }
  };
}

export function findObject(objectId) {
  return records.find((record) => stableId(record) === objectId) ?? null;
}

export function searchObjects(query) {
  return searchRecords(query, records).slice(0, 20).map(publicObject);
}

export function resolveObject(input) {
  const resolved = resolveOid(input, records);
  if (!resolved) return { input, status: "invalid" };
  if (!resolved.record) return { input, status: "not_found" };
  return {
    input,
    status: "resolved",
    object: publicObject(resolved.record),
    instance_suffix: resolved.instance
  };
}

export function lookupEnterprise(number) {
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) return null;
  const organization = enterprises.get(number);
  if (!organization) return null;
  return {
    number,
    oid: `1.3.6.1.4.1.${number}`,
    organization,
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
  if (!underEnterprise || arcs.length <= enterprisePrefix.length) {
    return { input, normalized_oid: normalized, status: "not_found", enterprise: null, match: null };
  }

  const enterprise = lookupEnterprise(arcs[enterprisePrefix.length]);
  const match = sysObjectIds.get(normalized) ?? null;
  if (match) {
    return {
      input,
      normalized_oid: normalized,
      status: "resolved",
      enterprise,
      match,
      caveat: "This identifies the agent platform declared by the exact OID, not the hardware model or current firmware."
    };
  }
  const rightsRestriction = restrictedEnterpriseSources.get(arcs[enterprisePrefix.length]);
  if (enterprise && rightsRestriction) {
    return {
      input,
      normalized_oid: normalized,
      status: "unavailable_due_to_rights",
      enterprise,
      match: null,
      rights: rightsRestriction,
      caveat: "The PEN registry assignment is visible, but exact product or model data is withheld under the source-specific publication policy."
    };
  }
  if (enterprise) {
    return {
      input,
      normalized_oid: normalized,
      status: "enterprise_only",
      enterprise,
      match: null,
      caveat: "Only the PEN registry boundary is known. No product or model identity is asserted for this OID."
    };
  }
  return { input, normalized_oid: normalized, status: "not_found", enterprise: null, match: null };
}

export function moduleDependencies(moduleName) {
  const normalized = String(moduleName).toUpperCase();
  if (!presentModules.has(normalized)) return null;
  const direct = [...(moduleImports[normalized] ?? [])].sort();
  const transitive = new Set();
  const cyclic = new Set();

  function visit(current, path) {
    for (const dependency of moduleImports[current] ?? []) {
      if (path.includes(dependency)) {
        cyclic.add([...path.slice(path.indexOf(dependency)), dependency].join(" -> "));
        continue;
      }
      if (!direct.includes(dependency)) transitive.add(dependency);
      visit(dependency, [...path, dependency]);
    }
  }
  visit(normalized, [normalized]);

  const closure = [...new Set([...direct, ...transitive])].sort();
  return {
    module: normalized,
    status: closure.some((dependency) => !presentModules.has(dependency)) ? "partial" : "complete",
    direct,
    transitive: [...transitive].sort(),
    missing: closure.filter((dependency) => !presentModules.has(dependency)),
    cyclic: [...cyclic].sort(),
    diagnostics: closure.some((dependency) => !presentModules.has(dependency))
      ? ["Dependency names are known, but one or more imported modules are not included in this public alpha data release."]
      : []
  };
}

export const objectRecords = records;
