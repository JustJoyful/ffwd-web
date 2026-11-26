import { crc32 as nodeCrc32 } from "node:zlib";
import { describe, expect, test } from "vitest";
import { crc32, zipBlob } from "../../app/lib/zip.js";

const bytes = (s) => new TextEncoder().encode(s);

/** Read the zip back with nothing but the zip format: the end record, the central directory, then each file. */
async function readZip(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(u8.buffer);
  const end = u8.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const files = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(
      u8.subarray(p + 46, p + 46 + nameLen),
    );
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const start =
      local +
      30 +
      v.getUint16(local + 26, true) +
      v.getUint16(local + 28, true);
    files.push({ name, crc, data: u8.subarray(start, start + size) });
    p += 46 + nameLen;
  }
  return files;
}

describe("crc32", () => {
  test("matches Node's own crc32, and the standard check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    for (const s of ["", "a", "ffwd pictures", "x".repeat(100000)])
      expect(crc32(bytes(s)), s.slice(0, 8)).toBe(nodeCrc32(Buffer.from(s)));
  });
});

describe("zipBlob", () => {
  test("is a zip: the files come back with their names, bytes and checksums", async () => {
    const files = [
      { name: "0001.png", data: Uint8Array.from([137, 80, 78, 71, 0, 255]) },
      { name: "0002.png", data: bytes("second picture") },
      { name: "empty.bin", data: new Uint8Array(0) },
    ];
    const blob = zipBlob(files, new Date(2026, 10, 26, 12, 0, 0));
    expect(blob.type).toBe("application/zip");
    const back = await readZip(blob);
    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name));
    back.forEach((f, i) => {
      expect([...f.data]).toEqual([...files[i].data]);
      expect(f.crc).toBe(crc32(files[i].data));
    });
  });
  test("names are written as UTF-8", async () => {
    const back = await readZip(
      zipBlob([{ name: "bild-ä.png", data: bytes("x") }]),
    );
    expect(back[0].name).toBe("bild-ä.png");
  });
  test("an empty list is still a valid, empty zip", async () => {
    expect(await readZip(zipBlob([]))).toEqual([]);
  });
});
