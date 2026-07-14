import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { records } from "../prototype/data.mjs";
import {
  MAX_WALK_BYTES,
  MAX_WALK_LINES,
  classifySearchQuery,
  oidStartsWith,
  parseOid,
  parseWalk,
  resolveOid,
  searchRecords
} from "../prototype/core.mjs";

test("parseOid accepts canonical numeric OIDs and rejects malformed input", () => {
  assert.deepEqual(parseOid(".1.3.6.1.2.1"), [1, 3, 6, 1, 2, 1]);
  assert.equal(parseOid("1.3.nope"), null);
  assert.equal(parseOid("1..3"), null);
  assert.equal(parseOid("-1.3"), null);
});

test("oidStartsWith compares subidentifiers, not lexical text", () => {
  assert.equal(oidStartsWith([1, 3, 6, 10], [1, 3, 6]), true);
  assert.equal(oidStartsWith([1, 3, 60], [1, 3, 6]), false);
});

test("resolveOid chooses the longest actual ancestor and preserves the instance", () => {
  const resolved = resolveOid("1.3.6.1.2.1.2.2.1.8.17", records);
  assert.equal(resolved.record.symbol, "ifOperStatus");
  assert.deepEqual(resolved.instance, [17]);
});

test("task, symbol, module-qualified, and numeric queries resolve", () => {
  assert.equal(searchRecords("interface status", records)[0].symbol, "ifOperStatus");
  assert.equal(searchRecords("IF-MIB::ifOperStatus", records)[0].symbol, "ifOperStatus");
  assert.equal(searchRecords("1.3.6.1.2.1.1.3.0", records)[0].symbol, "sysUpTime");
  assert.equal(searchRecords("processor load", records)[0].symbol, "hrProcessorLoad");
});

test("search classifications preserve ranking, instances, and explicit failure states", () => {
  const task = classifySearchQuery("interface status", records);
  assert.equal(task.state, "matches");
  assert.equal(task.matches[0].record.symbol, "ifOperStatus");
  assert.equal(task.matches[0].matchKind, "task-intent");
  assert.ok(task.matches.length > 1);

  const instance = classifySearchQuery("1.3.6.1.2.1.2.2.1.8.7", records);
  assert.equal(instance.matches[0].matchKind, "numeric-instance");
  assert.deepEqual(instance.resolved.instance, [7]);

  assert.equal(classifySearchQuery("1.3.nope", records).state, "invalid-oid");
  assert.equal(classifySearchQuery("1.3.6.1.4.1.999999.1.0", records).state, "unknown-oid");
  assert.equal(classifySearchQuery("", records).state, "empty");
});

test("prototype records expose bounded trust and release metadata", () => {
  for (const record of records) {
    assert.equal(record.rightsTier, "A — approved standards seed");
    assert.equal(record.dataRelease, "phase0-synthetic-1");
    assert.match(record.sourceChecked, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(record.parseStatus);
    assert.deepEqual(record.rightsScopes, ["metadata", "rendered text", "API output"]);
  }
});

test("walk parsing resolves table rows, scalar instances, and unknown OIDs", () => {
  const walk = [
    ".1.3.6.1.2.1.2.2.1.2.1 = STRING: Ethernet0/1",
    ".1.3.6.1.2.1.2.2.1.8.1 = INTEGER: up(1)",
    ".1.3.6.1.2.1.1.3.0 = Timeticks: 123",
    ".1.3.6.1.4.1.99999.1.0 = INTEGER: 7"
  ].join("\n");

  const result = parseWalk(walk, records);
  assert.equal(result.rows.length, 4);
  assert.equal(result.resolvedCount, 3);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.rows[0].group, "ifTable");
  assert.equal(result.rows[0].instance, "1");
  assert.equal(result.rows[2].record.symbol, "sysUpTime");
  assert.equal(result.errors.length, 0);
});

test("walk parsing reports unsupported lines without inventing rows", () => {
  const result = parseWalk("IF-MIB::ifOperStatus.1 = up(1)", records);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 1);
});

test("walk parsing enforces byte and line bounds", () => {
  assert.throws(
    () => parseWalk("12345", records, { maxBytes: 4 }),
    (error) => error instanceof RangeError && error.message.includes("bytes")
  );

  assert.throws(
    () => parseWalk("1\n2\n3", records, { maxLines: 2 }),
    (error) => error instanceof RangeError && error.message.includes("lines")
  );
  assert.equal(MAX_WALK_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_WALK_LINES, 50_000);
});

test("browser prototype contains no network transport primitive", async () => {
  const sources = await Promise.all([
    readFile(new URL("../prototype/app.js", import.meta.url), "utf8"),
    readFile(new URL("../prototype/core.mjs", import.meta.url), "utf8"),
    readFile(new URL("../prototype/data.mjs", import.meta.url), "utf8")
  ]);
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /\bfetch\s*\(/);
  assert.doesNotMatch(joined, /XMLHttpRequest|WebSocket|sendBeacon/);
});

test("public page states safe-use and API availability boundaries", async () => {
  const html = await readFile(new URL("../prototype/index.html", import.meta.url), "utf8");
  assert.match(html, /Local walk parsing/);
  assert.match(html, /No device connections/);
  assert.match(html, /Public API/);
  assert.match(html, /Not released/);
  assert.match(html, /https:\/\/mibvendor\.io\/v1/);
  assert.match(html, /open source on GitHub/);
  assert.match(html, /id="search-results"/);
  assert.match(html, /Ranked, not hidden/);
  assert.doesNotMatch(html, /community string[^<]*value|SNMPv3 credential[^<]*value/i);
});
