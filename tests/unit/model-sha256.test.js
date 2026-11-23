// The streaming SHA-256 against the standard (NIST) vectors, and against node's own implementation.
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createSha256 } from "../../app/model/sha256.js";

const enc = (s) => new TextEncoder().encode(s);
const sha = (...chunks) => {
  const h = createSha256();
  for (const c of chunks) h.update(c);
  return h.digest();
};

describe("sha256", () => {
  test("empty input", () => {
    expect(sha()).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  test('"abc"', () => {
    expect(sha(enc("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  test("the 448-bit vector (padding spills into a second block)", () => {
    expect(
      sha(enc("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
  test("one million times a", () => {
    expect(sha(enc("a".repeat(1_000_000)))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });
  test("chunked equals one-shot, for every awkward chunk size", () => {
    const data = new Uint8Array(randomBytes(5000));
    const want = createHash("sha256").update(data).digest("hex");
    for (const size of [1, 3, 55, 56, 63, 64, 65, 127, 1000]) {
      const chunks = [];
      for (let i = 0; i < data.length; i += size) {
        chunks.push(data.subarray(i, i + size));
      }
      expect(sha(...chunks)).toBe(want);
    }
    expect(sha(data)).toBe(want);
  });
  test("lengths around the padding boundary match node", () => {
    for (let n = 50; n <= 70; n++) {
      const d = new Uint8Array(randomBytes(n));
      expect(sha(d)).toBe(createHash("sha256").update(d).digest("hex"));
    }
  });
  test("a finished hasher refuses more input", () => {
    const h = createSha256();
    h.digest();
    expect(() => h.update(enc("x"))).toThrow();
    expect(() => h.digest()).toThrow();
  });
});
