// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Viewer from "../../app/components/tool/Viewer.jsx";

afterEach(cleanup);

const props = {
  originalUrl: "blob:orig",
  resultUrl: "blob:result",
  name: "talk.mp4",
};

describe("an audio-only result (owner decision, 2026-11-24)", () => {
  test("is a native audio player with a one-line caption, not a blank video box", () => {
    const { container } = render(<Viewer {...props} audioOnly />);
    const audio = container.querySelector("audio");
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(audio?.getAttribute("src")).toBe("blob:result");
    expect(container.querySelector("video")).toBeNull();
    expect(
      screen.getByText(/Audio only: this file has no picture/),
    ).toBeTruthy();
  });

  test("switching back to your own video shows the video, not the audio player", () => {
    const { container } = render(<Viewer {...props} audioOnly />);
    fireEvent.click(screen.getByRole("button", { name: "Your video" }));
    expect(container.querySelector("audio")).toBeNull();
    expect(container.querySelector("video")).toBeTruthy();
  });

  test("a video result still shows a video", () => {
    const { container } = render(<Viewer {...props} />);
    expect(container.querySelector("video")).toBeTruthy();
    expect(container.querySelector("audio")).toBeNull();
  });
});
