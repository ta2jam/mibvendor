import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import {
  DATA_RELEASE,
  MAX_BODY_BYTES,
  MAX_BATCH_SIZE,
  createPhase0ApiMock
} from "../scripts/phase0-api-mock.mjs";

async function withServer(callback) {
  const server = createPhase0ApiMock();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("batch resolution preserves order, duplicates, instances, and unknown state", async () => {
  await withServer(async (base) => {
    const oids = [
      "1.3.6.1.2.1.2.2.1.8.7",
      "1.3.6.1.4.1.999999.1.0",
      "1.3.6.1.2.1.2.2.1.8.7",
      "1.3.6.1.2.1.1.3.0",
      "1.3.6.1.2.1.2.2.999999",
      "1.3.6.1.2.1.2.2.1.999999"
    ];
    const response = await fetch(`${base}/v1/resolve:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oids })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data_release, DATA_RELEASE);
    assert.deepEqual(body.results.map((result) => result.input), oids);
    assert.equal(body.results[0].object.symbol, "ifOperStatus");
    assert.deepEqual(body.results[0].instance_suffix, [7]);
    assert.equal(body.results[1].status, "not_found");
    assert.equal(body.results[2].status, "resolved");
    assert.equal(body.results[3].object.id, "snmpv2-mib--sysuptime");
    assert.equal(body.results[3].object.kind, "scalar");
    assert.deepEqual(body.results[3].instance_suffix, [0]);
    assert.equal(body.results[3].object.provenance.rights_tier, "A");
    assert.equal(body.results[4].status, "not_found");
    assert.equal(body.results[5].status, "not_found");
  });
});

test("search and exact object responses expose structured intelligence and provenance", async () => {
  await withServer(async (base) => {
    const searchResponse = await fetch(`${base}/v1/search?q=interface%20status`);
    const search = await searchResponse.json();
    assert.equal(search.results.filter((result) => result.id === "if-mib--ifoperstatus").length, 1);
    assert.equal(search.results[0].id, "if-mib--ifoperstatus");
    assert.equal(search.results[0].module, "IF-MIB");
    assert.equal(search.results[0].symbol, "ifOperStatus");
    assert.equal(search.results[0].provenance.rights_tier, "A");
    assert.equal(search.results[0].provenance.publication_mode, "redistributable");
    assert.equal(search.results[0].provenance.raw_download, true);
    assert.match(search.results[0].provenance.source_revision, /^[0-9a-f]{40}$/);
    assert.match(search.results[0].provenance.artifact_sha256, /^[0-9a-f]{64}$/);

    const objectResponse = await fetch(`${base}/v1/objects/if-mib--ifoperstatus`);
    const object = await objectResponse.json();
    assert.equal(object.data_release, DATA_RELEASE);
    assert.equal(object.object.oid, "1.3.6.1.2.1.2.2.1.8");
    assert.equal(object.object.syntax.base, "INTEGER");
    assert.equal(object.object.syntax.enums["1"], "up");
    assert.equal(object.object.access, "read-only");
    assert.equal(object.object.status, "current");
    assert.equal(object.object.description.status, "available");
    assert.equal(object.object.kind, "column");
    assert.equal(object.object.relationships.table, "ifTable");
    assert.equal(object.object.relationships.row, "ifEntry");
    assert.deepEqual(object.object.relationships.indexes, ["ifIndex"]);
    assert.equal(object.object.provenance.rights_tier, "A");
    assert.equal(object.object.provenance.publication_mode, "redistributable");
  });
});

test("oversized batches return stable problem details", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/resolve:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oids: Array.from({ length: MAX_BATCH_SIZE + 1 }, () => "1.3.6.1") })
    });
    const problem = await response.json();
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("content-type"), "application/problem+json");
    assert.equal(problem.type, "https://mibvendor.io/problems/batch-too-large");
  });
});

test("enterprise and sysObjectID lookup separate registry identity from exact evidence", async () => {
  await withServer(async (base) => {
    const enterpriseResponse = await fetch(`${base}/v1/enterprises/9`);
    const enterprise = await enterpriseResponse.json();
    assert.equal(enterpriseResponse.status, 200);
    assert.equal(enterprise.enterprise.organization, "ciscoSystems");
    assert.match(enterprise.enterprise.caveat, /does not prove/i);

    const exact = await (await fetch(`${base}/v1/sys-object-ids/1.3.6.1.4.1.8072.3.2.10`)).json();
    assert.equal(exact.result.status, "resolved");
    assert.equal(exact.result.match.product_family, "Net-SNMP agent");
    assert.equal(exact.result.match.platform, "Linux");
    assert.equal(exact.result.match.model, null);
    assert.equal(exact.result.match.claim_strength, "platform");

    const sigScale = await (await fetch(`${base}/v1/sys-object-ids/1.3.6.1.4.1.50386.1.1`)).json();
    assert.equal(sigScale.result.status, "resolved");
    assert.equal(sigScale.result.match.product_family, "SigScale OCS");
    assert.equal(sigScale.result.match.claim_strength, "platform");
    assert.equal(sigScale.result.match.model, null);
    assert.equal(sigScale.result.match.provenance.source_license, "Apache-2.0");

    const boundary = await (await fetch(`${base}/v1/sys-object-ids/1.3.6.1.4.1.2.999999`)).json();
    assert.equal(boundary.result.status, "enterprise_only");
    assert.equal(boundary.result.match, null);
    assert.match(boundary.result.caveat, /no product or model/i);

    const ciscoBoundary = await (await fetch(`${base}/v1/sys-object-ids/1.3.6.1.4.1.9.999999`)).json();
    assert.equal(ciscoBoundary.result.status, "enterprise_only");
    assert.equal(ciscoBoundary.result.enterprise_number, 9);
    assert.equal(ciscoBoundary.result.organization_key, "Q173395");
    assert.equal(ciscoBoundary.result.identity_status, "vendor_only");
  });
});

test("module dependencies distinguish graph states", async () => {
  await withServer(async (base) => {
    const request = async (module) => {
      const response = await fetch(`${base}/v1/modules/${module}/dependencies`);
      const body = await response.json();
      assert.equal(response.status, 200);
      for (const field of ["direct", "transitive", "missing", "cyclic", "diagnostics"]) {
        assert.ok(Array.isArray(body[field]), `${module}.${field} must be a machine-readable array`);
      }
      return body;
    };

    const complete = await request("BFD-STD-MIB");
    assert.equal(complete.status, "complete");
    assert.ok(complete.direct.includes("IF-MIB"));
    assert.ok(complete.transitive.includes("IANAifType-MIB"));
    assert.deepEqual(complete.missing, []);
    assert.deepEqual(complete.cyclic, []);

    const partial = await request("BGP-MPLS-LAYER3-VPN-MULTICAST-MIB");
    assert.equal(partial.status, "partial");
    assert.ok(partial.missing.includes("MPLS-L3VPN-STD-MIB"));
    assert.ok(partial.diagnostics.some((item) => /missing state is explicit/i.test(item)));

    const cyclic = await request("OPENSS7-DLM-MIB");
    assert.equal(cyclic.status, "complete");
    assert.ok(cyclic.cyclic.some((item) => item === "OPENSS7-NLM-MIB -> OPENSS7-ISIS-MIB -> OPENSS7-NLM-MIB"));
  });
});

test("module and source catalogs enforce raw redistribution boundaries", async () => {
  await withServer(async (base) => {
    const modules = await (await fetch(`${base}/v1/modules?q=BFD&limit=10`)).json();
    const bfd = modules.results.find((module) => module.id === "BFD-STD-MIB");
    assert.equal(bfd.publication_mode, "redistributable");
    assert.equal(bfd.raw_download, true);
    assert.match(bfd.artifact_sha256, /^[0-9a-f]{64}$/);
    assert.ok(bfd.root_objects.length > 0);
    assert.match(bfd.root_objects[0].id, /^bfd-std-mib--/);
    assert.match(bfd.root_objects[0].oid, /^\d+(?:\.\d+)+$/);

    const rawResponse = await fetch(`${base}${bfd.raw_url}`);
    assert.equal(rawResponse.status, 200);
    assert.equal(rawResponse.headers.get("content-type"), "application/x-tar");
    assert.equal(rawResponse.headers.get("cache-control"), "no-cache");
    assert.match(rawResponse.headers.get("x-content-sha256"), /^[0-9a-f]{64}$/);
    assert.equal(rawResponse.headers.get("x-mib-sha256"), bfd.artifact_sha256);
    assert.match(rawResponse.headers.get("link"), /rel="license"/);
    const bundle = Buffer.from(await rawResponse.arrayBuffer());
    assert.equal(bundle.includes(Buffer.from("BFD-STD-MIB DEFINITIONS ::= BEGIN")), true);
    assert.equal(bundle.includes(Buffer.from("LICENSE.txt")), true);
    assert.equal(bundle.includes(Buffer.from("PROVENANCE.json")), true);

    const licensedModule = await (await fetch(`${base}/v1/modules/ACCOUNTING-CONTROL-MIB`)).json();
    const licensedBundleResponse = await fetch(`${base}${licensedModule.module.raw_url}`);
    const licensedBundle = Buffer.from(await licensedBundleResponse.arrayBuffer());
    assert.equal(licensedBundleResponse.status, 200);
    assert.equal(licensedBundleResponse.headers.get("x-mib-sha256"), licensedModule.module.artifact_sha256);
    assert.equal(licensedBundle.includes(Buffer.from("Permission is hereby granted")), true);
    assert.equal(licensedBundle.includes(Buffer.from('"role": "retained-license-or-notice"')), true);

    const cisco = await (await fetch(`${base}/v1/sources/cisco`)).json();
    assert.equal(cisco.source.publication_mode, "directory-only");
    assert.equal(cisco.source.content_intake, "quarantine");
    assert.deepEqual(cisco.source.public_fields, ["publisher", "official_source_url", "rights_state"]);
    assert.equal(cisco.source.public_fields.includes("checksum"), false);
  });
});

test("request bodies over the documented byte cap are rejected", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/resolve:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oids: ["1".repeat(MAX_BODY_BYTES)] })
    });
    const problem = await response.json();
    assert.equal(response.status, 413);
    assert.equal(problem.type, "https://mibvendor.io/problems/body-too-large");
  });
});
