import { describe, expect, test } from "vitest";
import { CHORES as SHOWCASE } from "../../app/content/showcase-chores.js";
import { chores, choreDescription, askLink } from "../../app/content/chores.js";

describe("chores content", () => {
  test("the five showcase chores, each with its own diagram", () => {
    expect(chores).toHaveLength(5);
    expect(chores.map((c) => c.diagram).sort()).toEqual(
      SHOWCASE.map((c) => c.id).sort(),
    );
  });

  test("slugs are unique and URL-safe", () => {
    const slugs = chores.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("every related slug exists, is not the chore itself, and there is at least one", () => {
    const slugs = new Set(chores.map((c) => c.slug));
    for (const c of chores) {
      expect(c.related.length).toBeGreaterThan(0);
      for (const r of c.related) {
        expect(slugs.has(r), `${c.slug} -> ${r}`).toBe(true);
        expect(r).not.toBe(c.slug);
      }
    }
  });

  test("every otherWays entry is 3 to 120 characters", () => {
    for (const c of chores) {
      expect(c.otherWays.length).toBeGreaterThan(0);
      for (const w of c.otherWays) {
        expect(w.length).toBeGreaterThanOrEqual(3);
        expect(w.length).toBeLessThanOrEqual(120);
      }
    }
  });

  test("three steps, a title of at most 60 characters, and the sentence the home page demo uses", () => {
    for (const c of chores) {
      expect(c.steps).toHaveLength(3);
      expect(c.title.length).toBeLessThanOrEqual(60);
      expect(c.sentence).toBe(SHOWCASE.find((s) => s.id === c.diagram).ask);
    }
    const titles = chores.map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test("the meta description is 70 to 160 characters", () => {
    for (const c of chores) {
      const d = choreDescription(c);
      expect(d.length).toBeGreaterThanOrEqual(70);
      expect(d.length).toBeLessThanOrEqual(160);
    }
  });

  test("askLink encodes the text and caps it at 300 characters", () => {
    expect(askLink("Cut the first 3 seconds & more")).toBe(
      "/app?ask=Cut%20the%20first%203%20seconds%20%26%20more",
    );
    expect(
      decodeURIComponent(askLink("x".repeat(500)).slice("/app?ask=".length)),
    ).toHaveLength(300);
  });
});
