import { describe, expect, test } from "vitest";
import { buildCsp } from "../../csp.js";

const dir = (csp, name) => csp.split("; ").find((d) => d.startsWith(name));

describe("buildCsp (review S5)", () => {
  test("connect-src is self plus the model host; no analytics host unless analytics is on", () => {
    const c = buildCsp({ modelUrl: "https://models.example.org/a/m.gguf" });
    expect(dir(c, "connect-src")).toBe(
      "connect-src 'self' blob: https://models.example.org",
    );
  });
  test("the analytics host is added only when given", () => {
    const c = buildCsp({
      modelUrl: "https://m.example.org/x",
      analyticsHost: "https://ph.example.com/i",
    });
    expect(dir(c, "connect-src")).toBe(
      "connect-src 'self' blob: https://m.example.org https://ph.example.com",
    );
  });
  test("a Hugging Face model also allows its CDN redirect hosts", () => {
    const c = buildCsp({
      modelUrl: "https://huggingface.co/x/y/resolve/main/m.gguf",
    });
    expect(dir(c, "connect-src")).toContain("https://*.hf.co");
  });
  test("no model URL: self only; the fixed directives are always there; no script-src", () => {
    const c = buildCsp({});
    expect(dir(c, "connect-src")).toBe("connect-src 'self' blob:");
    for (const d of [
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "worker-src 'self' blob:",
      "form-action 'self'",
    ])
      expect(c).toContain(d);
    expect(c).not.toContain("script-src");
  });
  test("the feedback host is added only when given, and is separate from analytics", () => {
    expect(
      dir(
        buildCsp({ feedbackUrl: "https://fb.example.workers.dev/in" }),
        "connect-src",
      ),
    ).toBe("connect-src 'self' blob: https://fb.example.workers.dev");
    expect(dir(buildCsp({ feedbackUrl: null }), "connect-src")).toBe(
      "connect-src 'self' blob:",
    );
  });
  test("a bad URL adds nothing", () => {
    expect(dir(buildCsp({ modelUrl: "nonsense" }), "connect-src")).toBe(
      "connect-src 'self' blob:",
    );
  });
});
