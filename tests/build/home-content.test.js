import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { expect, test } from "vitest";

const doc = new JSDOM(readFileSync("build/client/index.html", "utf8")).window.document;
const $ = (s) => doc.querySelector(s);
const $$ = (s) => [...doc.querySelectorAll(s)];

test("exactly one <h1>: Describe the chore. / Get a checked video.", () => {
  expect($$("h1")).toHaveLength(1);
  expect($("h1").textContent).toBe("Describe the chore.Get a checked video.");
  expect($("h1 span").textContent).toBe("Get a checked video.");
});

test("footer credit names Meridian, links the source and the CC BY 4.0 licence, notes the changes", () => {
  const credit = $(".foot__credit");
  expect(credit.textContent).toContain("Meridian");
  expect(credit.textContent).toContain("CC BY 4.0");
  expect(credit.textContent).toContain("Cut, cropped, resized and colour-adjusted.");
  const hrefs = [...credit.querySelectorAll("a")].map((a) => a.href);
  expect(hrefs).toContain("https://opencontent.netflix.com/");
  expect(hrefs).toContain("https://creativecommons.org/licenses/by/4.0/");
});

test("five stepper visuals and five stepper items", () => {
  expect($$("[data-vis]").map((e) => e.dataset.vis)).toEqual(["1", "2", "3", "4", "5"]);
  expect($$(".cstep")).toHaveLength(5);
});

test("buttons and anchors the behaviour hooks into", () => {
  expect($$("[data-choose]")).toHaveLength(3);
  expect($$("[data-sample]")).toHaveLength(2);
  for (const id of ["checked", "privacy", "research"]) expect($(`#${id}`)).not.toBeNull();
});

test("sample video and images point under /media/ and the files exist", () => {
  const refs = [
    $("video").getAttribute("poster"),
    ...$$("video source").map((s) => s.getAttribute("src")),
    ...$$("img").map((i) => i.getAttribute("src")),
  ];
  expect(refs.length).toBeGreaterThanOrEqual(3);
  for (const ref of refs) {
    expect(ref.startsWith("/media/")).toBe(true);
    expect(existsSync(`build/client${ref}`)).toBe(true);
  }
  expect(existsSync("build/client/media/mer-f7.jpg")).toBe(true);
});
