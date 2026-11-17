import { useSearchParams } from "react-router";
import "../styles/theme.css";
import { REASON_TEXT } from "../lib/capability.js";
import { useTool } from "../tool/store.js";

// The tool. Client-only: no server data and nothing prerendered, because it needs the browser (WebGPU, workers,
// SharedArrayBuffer). The clientLoader makes React Router treat it that way and the heavy runtime stays in this
// route's chunk, so the marketing pages never load it. This is the shell; the components arrive in Plan C Tasks 6 to 9.
export function clientLoader() {
  return null;
}

export function HydrateFallback() {
  return <p className="tool__status">Starting ffwd</p>;
}

export default function App() {
  const [params] = useSearchParams();
  const { state } = useTool();
  return (
    <main className="tool" data-state={state.name}>
      <h1>ffwd</h1>
      {state.name === "unsupportedDevice" ? (
        <p role="alert">{REASON_TEXT[state.reason] ?? state.reason}</p>
      ) : (
        <>
          <label htmlFor="request">What should happen to your video?</label>
          {/* ?ask= comes from a chore page: it fills the field, the person still presses Enter */}
          <textarea id="request" defaultValue={params.get("ask") ?? ""} />
        </>
      )}
    </main>
  );
}
