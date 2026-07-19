import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import {
  MAX_SEARCH_RESULTS,
  createSearchIndex,
  rankSearchIndex
} from "../prototype/core.mjs";

const execFileAsync = promisify(execFile);

function normalizeSearchText(value) {
  return String(value)
    .toLocaleLowerCase("en-US")
    .replace(/^\./, "")
    .replace(/::/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

function referenceRankSearchIndex(query, index) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/);
  return index.documents
    .map(({ record, symbol, module, intents, haystack }) => {
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
    .sort((left, right) => right.score - left.score
      || left.record.oid.localeCompare(right.record.oid, "en", { numeric: true }))
    .slice(0, MAX_SEARCH_RESULTS);
}

function syntheticRecords(count) {
  return Array.from({ length: count }, (_, sequence) => {
    const tie = sequence < 64;
    return {
      sequence,
      module: tie ? "TIE-MIB" : sequence % 23 === 0 ? "TARGET-MIB" : `MODULE-${sequence % 97}`,
      symbol: tie
        ? "tieTarget"
        : sequence % 17 === 0
          ? "ifOperStatus"
          : sequence % 11 === 0
            ? `interfaceStatusNode${sequence}`
            : `object${sequence}`,
      oid: tie
        ? "1.3.6.1.4.1.99999.1"
        : `1.3.6.1.4.1.${1_000 + (sequence % 251)}.${1 + Math.floor(sequence / 251)}`,
      kind: sequence % 3 === 0 ? "object-type" : "object-identity",
      description: sequence % 5 === 0 ? "Interface operational status shared metric" : "Synthetic object",
      intent: sequence % 13 === 0 ? ["interface status"] : sequence % 19 === 0 ? ["processor load"] : [],
      related: sequence % 7 === 0 ? ["shared metric"] : []
    };
  });
}

function compact(results) {
  return results.map(({ record, score, matchKind }) => ({ sequence: record.sequence, score, matchKind }));
}

test("bounded top-20 ranking is identical to the full-sort reference", () => {
  const index = createSearchIndex(syntheticRecords(5_000));
  for (const query of [
    "tieTarget",
    "interface status",
    "ifOperStatus",
    "TARGET-MIB::ifOperStatus",
    "processor load",
    "shared metric",
    "module 7",
    "no-such-term"
  ]) {
    assert.deepEqual(compact(rankSearchIndex(query, index)), compact(referenceRankSearchIndex(query, index)), query);
  }

  assert.deepEqual(
    rankSearchIndex("tieTarget", index).map(({ record }) => record.sequence),
    Array.from({ length: MAX_SEARCH_RESULTS }, (_, sequence) => sequence)
  );
});

test("40 concurrent full-runtime searches remain below the production RSS limit", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--expose-gc", "scripts/benchmark-search-concurrency.mjs"],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        SEARCH_BENCHMARK_CONCURRENCY: "40",
        SEARCH_BENCHMARK_RSS_LIMIT_BYTES: String(640 * 1024 * 1024)
      },
      maxBuffer: 1024 * 1024,
      timeout: 120_000
    }
  );
  const report = JSON.parse(stdout);
  assert.equal(report.requests, 40);
  assert.equal(report.successful_responses, 40);
  assert.equal(report.maximum_results_per_response, MAX_SEARCH_RESULTS);
  assert.equal(report.rss_limit_bytes, 640 * 1024 * 1024);
  assert.equal(report.within_rss_limit, true, JSON.stringify(report));
});
