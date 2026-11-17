import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseAction } from "../../app/agent/actions.js";

// Every expectation below was measured from training/env/actions.py::parse_action.
const spec = JSON.parse(
  readFileSync("protocol/conformance/describe-spec.jsonl", "utf8").split(
    "\n",
  )[0],
).spec;
const RUN = {
  action: "run",
  args: ["-i", "{in:clip}", "{out:out1}"],
  inputs: ["clip"],
  outputs: ["out1"],
};
const RUN_TEXT = JSON.stringify(RUN);

describe("one valid example per action kind is returned as parsed", () => {
  test.each([
    ["spec", { action: "spec", spec }],
    ["ask_user", { action: "ask_user", question: "Which part?" }],
    ["unsupported", { action: "unsupported", reason: "no subtitles" }],
    ["run", RUN],
    ["finish", { action: "finish", outputs: ["out1"], note: "done" }],
  ])("%s", (_k, a) => {
    expect(parseAction(JSON.stringify(a))).toEqual(a);
  });
});

describe("rejections come back as { error }, never as a throw", () => {
  const error = (t) => {
    const r = parseAction(t);
    expect(r).toHaveProperty("error");
    return r.error;
  };
  test('{"action":"check"} (check is not a model action)', () => {
    expect(error('{"action":"check"}')).toMatch(/^invalid action: /);
  });
  test("an unknown action, missing and extra fields, empty strings, empty args", () => {
    for (const t of [
      '{"action":"bogus"}',
      '{"action":"spec"}',
      '{"action":"ask_user","question":""}',
      '{"action":"run","args":[],"inputs":[],"outputs":["o"]}',
      '{"action":"run","args":"-i x","inputs":[],"outputs":["o"]}',
      '{"action":"finish","outputs":["out1"],"extra":1}',
      "{}",
    ])
      expect(error(t), t).toMatch(/^invalid action: /);
  });
  test("plain text and the empty string", () => {
    expect(error("hello")).toBe("reply is not a JSON object: Expecting value");
    expect(error("")).toBe("reply is not a JSON object: Expecting value");
    expect(error("Here: " + RUN_TEXT)).toMatch(/^reply is not a JSON object/);
  });
  test("a JSON array or scalar", () => {
    expect(error("[1]")).toBe("reply must be a JSON object");
    expect(error(`[${RUN_TEXT}]`)).toBe("reply must be a JSON object");
    expect(error("3")).toBe("reply must be a JSON object");
    expect(error("null")).toBe("reply must be a JSON object");
  });
  test("text after the JSON object", () => {
    const msg =
      "extra text after the JSON object; reply with exactly one JSON object";
    expect(error(RUN_TEXT + " this trims")).toBe(msg);
    expect(error(RUN_TEXT + "\n" + RUN_TEXT)).toBe(msg);
    expect(error("3 apples")).toBe(msg);
  });
  test("non-string input", () => {
    for (const x of [undefined, null, 5, {}, []])
      expect(parseAction(x)).toHaveProperty("error");
  });
});

describe("what is accepted, as the Python parser accepts it", () => {
  test("a ```json fence, a bare ``` fence and surrounding whitespace", () => {
    expect(parseAction("```json\n" + RUN_TEXT + "\n```")).toEqual(RUN);
    expect(parseAction("```\n" + RUN_TEXT + "\n```")).toEqual(RUN);
    expect(parseAction("\n  " + RUN_TEXT + "  \n")).toEqual(RUN);
  });
  test("a <think> block before the action", () => {
    expect(parseAction("<think>plan\nmore</think>" + RUN_TEXT)).toEqual(RUN);
    expect(
      parseAction("<think>\n</think>\n```json\n" + RUN_TEXT + "\n```"),
    ).toEqual(RUN);
  });
  test("JSON braces inside strings do not confuse the end-of-object scan", () => {
    const q = { action: "ask_user", question: "use } here? {x}" };
    expect(parseAction(JSON.stringify(q))).toEqual(q);
    expect(parseAction(JSON.stringify(q) + " tail")).toHaveProperty("error");
  });
});
