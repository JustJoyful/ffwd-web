import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { CHORES } from "../../app/content/showcase-chores.js";
import { chipsFromSpec } from "../../app/tool/chips.js";
import AskUser from "../../app/components/tool/AskUser.jsx";
import CapabilityNotice from "../../app/components/tool/CapabilityNotice.jsx";
import ModelLoader from "../../app/components/tool/ModelLoader.jsx";
import PlanCard from "../../app/components/tool/PlanCard.jsx";
import ProbeReadout from "../../app/components/tool/ProbeReadout.jsx";
import RequestField from "../../app/components/tool/RequestField.jsx";
import StatusDot from "../../app/components/tool/StatusDot.jsx";
import Unsupported from "../../app/components/tool/Unsupported.jsx";
import { probeOf } from "./engine-fakes.js";

afterEach(cleanup);

// The sample clip of the home page: 1920 x 1080, 16.07 s.
const PROBE = probeOf({
  duration_s: 16.07,
  streams: [
    {
      index: 0,
      type: "video",
      codec: "h264",
      width: 1920,
      height: 1080,
      fps: 30,
      pix_fmt: "yuv420p",
      rotation: 0,
    },
  ],
});
const spec = (output) => ({
  family: ["F1"],
  outputs: [{ id: "out1", kind: "video", ...output }],
});
// A spec equivalent to each showcase chore (the plan the home page shows for it).
const SPECS = {
  trim: spec({ time: { start_s: 3 } }),
  vertical: spec({ video: { width: 1080, height: 1920 } }),
  size: spec({ size_max_bytes: 3_000_000 }),
  iphone: spec({
    container: "mp4",
    video: { codec: "h264", pix_fmt: "yuv420p" },
  }),
  frames: spec({
    kind: "image_sequence",
    frames: { interval_s: 2, expected_count: 8, format: "jpg" },
  }),
};

describe("chipsFromSpec", () => {
  test.each(Object.keys(SPECS))(
    "reproduces the home page's plan for %s",
    (id) => {
      const want = CHORES.find((c) => c.id === id).plan;
      const got = chipsFromSpec(SPECS[id], PROBE);
      // what changes: the same chips in the same order
      expect(got.filter((c) => c[2])).toEqual(want.filter((c) => c[2]));
      // what stays: the home page's own unchanged chips are all there (ours may add the ones it left out)
      for (const c of want.filter((c) => !c[2])) expect(got).toContainEqual(c);
    },
  );

  test("the container the spec sets decides the format words", () => {
    const g = chipsFromSpec(spec({ container: "webm" }), PROBE);
    expect(g).toContainEqual(["Format", "WEBM", 1]);
  });

  test("only fields the spec sets appear as changes", () => {
    const g = chipsFromSpec(SPECS.size, PROBE);
    expect(g.map((c) => c[0])).not.toContain("Keep");
    expect(g.map((c) => c[0])).not.toContain("Sound");
    expect(g.filter((c) => c[2]).map((c) => c[0])).toEqual(["Size"]);
  });
});

describe("RequestField", () => {
  function Host({ locked = false, onSubmit = () => {}, initial = "" }) {
    const [v, setV] = useState(initial);
    return (
      <RequestField
        value={v}
        onChange={setV}
        onSubmit={onSubmit}
        locked={locked}
      />
    );
  }
  const field = () =>
    screen.getByLabelText("What should happen to your video?");

  test("Enter submits the text and Shift+Enter does not", () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} initial="cut the first 3 seconds" />);
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("cut the first 3 seconds");
  });

  test("an empty request is not submitted", () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("it is read-only when locked and does not submit", () => {
    const onSubmit = vi.fn();
    render(<Host locked onSubmit={onSubmit} initial="x" />);
    expect(field().readOnly).toBe(true);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a 300-character request is kept whole", () => {
    const long = "make it small ".repeat(22).trim().slice(0, 300);
    render(<Host initial={long} />);
    expect(field().value).toHaveLength(300);
  });
});

describe("PlanCard", () => {
  const chips = chipsFromSpec(SPECS.size, PROBE);

  test("shows the chips and moves focus to Run it", () => {
    render(
      <PlanCard
        chips={chips}
        state="proposed"
        onRun={() => {}}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      chips.map(([k, v]) => k + v),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Run it" }),
    );
  });

  test("Run it and Change call back; a confirmed plan has no buttons", () => {
    const onRun = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(
      <PlanCard
        chips={chips}
        state="proposed"
        onRun={onRun}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run it" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    rerender(
      <PlanCard
        chips={chips}
        state="confirmed"
        onRun={onRun}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("an edited request cannot run the old plan", () => {
    render(
      <PlanCard
        chips={chips}
        state="edited"
        onRun={() => {}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Run it" }).disabled).toBe(true);
  });

  test("chips stagger 60 ms apart, at most six steps", () => {
    const many = Array.from({ length: 8 }, (_, i) => [`Field ${i}`, "x", 1]);
    render(
      <PlanCard
        chips={many}
        state="proposed"
        onRun={() => {}}
        onChange={() => {}}
      />,
    );
    const i = screen
      .getAllByRole("listitem")
      .map((li) => li.style.getPropertyValue("--i"));
    expect(i).toEqual(["0", "1", "2", "3", "4", "5", "5", "5"]);
  });
});

describe("ProbeReadout", () => {
  test("a 200-character name is cut by CSS and kept whole in the title", () => {
    const name = "a".repeat(196) + ".mp4";
    render(
      <ProbeReadout name={name} size={1_200_000} probe={PROBE} state="read" />,
    );
    const b = screen.getByTitle(name);
    expect(b.textContent).toBe(name);
    expect(screen.getByText("1.2 MB")).toBeTruthy();
  });

  test("read shows length, picture, format and sound in plain words", () => {
    render(
      <ProbeReadout
        name="detective.mp4"
        size={1000}
        probe={PROBE}
        state="read"
      />,
    );
    const dd = [...document.querySelectorAll("dd")].map((d) => d.textContent);
    expect(dd).toEqual(["0:16", "1920 × 1080", "MP4, H.264", "None"]);
  });

  test("unreadable says what to do; loading says it is reading", () => {
    const { rerender } = render(
      <ProbeReadout name="a.mp4" size={5} probe={null} state="unreadable" />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /can't be read.*Try another file/,
    );
    rerender(
      <ProbeReadout name="a.mp4" size={5} probe={null} state="loading" />,
    );
    expect(screen.getByRole("status").textContent).toBe("Reading the video");
  });
});

describe("questions, notices and the loader", () => {
  test("AskUser answers with a suggestion or with typed text", () => {
    const onAnswer = vi.fn();
    render(
      <AskUser
        question="Which part do you want to keep?"
        suggestions={["The first half", "The last half"]}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "The last half" }));
    expect(onAnswer).toHaveBeenLastCalledWith("The last half");
    const box = screen.getByLabelText("Which part do you want to keep?");
    fireEvent.change(box, { target: { value: "  from 0:05  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onAnswer).toHaveBeenLastCalledWith("from 0:05");
  });

  test("Unsupported states the reason, links the nearest chore and offers a way on", () => {
    const next = vi.fn();
    render(
      <Unsupported
        reason="I can't add subtitles yet."
        nearestChore={{ name: "Cut a clip", href: "/chores/trim" }}
        onNewRequest={next}
      />,
    );
    expect(screen.getByText("I can't add subtitles yet.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Cut a clip" }).getAttribute("href"),
    ).toBe("/chores/trim");
    fireEvent.click(
      screen.getByRole("button", { name: "Try another request" }),
    );
    expect(next).toHaveBeenCalled();
  });

  test.each(["no-isolation", "no-webgpu", "low-memory", "mobile"])(
    "CapabilityNotice for %s is an alert with a sentence",
    (reason) => {
      render(<CapabilityNotice reason={reason} />);
      expect(screen.getByRole("alert").textContent.length).toBeGreaterThan(40);
    },
  );

  test("ModelLoader shows the percent as text, with no motion element, so reduced motion changes nothing", () => {
    vi.stubGlobal("matchMedia", (q) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<ModelLoader state="downloading" percent={41.6} sizeMb={394} />);
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/394 MB/);
    expect(document.querySelector("[role=progressbar], svg, .bar")).toBeNull();
    vi.unstubAllGlobals();
  });

  test("StatusDot says the state in words", () => {
    render(<StatusDot status="ready" />);
    expect(screen.getByRole("status").textContent).toBe(
      "Ready, on this computer",
    );
  });
});

describe("every control is a real, named, focusable control", () => {
  test("buttons and fields have an accessible name and take focus", () => {
    render(
      <>
        <RequestField
          value="x"
          onChange={() => {}}
          onSubmit={() => {}}
          locked={false}
        />
        <PlanCard
          chips={[["Size", "under 3 MB", 1]]}
          state="proposed"
          onRun={() => {}}
          onChange={() => {}}
        />
        <AskUser
          question="Which part?"
          suggestions={["All"]}
          onAnswer={() => {}}
        />
        <Unsupported reason="no" onNewRequest={() => {}} />
      </>,
    );
    const controls = [
      ...document.querySelectorAll("button:enabled, input, textarea"),
    ];
    expect(controls.length).toBeGreaterThanOrEqual(7);
    for (const c of controls) {
      const name =
        c.labels?.[0]?.textContent ||
        c.getAttribute("aria-labelledby") ||
        c.getAttribute("aria-label") ||
        c.textContent;
      expect(name.trim(), c.outerHTML).not.toBe("");
      c.focus();
      expect(document.activeElement).toBe(c);
    }
  });
});
