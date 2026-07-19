import assert from "node:assert/strict";
import test from "node:test";

import { createTar } from "../src/tar.mjs";

function readString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  return buffer.subarray(offset, end >= offset && end < offset + length ? end : offset + length).toString("ascii");
}

function readOctal(buffer, offset, length) {
  return Number.parseInt(readString(buffer, offset, length).trim(), 8);
}

function parseTar(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length && buffer.subarray(offset, offset + 512).some((byte) => byte !== 0)) {
    const header = buffer.subarray(offset, offset + 512);
    const expectedChecksum = readOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    assert.equal(checksumHeader.reduce((sum, byte) => sum + byte, 0), expectedChecksum);
    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const start = offset + 512;
    entries.set(name, buffer.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  assert.ok(buffer.subarray(offset).length >= 1024);
  assert.ok(buffer.subarray(offset).every((byte) => byte === 0));
  return entries;
}

test("deterministic TAR keeps each exact payload and a valid checksum", () => {
  const input = [
    { name: "MIB.mib", bytes: Buffer.from("EXAMPLE-MIB DEFINITIONS ::= BEGIN\nEND\n") },
    { name: "LICENSE.txt", bytes: Buffer.from("license\n") }
  ];
  const first = createTar(input);
  const second = createTar(input);
  assert.deepEqual(first, second);
  assert.equal(first.length % 512, 0);
  const entries = parseTar(first);
  assert.equal(entries.get("MIB.mib").toString(), input[0].bytes.toString());
  assert.equal(entries.get("LICENSE.txt").toString(), input[1].bytes.toString());
});

test("TAR rejects duplicate or unsafe entry names", () => {
  assert.throws(() => createTar([{ name: "../secret", bytes: "x" }]), /unsafe/);
  assert.throws(() => createTar([{ name: "same", bytes: "x" }, { name: "same", bytes: "y" }]), /Duplicate/);
});
