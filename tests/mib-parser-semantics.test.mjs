import assert from "node:assert/strict";
import test from "node:test";

import { parseMacros, parseTextualConventions } from "../scripts/update-mib-catalog.mjs";

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
