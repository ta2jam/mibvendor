import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const outputRoot = path.join(root, "data", "mibs", "redistributable");
const manifestPath = path.join(root, "data", "mib-catalog.json");
const objectPath = path.join(root, "data", "mib-objects.json");
const sourceCatalogPath = path.join(root, "data", "source-catalog.json");
const rightsMatrixPath = path.join(root, "docs", "research", "rights", "rights-matrix.csv");
const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const IETF_INDEX_URL = "https://www.rfc-editor.org/rfc-index.xml";
const IANA_PROTOCOLS_URL = "https://www.iana.org/protocols?level=1";
const IANA_LICENSE_URL = "https://www.iana.org/help/licensing-terms";
const IETF_LICENSE_URL = "https://trustee.ietf.org/documents/trust-legal-provisions/tlp-5/";
const NET_SNMP_TAG = "v5.9.5.2";
const NET_SNMP_COMMIT = "319bbd0bb36547992c0e1302fef278c6f49d0c80";
const NET_SNMP_LICENSE_URL = `https://github.com/net-snmp/net-snmp/blob/${NET_SNMP_COMMIT}/COPYING`;
const NET_SNMP_FILES = [
  "LM-SENSORS-MIB.txt",
  "NET-SNMP-AGENT-MIB.txt",
  "NET-SNMP-EXAMPLES-MIB.txt",
  "NET-SNMP-EXTEND-MIB.txt",
  "NET-SNMP-MIB.txt",
  "NET-SNMP-MONITOR-MIB.txt",
  "NET-SNMP-PASS-MIB.txt",
  "NET-SNMP-PERIODIC-NOTIFY-MIB.txt",
  "NET-SNMP-SYSTEM-MIB.txt",
  "NET-SNMP-TC.txt",
  "NET-SNMP-VACM-MIB.txt",
  "UCD-DEMO-MIB.txt",
  "UCD-DISKIO-MIB.txt",
  "UCD-DLMOD-MIB.txt",
  "UCD-IPFILTER-MIB.txt",
  "UCD-IPFWACC-MIB.txt",
  "UCD-SNMP-MIB-OLD.txt",
  "UCD-SNMP-MIB.txt"
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function xmlText(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function element(block, name) {
  return xmlText(block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1] ?? "");
}

async function fetchBytes(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "mibvendor-data-pipeline/1.0 (+https://mibvendor.io)" },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`Could not fetch ${url}: ${lastError.message}`);
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

export function moduleName(text) {
  return text.match(/^\s*([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS(?:\s+IMPLICIT\s+TAGS)?\s*::=\s*BEGIN/m)?.[1] ?? null;
}

function extractRfcModules(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const modules = [];
  let current = null;
  let collecting = false;
  let inMacro = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, "");
    const start = line.match(/^\s*([A-Za-z0-9-]+)\s+DEFINITIONS(?:\s+IMPLICIT\s+TAGS)?\s*::=\s*BEGIN\s*$/);
    if (start) {
      current = { name: start[1], lines: [line], skippedHeader: false };
      collecting = true;
      inMacro = false;
      continue;
    }
    if (!current) continue;
    if (/\[Page\s+[iv0-9]+\]/.test(line)) {
      collecting = false;
      current.skippedHeader = false;
      continue;
    }
    if (!collecting) {
      if (!line.trim() || line.includes("\f")) continue;
      if (!current.skippedHeader) {
        current.skippedHeader = true;
        continue;
      }
      collecting = true;
    }
    if (!line.trim()) {
      if (current.lines.at(-1) !== "") current.lines.push("");
      continue;
    }
    current.lines.push(line);
    if (/\bMACRO\s*::=/.test(line)) inMacro = true;
    if (/^\s*END\s*$/.test(line)) {
      if (inMacro) {
        inMacro = false;
      } else {
        const nonBlank = current.lines.filter((candidate) => candidate.trim());
        const indentation = Math.min(...nonBlank.map((candidate) => candidate.match(/^ */)[0].length));
        const content = `${current.lines.map((candidate) => candidate.slice(indentation)).join("\n").trim()}\n`;
        modules.push({ name: current.name, content });
        current = null;
        collecting = false;
      }
    }
  }
  return modules;
}

function ietfNotice(rfcNumber, year) {
  return `-- mibvendor redistribution notice\n-- Derived from IETF RFC ${rfcNumber}. Please retain this notice.\n-- Copyright (c) ${year} IETF Trust and the persons identified as the\n-- document authors. All rights reserved.\n-- Redistribution and use in source and binary forms, with or without\n-- modification, are permitted provided that the following conditions are met:\n-- 1. Redistributions of source code must retain the copyright notice, this\n--    list of conditions and the following disclaimer.\n-- 2. Redistributions in binary form must reproduce the copyright notice, this\n--    list of conditions and the following disclaimer in the documentation\n--    and/or other materials provided with the distribution.\n-- 3. Neither the name of Internet Society, IETF or IETF Trust, nor the names\n--    of specific contributors, may be used to endorse or promote products\n--    derived from this software without specific prior written permission.\n-- THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS\n-- AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED. See the complete\n-- Revised BSD terms at ${IETF_LICENSE_URL}\n\n`;
}

export function importsFor(text) {
  const body = text.match(/\bIMPORTS\b([\s\S]*?);/)?.[1] ?? "";
  return [...new Set([...body.matchAll(/\bFROM\s+([A-Za-z][A-Za-z0-9-]*)/g)].map((match) => match[1]))].sort();
}

function firstDescription(block) {
  const marker = block.search(/\bDESCRIPTION\b/);
  if (marker < 0) return null;
  const start = block.indexOf('"', marker);
  if (start < 0) return null;
  let value = "";
  for (let index = start + 1; index < block.length; index += 1) {
    if (block[index] !== '"') {
      value += block[index];
      continue;
    }
    if (block[index + 1] === '"') {
      value += '"';
      index += 1;
      continue;
    }
    return value.replace(/\s+/g, " ").trim();
  }
  return null;
}

function parseRevision(text) {
  const timestamp = text.match(/\bREVISION\s+"(\d{8})\d*Z?"/)?.[1];
  return timestamp ? `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}` : null;
}

export function parseDefinitions(text, module) {
  const reservedSymbols = new Set(["ACCESS", "AUGMENTS", "DEFVAL", "DESCRIPTION", "INDEX", "MAX-ACCESS", "MIN-ACCESS", "REFERENCE", "STATUS", "SYNTAX", "UNITS"]);
  const starts = [...text.matchAll(/^\s*([A-Za-z][A-Za-z0-9-]*)\s+(MODULE-IDENTITY|OBJECT-TYPE|OBJECT\s+IDENTIFIER|OBJECT-IDENTITY|NOTIFICATION-TYPE)\b/gm)];
  return starts.map((match, index) => {
    const block = text.slice(match.index, starts[index + 1]?.index ?? text.length);
    const assignment = block.match(/::=\s*\{\s*([^}]+)\}/s)?.[1]
      ?.replace(/--[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!assignment) return null;
    const tokens = assignment.split(" ");
    const final = tokens.at(-1);
    const arc = Number(final.match(/(?:\(|^)(\d+)\)?$/)?.[1]);
    const parent = tokens.at(-2)?.replace(/\(\d+\)$/, "") ?? null;
    if (!parent || !Number.isSafeInteger(arc)) return null;
    const syntax = block.match(/\bSYNTAX\s+([\s\S]*?)(?=\n\s*(?:MAX-ACCESS|MIN-ACCESS|ACCESS|STATUS|DESCRIPTION|REFERENCE|INDEX|AUGMENTS|DEFVAL|::=))/)?.[1]
      ?.replace(/--[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? null;
    const enums = {};
    if (syntax) {
      for (const item of syntax.matchAll(/\b([A-Za-z][A-Za-z0-9-]*)\s*\(\s*(-?\d+)\s*\)/g)) enums[item[2]] = item[1];
    }
    return {
      module,
      symbol: match[1],
      kind: match[2].replace(/\s+/g, " ").toLowerCase().replaceAll(" ", "-"),
      parent,
      arc,
      syntax,
      access: block.match(/\b(?:MAX-ACCESS|ACCESS)\s+([A-Za-z-]+)/)?.[1] ?? null,
      status: block.match(/\bSTATUS\s+([A-Za-z-]+)/)?.[1] ?? null,
      description: firstDescription(block),
      enums,
      oid: null,
      oid_resolution: "unresolved"
    };
  }).filter((object) => object && !reservedSymbols.has(object.symbol));
}

export function parseTextualConventions(text, module) {
  const starts = [...text.matchAll(/^[ \t]*([A-Za-z][A-Za-z0-9-]*)\s*::=\s*TEXTUAL-CONVENTION\b/gm)];
  const definitionCandidates = [...text.matchAll(/^[ \t]*[A-Za-z][A-Za-z0-9-]*\s+(?:(?:MODULE-IDENTITY|OBJECT-TYPE|OBJECT-IDENTITY|NOTIFICATION-TYPE|NOTIFICATION-GROUP|OBJECT-GROUP|MODULE-COMPLIANCE|AGENT-CAPABILITIES|TRAP-TYPE)\b|OBJECT\s+IDENTIFIER\s*::=|::=\s*TEXTUAL-CONVENTION\b)/gm)];
  const definitionStarts = definitionCandidates.filter((candidate, index) => {
    if (/::=\s*TEXTUAL-CONVENTION\b/.test(candidate[0])) return true;
    const block = text.slice(candidate.index, definitionCandidates[index + 1]?.index ?? text.length);
    return /::=\s*\{/.test(block);
  }).map((match) => match.index);
  return starts.map((match) => {
    const nextDefinition = definitionStarts.find((offset) => offset > match.index);
    const block = text.slice(match.index, nextDefinition ?? text.length);
    const syntaxMarker = [...block.matchAll(/\bSYNTAX[ \t]+/g)].at(-1);
    const syntax = syntaxMarker
      ? block.slice(syntaxMarker.index + syntaxMarker[0].length).replace(/\n[ \t]*END\b[\s\S]*$/, "").replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim()
      : null;
    return {
      module,
      symbol: match[1],
      kind: "textual-convention",
      syntax,
      status: block.match(/^\s*STATUS\s+([A-Za-z-]+)/m)?.[1] ?? null,
      description: firstDescription(block),
      display_hint: block.match(/^\s*DISPLAY-HINT\s+"([^"]*)"/m)?.[1] ?? null
    };
  });
}

export function parseMacros(text, module) {
  return [...text.matchAll(/^[ \t]*([A-Za-z][A-Za-z0-9-]*)\s+MACRO\s*::=\s*BEGIN\b/gm)].map((match) => ({
    module,
    symbol: match[1],
    kind: "macro"
  }));
}

export function resolveObjects(parsedModules, rawDirectories, { externalObjects = [], useNetSnmp = true } = {}) {
  const seeds = new Map([
    ["iso", "1"], ["org", "1.3"], ["dod", "1.3.6"], ["internet", "1.3.6.1"],
    ["directory", "1.3.6.1.1"], ["mgmt", "1.3.6.1.2"], ["mib-2", "1.3.6.1.2.1"],
    ["transmission", "1.3.6.1.2.1.10"], ["experimental", "1.3.6.1.3"],
    ["mplsStdMIB", "1.3.6.1.2.1.10.166"],
    ["private", "1.3.6.1.4"], ["enterprises", "1.3.6.1.4.1"], ["security", "1.3.6.1.5"],
    ["snmpV2", "1.3.6.1.6"], ["snmpDomains", "1.3.6.1.6.1"],
    ["snmpProxys", "1.3.6.1.6.2"], ["snmpModules", "1.3.6.1.6.3"], ["zeroDotZero", "0.0"]
  ]);
  const all = parsedModules.flatMap((item) => item.objects);
  const bySymbol = new Map();
  for (const object of [...all, ...externalObjects]) {
    const values = bySymbol.get(object.symbol) ?? [];
    values.push(object);
    bySymbol.set(object.symbol, values);
  }
  for (let pass = 0; pass < all.length; pass += 1) {
    let changed = false;
    for (const object of all.filter((candidate) => !candidate.oid)) {
      const local = bySymbol.get(object.parent)?.filter((candidate) => candidate.module === object.module && candidate.oid) ?? [];
      const global = bySymbol.get(object.parent)?.filter((candidate) => candidate.oid) ?? [];
      const parentOids = new Set((local.length ? local : global).map((candidate) => candidate.oid));
      const seed = seeds.get(object.parent);
      if (seed) parentOids.add(seed);
      if (parentOids.size !== 1) continue;
      object.oid = `${[...parentOids][0]}.${object.arc}`;
      object.oid_resolution = "source-graph";
      changed = true;
    }
    if (!changed) break;
  }

  if (useNetSnmp) try {
    const output = execFileSync("snmptranslate", ["-Tz"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        MIBDIRS: [...rawDirectories, "/usr/local/share/snmp/mibs", "/usr/share/snmp/mibs"].join(":"),
        MIBS: "ALL"
      },
      stdio: ["ignore", "pipe", "ignore"]
    });
    const translated = new Map();
    for (const match of output.matchAll(/^"([^"]+)"\s+"(\d+(?:\.\d+)*)"/gm)) {
      const values = translated.get(match[1]) ?? new Set();
      values.add(match[2]);
      translated.set(match[1], values);
    }
    for (const object of all.filter((candidate) => !candidate.oid)) {
      const values = translated.get(object.symbol);
      if (values?.size !== 1) continue;
      object.oid = [...values][0];
      object.oid_resolution = "net-snmp-enrichment";
    }
  } catch {
    // The source graph remains authoritative when Net-SNMP is unavailable.
  }

  return all.filter((object) => object.oid).map((object) => ({
    id: `${object.module.toLowerCase()}--${object.symbol.toLowerCase()}`,
    module: object.module,
    symbol: object.symbol,
    oid: object.oid,
    kind: object.kind,
    syntax: object.syntax,
    access: object.access,
    status: object.status,
    description: object.description,
    enums: object.enums,
    parent: object.parent,
    oid_resolution: object.oid_resolution
  })).sort((left, right) => left.oid.localeCompare(right.oid, "en", { numeric: true }) || left.id.localeCompare(right.id));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (char === "\n" && !quoted) {
      row.push(field.replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function publicSourceCatalog(rightsRows) {
  return rightsRows.map((row) => {
    const redistributable = ["metadata_index", "rendered_text", "api_output", "raw_download", "bulk_export"]
      .every((scope) => row[scope] === "approved");
    const metadataOnly = row.metadata_index === "approved" && row.api_output === "approved" && row.raw_download !== "approved";
    return {
      id: row.source_id,
      publisher: row.source_vendor,
      official_source_url: row.official_url,
      rights_evidence_url: row.rights_url,
      checked_at: row.checked_date,
      publication_mode: redistributable ? "redistributable" : metadataOnly ? "metadata-only" : "directory-only",
      content_intake: redistributable || metadataOnly ? "approved" : "quarantine",
      scopes: {
        metadata_index: row.metadata_index,
        rendered_text: row.rendered_text,
        api_output: row.api_output,
        raw_download: row.raw_download,
        bulk_export: row.bulk_export
      },
      public_fields: redistributable
        ? ["module", "oid", "symbol", "syntax", "access", "description", "source_url", "checksum", "raw_file"]
        : metadataOnly
          ? ["module", "oid", "symbol", "syntax", "access", "source_url", "source_checksum"]
          : ["publisher", "official_source_url", "rights_state"],
      reason: row.rights_evidence
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

async function main() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const [rfcIndexBytes, ianaProtocolsBytes, rightsMatrix] = await Promise.all([
    fetchBytes(IETF_INDEX_URL),
    fetchBytes(IANA_PROTOCOLS_URL),
    readFile(rightsMatrixPath, "utf8")
  ]);
  const rfcIndex = rfcIndexBytes.toString("utf8");
  const candidates = [...rfcIndex.matchAll(/<rfc-entry>([\s\S]*?)<\/rfc-entry>/g)].map((match) => {
    const block = match[1];
    const date = block.match(/<date>([\s\S]*?)<\/date>/)?.[1] ?? "";
    return {
      number: Number(element(block, "doc-id").replace(/^RFC/, "")),
      title: element(block, "title"),
      abstract: element(block, "abstract"),
      stream: element(block, "stream"),
      year: Number(element(date, "year"))
    };
  }).filter((rfc) => rfc.year >= 2009
    && rfc.stream === "IETF"
    && /\bMIB\b|Management Information Base|Managed Objects/i.test(`${rfc.title} ${rfc.abstract}`));

  const reviewedRfcs = await mapLimit(candidates, 10, async (rfc) => {
    const url = `https://www.rfc-editor.org/rfc/rfc${rfc.number}.txt`;
    const bytes = await fetchBytes(url);
    const text = bytes.toString("utf8");
    const hasCodeLicense = /Code Components extracted from this document must/.test(text)
      && /include\s+(?:Simplified|Revised) BSD License text/.test(text);
    const hasPre5378Restriction = /may contain material from IETF Documents or IETF Contributions published or made publicly available before November 10, 2008/i.test(text);
    return {
      ...rfc,
      url,
      sourceSha256: sha256(bytes),
      eligibility: hasCodeLicense && !hasPre5378Restriction ? "approved" : "quarantine",
      exclusion_reason: !hasCodeLicense ? "missing-code-component-license-notice" : hasPre5378Restriction ? "pre-5378-restriction-legend" : null,
      modules: extractRfcModules(text)
    };
  });
  const rfcResults = reviewedRfcs.filter((rfc) => rfc.eligibility === "approved");

  const ietfModules = new Map();
  for (const rfc of rfcResults) {
    for (const module of rfc.modules) {
      const current = ietfModules.get(module.name);
      if (!current || current.number < rfc.number) ietfModules.set(module.name, { ...rfc, ...module });
    }
  }

  const ianaLinks = [...new Set([...ianaProtocolsBytes.toString("utf8").matchAll(/href="(\/assignments\/[^"?]+-mib\/[^"?]+-mib)\.xhtml"/gi)]
    .map((match) => match[1]))].sort();
  if (ianaLinks.length !== 20) throw new Error(`Expected 20 IANA-maintained MIB links, found ${ianaLinks.length}`);
  const ianaModules = await mapLimit(ianaLinks, 8, async (relativeUrl) => {
    const sourceUrl = `https://www.iana.org${relativeUrl}`;
    const bytes = await fetchBytes(sourceUrl);
    const text = bytes.toString("utf8");
    const name = moduleName(text);
    if (!name) throw new Error(`No MIB module found at ${sourceUrl}`);
    return { name, bytes, text, sourceUrl, sourceSha256: sha256(bytes) };
  });

  const netSnmpBase = `https://raw.githubusercontent.com/net-snmp/net-snmp/${NET_SNMP_COMMIT}`;
  const [netSnmpLicense, netSnmpModules] = await Promise.all([
    fetchBytes(`${netSnmpBase}/COPYING`),
    mapLimit(NET_SNMP_FILES, 8, async (file) => {
      const sourceUrl = `${netSnmpBase}/mibs/${file}`;
      const bytes = await fetchBytes(sourceUrl);
      const text = bytes.toString("utf8");
      const name = moduleName(text);
      if (!name) throw new Error(`No MIB module found at ${sourceUrl}`);
      return { name, file, bytes, text, sourceUrl, sourceSha256: sha256(bytes) };
    })
  ]);

  const sourceByModule = new Map();
  for (const module of ietfModules.values()) {
    const content = Buffer.from(`${ietfNotice(module.number, module.year)}${module.content}`, "utf8");
    sourceByModule.set(module.name, {
      name: module.name,
      publisher: "IETF",
      sourceId: "ietf-post-2008",
      sourceUrl: module.url,
      sourceRevision: `RFC ${module.number}`,
      sourceSha256: module.sourceSha256,
      bytes: content,
      licenseSpdx: "BSD-3-Clause",
      licenseName: "IETF Trust Revised BSD License",
      licenseUrl: IETF_LICENSE_URL
    });
  }
  for (const module of ianaModules) {
    sourceByModule.set(module.name, {
      name: module.name,
      publisher: "IANA",
      sourceId: "iana-maintained-mibs",
      sourceUrl: module.sourceUrl,
      sourceRevision: `retrieved ${retrievedAt.slice(0, 10)}`,
      sourceSha256: module.sourceSha256,
      bytes: module.bytes,
      licenseSpdx: "CC0-1.0",
      licenseName: "IANA Protocol Registries CC0 1.0",
      licenseUrl: IANA_LICENSE_URL
    });
  }
  for (const module of netSnmpModules) {
    sourceByModule.set(module.name, {
      name: module.name,
      publisher: "Net-SNMP",
      sourceId: "net-snmp",
      sourceUrl: module.sourceUrl,
      sourceRevision: `${NET_SNMP_TAG} (${NET_SNMP_COMMIT})`,
      sourceSha256: module.sourceSha256,
      bytes: module.bytes,
      licenseSpdx: "LicenseRef-Net-SNMP",
      licenseName: "Net-SNMP BSD-family notices",
      licenseUrl: NET_SNMP_LICENSE_URL
    });
  }

  const parsedModules = [];
  const manifestModules = [];
  for (const source of [...sourceByModule.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const directory = path.join(outputRoot, source.sourceId);
    await mkdir(directory, { recursive: true });
    const file = `${source.name}.mib`;
    const absolutePath = path.join(directory, file);
    await writeFile(absolutePath, source.bytes);
    const text = source.bytes.toString("utf8");
    const objects = parseDefinitions(text, source.name);
    const dependencies = importsFor(text);
    parsedModules.push({ module: source.name, objects });
    manifestModules.push({
      id: source.name,
      publisher: source.publisher,
      source_id: source.sourceId,
      publication_mode: "redistributable",
      raw_download: true,
      source_url: source.sourceUrl,
      source_revision: source.sourceRevision,
      source_sha256: source.sourceSha256,
      artifact_sha256: sha256(source.bytes),
      raw_path: path.relative(path.join(root, "data"), absolutePath),
      license: { spdx: source.licenseSpdx, name: source.licenseName, url: source.licenseUrl, notice_required: true },
      revision: parseRevision(text),
      dependencies,
      declared_oid_count: objects.length,
      resolved_oid_count: 0
    });
  }
  await writeFile(path.join(outputRoot, "net-snmp", "COPYING"), netSnmpLicense);

  const rawDirectories = [...new Set(manifestModules.map((module) => path.dirname(path.join(root, "data", module.raw_path))))];
  const objects = resolveObjects(parsedModules, rawDirectories);
  const objectCounts = new Map();
  for (const object of objects) objectCounts.set(object.module, (objectCounts.get(object.module) ?? 0) + 1);
  for (const module of manifestModules) module.resolved_oid_count = objectCounts.get(module.id) ?? 0;

  const rightsRows = parseCsv(rightsMatrix);
  const sources = publicSourceCatalog(rightsRows);
  const countsByPublisher = Object.fromEntries(["IETF", "IANA", "Net-SNMP"].map((publisher) => [publisher, manifestModules.filter((module) => module.publisher === publisher).length]));
  const catalog = {
    schema_version: 1,
    data_release: "rights-cleared-2026-07-14.1",
    generated_at: retrievedAt,
    policy: "fail-closed",
    inventory_scope: "All modules extracted from post-2008 IETF-stream RFCs whose RFC-index title or abstract identifies MIB/managed-object content, all 20 IANA-maintained MIB registry files linked by the IANA protocol index, and all Net-SNMP/UCD/LM-Sensors project MIB files in the pinned Net-SNMP release. IANA current files supersede same-name RFC extracts.",
    source_snapshots: {
      ietf_rfc_index: {
        url: IETF_INDEX_URL,
        sha256: sha256(rfcIndexBytes),
        candidate_rfc_count: candidates.length,
        approved_rfc_count: rfcResults.length,
        quarantined_rfcs: reviewedRfcs.filter((rfc) => rfc.eligibility === "quarantine").map((rfc) => ({ rfc: rfc.number, reason: rfc.exclusion_reason }))
      },
      iana_protocol_index: { url: IANA_PROTOCOLS_URL, sha256: sha256(ianaProtocolsBytes), linked_mib_count: ianaLinks.length },
      net_snmp: { tag: NET_SNMP_TAG, commit: NET_SNMP_COMMIT, license_sha256: sha256(netSnmpLicense) }
    },
    counts: {
      modules: manifestModules.length,
      resolved_objects: objects.length,
      publishers: countsByPublisher,
      publication_modes: { redistributable: manifestModules.length, "metadata-only": 0, "directory-only": sources.filter((source) => source.publication_mode === "directory-only").length }
    },
    modules: manifestModules
  };
  await writeFile(manifestPath, `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(objectPath, `${JSON.stringify({ schema_version: 1, data_release: catalog.data_release, objects }, null, 2)}\n`);
  await writeFile(sourceCatalogPath, `${JSON.stringify({ schema_version: 1, data_release: catalog.data_release, sources }, null, 2)}\n`);
  console.log(JSON.stringify(catalog.counts));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) await main();
