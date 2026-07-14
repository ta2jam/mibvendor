export const MAX_WALK_BYTES = 10 * 1024 * 1024;
export const MAX_WALK_LINES = 50_000;

export function parseOid(value) {
  const text = String(value).trim().replace(/^\./, "");
  if (!/^\d+(?:\.\d+)*$/.test(text)) {
    return null;
  }

  const parts = text.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0 || part > 0xffffffff)) {
    return null;
  }

  return parts;
}

export function oidStartsWith(oid, prefix) {
  return prefix.length <= oid.length && prefix.every((part, index) => oid[index] === part);
}

export function resolveOid(oidText, records) {
  const oid = parseOid(oidText);
  if (!oid) {
    return null;
  }

  let best = null;
  for (const record of records) {
    const prefix = parseOid(record.oid);
    if (prefix && oidStartsWith(oid, prefix) && (!best || prefix.length > best.prefix.length)) {
      best = { record, prefix };
    }
  }

  if (!best) {
    return { oid, record: null, instance: [] };
  }

  return {
    oid,
    record: best.record,
    instance: oid.slice(best.prefix.length)
  };
}

function normalizeSearchText(value) {
  return String(value)
    .toLocaleLowerCase("en-US")
    .replace(/^\./, "")
    .replace(/::/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

export function rankSearchRecords(query, records) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }

  const numeric = parseOid(normalized);
  if (numeric) {
    const resolved = resolveOid(normalized, records);
    if (!resolved?.record) return [];
    return [{
      record: resolved.record,
      score: 100,
      matchKind: resolved.instance.length ? "numeric-instance" : "numeric-exact"
    }];
  }

  const tokens = normalized.split(/\s+/);
  return records
    .map((record) => {
      const symbol = normalizeSearchText(record.symbol);
      const module = normalizeSearchText(record.module);
      const intents = record.intent.map(normalizeSearchText);
      const haystack = normalizeSearchText([
        record.module,
        record.symbol,
        record.oid,
        record.kind,
        record.description,
        ...record.intent,
        ...record.related
      ].join(" "));

      let score = 0;
      let matchKind = "related";
      if (symbol === normalized) {
        score += 100;
        matchKind = "exact-symbol";
      }
      if (`${module} ${symbol}` === normalized) {
        score += 110;
        matchKind = "module-qualified";
      }
      if (symbol.includes(normalized)) {
        score += 50;
        if (matchKind === "related") matchKind = "symbol";
      }
      if (intents.includes(normalized)) {
        score += 80;
        if (matchKind === "related") matchKind = "task-intent";
      } else if (intents.some((intent) => intent.includes(normalized))) {
        score += 40;
        if (matchKind === "related") matchKind = "task-intent";
      }
      for (const token of tokens) {
        if (haystack.includes(token)) score += 10;
      }
      return { record, score, matchKind };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.record.oid.localeCompare(b.record.oid, "en", { numeric: true }))
    .slice(0, 20);
}

export function searchRecords(query, records) {
  return rankSearchRecords(query, records).map(({ record }) => record);
}

export function classifySearchQuery(query, records) {
  const text = String(query).trim();
  if (!text) return { state: "empty", matches: [], resolved: null };

  if (/^\.?\d/.test(text)) {
    const oid = parseOid(text);
    if (!oid) return { state: "invalid-oid", matches: [], resolved: null };
    const resolved = resolveOid(text, records);
    if (!resolved.record) return { state: "unknown-oid", matches: [], resolved };
    return {
      state: "matches",
      matches: [{
        record: resolved.record,
        score: 100,
        matchKind: resolved.instance.length ? "numeric-instance" : "numeric-exact"
      }],
      resolved
    };
  }

  const matches = rankSearchRecords(text, records);
  return {
    state: matches.length ? "matches" : "no-match",
    matches,
    resolved: null
  };
}

export function parseWalk(text, records, limits = {}) {
  const maxBytes = limits.maxBytes ?? MAX_WALK_BYTES;
  const maxLines = limits.maxLines ?? MAX_WALK_LINES;
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maxBytes) {
    throw new RangeError(`Walk text exceeds ${maxBytes} bytes`);
  }

  const lines = String(text).split(/\r?\n/);
  if (lines.length > maxLines) {
    throw new RangeError(`Walk text exceeds ${maxLines} lines`);
  }

  const rows = [];
  const errors = [];

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const match = line.match(/^\.?((?:\d+\.)*\d+)\s*(?:=|:)\s*(.*)$/);
    if (!match) {
      errors.push({ line: index + 1, reason: "Unsupported walk line", input: rawLine });
      return;
    }

    const resolved = resolveOid(match[1], records);
    if (!resolved) {
      errors.push({ line: index + 1, reason: "Invalid OID", input: rawLine });
      return;
    }

    const instance = resolved.instance.join(".") || (resolved.record?.kind === "scalar" ? "0" : "—");
    rows.push({
      line: index + 1,
      oid: resolved.oid.join("."),
      record: resolved.record,
      instance,
      group: resolved.record?.table ?? resolved.record?.parent ?? "Unresolved",
      value: match[2].trim()
    });
  });

  return {
    byteLength,
    lineCount: lines.length,
    rows,
    errors,
    resolvedCount: rows.filter((row) => row.record).length,
    unresolvedCount: rows.filter((row) => !row.record).length,
    groupCount: new Set(rows.map((row) => row.group)).size
  };
}
