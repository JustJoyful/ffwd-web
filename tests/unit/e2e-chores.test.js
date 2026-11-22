// The scripted replies of the end-to-end chores, checked without a browser: every reply parses as an action, every
// spec is valid, every run passes the allowlist, and the plan chips the spec gives are the ones the spec file expects.
// A script that fails here would only have failed minutes into a Playwright run.
import { describe, expect, test } from "vitest";
import { CHORES } from "../e2e/scripts.js";
import { parseAction } from "../../app/agent/actions.js";
import { validateRun } from "../../app/agent/validator.js";
import { validateSpec } from "../../app/agent/protocol/validate.js";
import { chipsFromSpec, flagsForChip } from "../../app/tool/chips.js";
import { probeOf } from "./engine-fakes.js";

// the e2e clip: 1280 x 720, 4 s, h264 + aac
const PROBE = probeOf();

describe.each(Object.entries(CHORES))("e2e chore %s", (id, chore) => {
  const actions = chore.script.map(parseAction);

  test("every reply is a valid action", () => {
    for (const a of actions) expect(a.error, id).toBeUndefined();
  });

  test("the spec validates and its plan has the expected chips", () => {
    const { spec } = actions[0];
    expect(validateSpec(spec).errors).toEqual([]);
    const chips = chipsFromSpec(spec, PROBE);
    for (const [label, value] of chore.chips)
      expect(chips.some(([l, v]) => l === label && v.includes(value))).toBe(
        true,
      );
  });

  test("every run passes the allowlist and uses the flags the spec file lists", () => {
    const runs = actions.slice(1);
    expect(runs).toHaveLength(chore.runs === 2 ? 2 : 1);
    for (const r of runs) {
      expect(validateRun(r.args, r.inputs, r.outputs).ok).toBe(true);
    }
    expect(actions.at(-1).args.join(" ")).toContain(chore.flags.join(" "));
  });
});

describe("chips for an audio result", () => {
  const audio = CHORES.audio && parseAction(CHORES.audio.script[0]).spec;
  test("the picture is removed, never unchanged, and -vn is the flag that does it", () => {
    const chips = chipsFromSpec(audio, PROBE);
    expect(chips).toContainEqual(["Picture", "removed", 1]);
    expect(chips.map(([l, v]) => l + v)).not.toContain("Pictureunchanged");
    const args = ["-i", "in.mp4", "-vn", "-c:a", "aac", "out.m4a"];
    expect([...flagsForChip("Picture", args)]).toEqual([2]);
    expect([...flagsForChip("Sound", args)].toSorted()).toEqual([3, 4]);
  });
});
