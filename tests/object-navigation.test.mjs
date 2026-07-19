import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import {
  MAX_NAVIGATION_CHILDREN,
  MAX_NAVIGATION_DEPTH,
  MAX_NAVIGATION_SUBTREE_NODES,
  MAX_OBJECT_ID_LENGTH,
  createApiHandler
} from "../src/api.mjs";
import { createServer } from "node:http";

async function withServer(callback) {
  const handler = createApiHandler();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    await handler(request, response, url);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("exact object endpoints accept stable ids and exact numeric OIDs", async () => {
  await withServer(async (base) => {
    const stable = await (await fetch(`${base}/v1/objects/ipv6-tcp-mib--tcp`)).json();
    const numeric = await (await fetch(`${base}/v1/objects/1.3.6.1.2.1.6`)).json();
    assert.equal(stable.object.id, "ipv6-tcp-mib--tcp");
    assert.deepEqual(numeric, stable);

    const instance = await fetch(`${base}/v1/objects/1.3.6.1.2.1.6.0`);
    assert.equal(instance.status, 404);
  });
});

test("object navigation exposes ancestors, paginated direct children, and a bounded subtree", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/objects/iana-mau-mib--dot3mautype/navigation?child_limit=2&subtree_depth=1&subtree_limit=1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const navigation = body.navigation;
    assert.equal(navigation.object.id, "iana-mau-mib--dot3mautype");
    assert.equal(navigation.direct_children.total, 226);
    assert.equal(navigation.direct_children.results.length, 2);
    assert.equal(navigation.direct_children.next_cursor, 2);
    assert.equal(navigation.subtree.depth, 1);
    assert.equal(navigation.subtree.limit, 1);
    assert.equal(navigation.subtree.returned_count, 1);
    assert.equal(navigation.subtree.truncated, true);
    assert.ok(navigation.subtree.descendant_count >= navigation.direct_children.total);

    const secondPage = await (await fetch(`${base}/v1/objects/iana-mau-mib--dot3mautype/navigation?child_cursor=2&child_limit=2&subtree_depth=0&subtree_limit=1`)).json();
    assert.equal(secondPage.navigation.direct_children.cursor, 2);
    assert.notEqual(secondPage.navigation.direct_children.results[0].id, navigation.direct_children.results[0].id);
  });
});

test("object navigation selects coherent standard ancestors instead of arbitrary vendor copies", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/objects/IF-MIB--ifOperStatus/navigation`);
    assert.equal(response.status, 200);
    const { navigation } = await response.json();

    assert.deepEqual(navigation.ancestors.map((ancestor) => ancestor.id), [
      "snmpv2-smi--org",
      "snmpv2-smi--dod",
      "snmpv2-smi--internet",
      "snmpv2-smi--mgmt",
      "snmpv2-smi--mib-2",
      "if-mib--interfaces",
      "if-mib--iftable",
      "if-mib--ifentry"
    ]);
    assert.equal(navigation.ancestors.some((ancestor) => ancestor.module === "CET-AGIL-UPS"), false);
    assert.equal(navigation.ancestors.some((ancestor) => ancestor.module === "CTELS100-NG-MIB"), false);
  });
});

test("object navigation keeps ancestors from the queried module when that module defines them", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/objects/CET-AGIL-UPS--agilModuleStatus/navigation`);
    assert.equal(response.status, 200);
    const { navigation } = await response.json();
    const sharedRootAncestors = navigation.ancestors.filter((ancestor) =>
      ["1.3", "1.3.6", "1.3.6.1"].includes(ancestor.oid)
    );

    assert.deepEqual(sharedRootAncestors.map((ancestor) => ancestor.module), [
      "CET-AGIL-UPS",
      "CET-AGIL-UPS",
      "CET-AGIL-UPS"
    ]);
  });
});

test("object navigation keeps direct children and subtree nodes in the queried module when available", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/objects/RFC1213-MIB--interfaces/navigation?subtree_depth=2&subtree_limit=10`);
    assert.equal(response.status, 200);
    const { navigation } = await response.json();

    assert.deepEqual(navigation.direct_children.results.map((child) => child.id), [
      "rfc1213-mib--ifnumber",
      "rfc1213-mib--iftable"
    ]);
    assert.deepEqual(navigation.subtree.nodes.map((node) => node.object.id), [
      "rfc1213-mib--ifnumber",
      "rfc1213-mib--iftable",
      "rfc1213-mib--ifentry"
    ]);
  });
});

test("object navigation rejects work bounds above the documented caps", async () => {
  await withServer(async (base) => {
    for (const query of [
      `child_limit=${MAX_NAVIGATION_CHILDREN + 1}`,
      `subtree_depth=${MAX_NAVIGATION_DEPTH + 1}`,
      `subtree_limit=${MAX_NAVIGATION_SUBTREE_NODES + 1}`,
      "child_cursor=-1"
    ]) {
      const response = await fetch(`${base}/v1/objects/ipv6-tcp-mib--tcp/navigation?${query}`);
      assert.equal(response.status, 422, query);
      assert.equal((await response.json()).type, "https://mibvendor.io/problems/invalid-navigation-query");
    }

    const oversizedId = await fetch(`${base}/v1/objects/${"x".repeat(MAX_OBJECT_ID_LENGTH + 1)}`);
    assert.equal(oversizedId.status, 422);
    assert.equal((await oversizedId.json()).type, "https://mibvendor.io/problems/invalid-object-id");
  });
});
