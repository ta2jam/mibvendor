import assert from "node:assert/strict";
import test from "node:test";

import { importBindingsFor, parseDefinitions, parseMacros, parseTextualConventions, resolveObjects } from "../scripts/update-mib-catalog.mjs";

test("OID parsing ignores quoted examples and resolves full and concatenated assignments", () => {
  const source = `TEST-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI;
demoRoot MODULE-IDENTITY
  DESCRIPTION "notARealObject OBJECT IDENTIFIER ::= { 0 0 }"
  ::= { iso org(3) dod(6) internet(1) private(4) enterprises(1) 99999 }
demoChild OBJECT IDENTIFIER ::= { demoRoot 1 }demoSibling OBJECT IDENTIFIER ::= { demoRoot 2 }
END
`;
  const parsed = parseDefinitions(source, "TEST-MIB");
  assert.deepEqual(parsed.map(({ symbol }) => symbol), ["demoRoot", "demoChild", "demoSibling"]);
  const resolved = resolveObjects([{ module: "TEST-MIB", objects: parsed, imports: importBindingsFor(source) }], [], { useNetSnmp: false });
  assert.deepEqual(Object.fromEntries(resolved.map(({ symbol, oid }) => [symbol, oid])), {
    demoRoot: "1.3.6.1.4.1.99999",
    demoChild: "1.3.6.1.4.1.99999.1",
    demoSibling: "1.3.6.1.4.1.99999.2"
  });
});

test("OID resolution uses an explicit import before an ambiguous global symbol", () => {
  const imported = parseDefinitions("sourceRoot OBJECT IDENTIFIER ::= { enterprises 10 }", "SOURCE-MIB");
  const collision = parseDefinitions("sourceRoot OBJECT IDENTIFIER ::= { enterprises 20 }", "OTHER-MIB");
  const child = parseDefinitions("child OBJECT IDENTIFIER ::= { sourceRoot 1 }", "CHILD-MIB");
  const resolved = resolveObjects([
    { module: "SOURCE-MIB", objects: imported },
    { module: "OTHER-MIB", objects: collision },
    { module: "CHILD-MIB", objects: child, imports: { sourceRoot: "SOURCE-MIB" } }
  ], [], { useNetSnmp: false });
  assert.equal(resolved.find((object) => object.module === "CHILD-MIB").oid, "1.3.6.1.4.1.10.1");
});

test("textual-convention parsing stops before the next OID definition", () => {
  const source = `TEST-MIB DEFINITIONS ::= BEGIN
DemoString ::= TEXTUAL-CONVENTION
  DISPLAY-HINT "16a"
  STATUS current
  DESCRIPTION "A compact demo type."
  SYNTAX OCTET STRING (SIZE (0..16))

demoRoot OBJECT IDENTIFIER ::= { enterprises 99999 }
END
`;
  assert.deepEqual(parseTextualConventions(source, "TEST-MIB"), [{
    module: "TEST-MIB",
    symbol: "DemoString",
    kind: "textual-convention",
    syntax: "OCTET STRING (SIZE (0..16))",
    status: "current",
    description: "A compact demo type.",
    display_hint: "16a"
  }]);
});

test("macro parsing records definitions without executing source text", () => {
  const source = `LEGACY-MIB DEFINITIONS ::= BEGIN
OBJECT-TYPE MACRO ::= BEGIN
  TYPE NOTATION ::= "SYNTAX" type(ObjectSyntax)
END
TRAP-TYPE MACRO ::= BEGIN
  TYPE NOTATION ::= "ENTERPRISE" value (enterprise OBJECT IDENTIFIER)
END
END
`;
  assert.deepEqual(parseMacros(source, "LEGACY-MIB"), [
    { module: "LEGACY-MIB", symbol: "OBJECT-TYPE", kind: "macro" },
    { module: "LEGACY-MIB", symbol: "TRAP-TYPE", kind: "macro" }
  ]);
});
