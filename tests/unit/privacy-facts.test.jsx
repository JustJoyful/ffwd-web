// Review S6: the privacy page states the facts the code creates: the model host sees the IP, the device description is
// remembered (and for how long), and the analytics id is not stored while persistence is "memory".
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
    expect(ANALYTICS_PERSISTENCE).toBe("memory");
    const t = text();
    expect(t).toMatch(/ffwd keeps no ID in your browser/);
    expect(t).not.toMatch(/keeps a random ID in your browser's local storage/);
  });
});
