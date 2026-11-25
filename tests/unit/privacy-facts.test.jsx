// Review S6: the privacy page states the facts the code creates: the model host sees the IP, the device description is
// remembered (and for how long), and the analytics id is a random localStorage id, no cookies.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Privacy from "../../app/routes/privacy.jsx";
import { ANALYTICS_PERSISTENCE } from "../../app/config.js";
import { PATH_CHOICE } from "../../app/model/config.js";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
const text = () => {
  render(
    <MemoryRouter>
      <Privacy />
    </MemoryRouter>,
  );
  return document.body.textContent.replace(/\s+/g, " ");
};

describe("the privacy page", () => {
  test("names the model host (from the build's model URL) and says it sees the IP address", () => {
    vi.stubEnv(
      "VITE_MODEL_MANIFEST_URL",
      "https://models.example.org/x/m.gguf",
    );
    const t = text();
    expect(t).toMatch(/downloaded once, from models\.example\.org/);
    expect(t).toMatch(/That server sees your IP address/);
    expect(t).toMatch(/no video, no text and no file names/);
  });
  test("without a model URL it still says a model host sees the IP, and invents no host name", () => {
    vi.stubEnv("VITE_MODEL_MANIFEST_URL", "");
    const t = text();
    expect(t).toMatch(/from the model host/);
    expect(t).toMatch(/sees your IP address/);
  });
  test("says the graphics-chip description is remembered, never sent, and for how long", () => {
    const t = text();
    expect(t).toMatch(
      /remembers in your browser's local storage a short description of your graphics chip/,
    );
    expect(t).toMatch(/never sent anywhere/);
    expect(t).toContain(`forgotten after ${PATH_CHOICE.cacheTtlDays} days`);
    expect(t).toContain(`after ${PATH_CHOICE.runtimeVerdictHours} hours`);
  });
  test("what it says about the analytics id follows the persistence setting", () => {
    expect(ANALYTICS_PERSISTENCE).toBe("localStorage");
    const t = text();
    expect(t).toMatch(
      /keeps a random anonymous ID in your browser's local storage on this device/,
    );
    expect(t).toMatch(/ffwd sets no cookies/);
    expect(t).toMatch(/Global Privacy Control, ffwd respects it/);
    expect(t).not.toMatch(/ffwd keeps no ID in your browser/);
  });
});

describe("the privacy page: feedback", () => {
  test("states what is sent, when, where it goes, and that it is separate from analytics", () => {
    const t = text();
    expect(t).toContain("Feedback you choose to send");
    expect(t).toMatch(/sends nothing unless you click Send/);
    expect(t).toMatch(/request text you typed, with your file's name removed/);
    expect(t).toMatch(/Not sent: your video, your file names/);
    expect(t).toMatch(/database that ffwd's owner can read/);
    expect(t).toMatch(/kept until the owner deletes it/);
    expect(t).toMatch(/no IP address, no account and no analytics ID/);
    expect(t).toMatch(/works even if the counting is off/);
  });
});
