import { createHash } from "node:crypto";

const RULES = Object.freeze([
  {
    id: "confidential-proprietary-claim",
    category: "confidentiality",
    pattern: /\b(?:confidential\s+and\s+proprietary|proprietary\s+and\s+confidential)\s+(?:information|material|intellectual\s+property)\b/giu
  },
  {
    id: "no-part-copy-use-or-distribution",
    category: "prohibited-use-or-redistribution",
    pattern: /\bno\s+part\s+of\s+(?:this|the)\s+(?:software|program|work|material|document|specification|file|mib|source\s+code)(?:\s+[a-z0-9]+){0,6}\s+may\s+be\s+(?:used|copied|reproduced|modified|published|uploaded|posted|transmitted|distributed|redistributed|disclosed)(?:\s+(?:or\s+)?(?:used|copied|reproduced|modified|published|uploaded|posted|transmitted|distributed|redistributed|disclosed))*/giu
  },
  {
    id: "artifact-may-not-be-copied-or-distributed",
    category: "prohibited-use-or-redistribution",
    pattern: /\b(?:this|the)\s+(?:software|program|work|material|document|specification|file|mib|source\s+code)(?:\s+[a-z0-9]+){0,4}\s+may\s+not\s+be\s+(?:used|copied|reproduced|published|transmitted|distributed|redistributed|disclosed)\b/giu
  },
  {
    id: "do-not-copy-or-distribute-artifact",
    category: "prohibited-use-or-redistribution",
    pattern: /\bdo\s+not\s+(?:copy|reproduce|publish|transmit|distribute|redistribute|disclose)\s+(?:this|the)\s+(?:software|program|work|material|document|specification|file|mib|source\s+code)\b/giu
  },
  {
    id: "unauthorized-copy-or-distribution-prohibited",
    category: "prohibited-use-or-redistribution",
    pattern: /\bunauthorized\s+(?:copying|reproduction|publication|transmission|distribution|redistribution|disclosure)(?:\s+(?:or|and)\s+(?:copying|reproduction|publication|transmission|distribution|redistribution|disclosure))*\s+(?:is|are)\s+(?:strictly\s+)?(?:prohibited|forbidden)\b/giu
  },
  {
    id: "restricted-audience-only",
    category: "restricted-audience",
    pattern: /\b(?:not\s+for\s+(?:public|external)\s+(?:use|distribution|disclosure)|for\s+(?:internal|authorized)\s+use\s+only)\b/giu
  }
]);

export const ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION = 1;
export const ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION = "UTF-8 text; CRLF and CR normalized to LF; SHA-256 covers the exact full matched line span without a terminal newline";
export const ARTIFACT_RESTRICTIVE_NOTICE_RULE_IDS = Object.freeze(RULES.map((rule) => rule.id));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedLine(line) {
  return line.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, " ").trim();
}

function lineIndexAt(offsets, offset) {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

export function scanArtifactRestrictiveNotices(text) {
  if (typeof text !== "string") throw new TypeError("artifact text must be a string");
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const offsets = [];
  let searchable = "";
  for (const line of lines) {
    offsets.push(searchable.length);
    searchable += `${normalizedLine(line)}\n`;
  }

  const findings = [];
  const seen = new Set();
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of searchable.matchAll(rule.pattern)) {
      const lineStartIndex = lineIndexAt(offsets, match.index);
      const lineEndIndex = lineIndexAt(offsets, match.index + Math.max(0, match[0].length - 1));
      const key = `${rule.id}\0${lineStartIndex}\0${lineEndIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const excerpt = lines.slice(lineStartIndex, lineEndIndex + 1).join("\n");
      findings.push({
        rule_id: rule.id,
        category: rule.category,
        line_start: lineStartIndex + 1,
        line_end: lineEndIndex + 1,
        excerpt_sha256: sha256(excerpt)
      });
    }
  }
  return findings.sort((left, right) => left.line_start - right.line_start
    || left.line_end - right.line_end
    || left.rule_id.localeCompare(right.rule_id));
}
