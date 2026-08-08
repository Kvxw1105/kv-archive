import assert from "node:assert/strict";
import test from "node:test";
import { createStoredZip, crc32 } from "../apps/extension/src/zip.js";

const encoder = new TextEncoder();

test("CRC32 matches a standard vector", () => {
  assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926);
});

test("stored ZIP contains one local entry and one central entry", () => {
  const zip = createStoredZip([{ name: "hello.txt", data: "hello" }], new Date(2026, 0, 1, 0, 0, 0));
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x0800);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.ok(new TextDecoder().decode(zip).includes("hello.txt"));
});
