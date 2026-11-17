import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import "../styles/theme.css";
import "../styles/tool.css";
import { MAX_RUNS } from "../agent/config.js";
import { INPUT_ID } from "../agent/browser-runtime.js";
import AskUser from "../components/tool/AskUser.jsx";
import CapabilityNotice from "../components/tool/CapabilityNotice.jsx";
import CommandReveal from "../components/tool/CommandReveal.jsx";
import DownloadButton from "../components/tool/DownloadButton.jsx";
import DropOverlay from "../components/tool/DropOverlay.jsx";
import FileIntake from "../components/tool/FileIntake.jsx";
import PlanCard from "../components/tool/PlanCard.jsx";
import ProbeReadout from "../components/tool/ProbeReadout.jsx";
import RequestField from "../components/tool/RequestField.jsx";
import RunLog from "../components/tool/RunLog.jsx";
import RunProgress from "../components/tool/RunProgress.jsx";
import StatusDot from "../components/tool/StatusDot.jsx";
import Unsupported from "../components/tool/Unsupported.jsx";
import Viewer from "../components/tool/Viewer.jsx";
import { bindAnalytics } from "../tool/analytics-bridge.js";
import { chipsFromSpec, displayArgs } from "../tool/chips.js";
import { useTool } from "../tool/store.js";

// The tool. Client-only: no server data and nothing prerendered, because it needs the browser (WebGPU, workers,
// SharedArrayBuffer). The clientLoader makes React Router treat it that way and the heavy runtime stays in this
// route's chunk, so the marketing pages never load it.
export function clientLoader() {
  return null;
}

export function HydrateFallback() {
  return <p className="tool__status">Starting ffwd</p>;
}

// Where the machine accepts a new file (machine.js FILE_STATES) and where the person is waiting on the machine.
const FILE_STATES = [
  "ready",
  "awaitingRequest",
  "done",
  "failed",
  "unsupported",
];
const WORKING = ["probing", "planning", "running", "checking"];
const MIME = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

const FAIL_TEXT = {
  run_budget: `ffwd tried ${MAX_RUNS} times and no result passed its checks, so there is nothing to download. Try wording the request differently.`,
  turn_budget:
    "ffwd couldn't settle on a plan. Try wording the request differently.",
  policy_error: "The model couldn't answer. Reload the page and try again.",
};
const IDLE = {
  plan: "A plan you can read appears here, before anything runs.",
  checks: "Each result is measured here.",
  save: "Your checked file appears here.",
};

const sizeText = (n) =>
  n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1000))} KB`;
const stem = (name) => name.replace(/\.[^.]+$/, "") || "video";

function Step({ n, title, mod, children }) {
  return (
    <section className={`step ${mod}`}>
      <span className="num" aria-hidden="true">
        {n}
      </span>
      <h3>{title}</h3>
      <div className="step__body">{children}</div>
    </section>
  );
}

export default function App() {
  const [params] = useSearchParams();
  const { state, dispatch, store } = useTool();
  // Category-and-number events for the funnel; subscribed before the tool's own start effect fires its first event.
  useEffect(() => bindAnalytics(store), [store]);
  // ?ask= comes from a chore page: it fills the field, the person still presses Enter
  const [request, setRequest] = useState(params.get("ask") ?? "");
  const [file, setFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState(null);
  const [dropNotice, setDropNotice] = useState(null);
  const [report, setReport] = useState(null);
  const [made, setMade] = useState(null);
  const field = useRef(null);

  const name = state.name;
  const input = state.inputs[0];
  const unsupportedDevice = name === "unsupportedDevice";
  const canPick = FILE_STATES.includes(name);

  const onFile = useCallback(
    (f) => {
      setFile(f);
      // the viewer plays the chosen video from a URL; the previous one is released here
      setOriginalUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(f);
      });
      setDropNotice(null);
      dispatch({ type: "fileChosen", file: f });
    },
    [dispatch],
  );

  // Release the video's URL when the page closes.
  const urlRef = useRef(null);
  useEffect(() => {
    urlRef.current = originalUrl;
  }, [originalUrl]);
  useEffect(
    () => () => urlRef.current && URL.revokeObjectURL(urlRef.current),
    [],
  );

  // The person starts typing as soon as the video has been read.
  useEffect(() => {
    if (name === "awaitingRequest") field.current?.focus();
  }, [name]);

  // FFmpeg's own progress, only while a run is going (the checks run FFmpeg too, and are not "the run"). The report
  // is keyed by the run count, so a number from an earlier run never shows on the next one.
  const runs = state.runs;
  useEffect(() => {
    if (name !== "running") return;
    return store.runtime.session?.onProgress?.((r) =>
      setReport({ runs, percent: r * 100 }),
    );
  }, [name, runs, store]);
  const progress =
    name === "running" && report?.runs === runs ? report.percent : null;

  // What the person downloads: the output of the passing run, read out of the ffmpeg worker when the job is done.
  const passing = state.history.findLast((r) => r.passed);
  const outHandle = name === "done" ? passing?.outputs?.out1 : null;
  const container = state.spec?.outputs?.[0]?.container || "mp4";
  const outName = `${stem(file?.name ?? "video")}-ffwd.${container}`;
  useEffect(() => {
    if (!outHandle || !store.runtime.readOutput) return;
    let stale = false;
    let url;
    store.runtime
      .readOutput(outHandle, MIME[container] ?? "application/octet-stream")
      .then((blob) => {
        if (stale) return;
        url = URL.createObjectURL(blob);
        setMade({ handle: outHandle, blob, url });
      })
      .catch(
        () => !stale && setMade({ handle: outHandle, blob: null, url: null }),
      );
    return () => {
      stale = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [outHandle, container, store]);
  const result = made?.handle === outHandle ? made : null;

  const chips =
    state.spec && input ? chipsFromSpec(state.spec, input.probe) : [];
  const showPlan =
    chips.length > 0 &&
    ["awaitingConfirm", "running", "checking", "done", "failed"].includes(name);
  const unreadable = name === "ready" && Boolean(state.error);
  const edited = name === "awaitingConfirm" && request.trim() !== state.request;
  const dot = unsupportedDevice
    ? "stopped"
    : name === "checkingCapability"
      ? "starting"
      : WORKING.includes(name)
        ? "busy"
        : "ready";
  const again = () => {
    dispatch({ type: "newRequest" });
  };

  const stepVideo = input ? "is-done" : "is-active";
  const stepAsk = !input
    ? ""
    : name === "awaitingRequest"
      ? "is-active"
      : "is-done";
  const stepPlan = [
    "planning",
    "askingUser",
    "awaitingConfirm",
    "unsupported",
  ].includes(name)
    ? "is-active"
    : ["running", "checking", "done", "failed"].includes(name)
      ? "is-done"
      : "";
  const stepChecks = ["running", "checking"].includes(name)
    ? "is-active"
    : name === "done"
      ? "is-done"
      : "";

  return (
    <main className="tool" data-state={name}>
      <h1 className="sr">ffwd, a checked video tool</h1>
      {!unsupportedDevice && (
        <DropOverlay
          onFile={onFile}
          onNotice={setDropNotice}
          disabled={!canPick}
        />
      )}
      <div className="win">
        <div className="win__bar">
          <Link className="win__brand" to="/" aria-label="ffwd, home">
            <svg viewBox="0 0 28 20" aria-hidden="true">
              <path d="M0 0 14 7v6L0 20Z" fill="var(--text)" />
              <path d="M17 5l11 5-11 5Z" fill="var(--accent)" />
            </svg>
            <span>ffwd</span>
          </Link>
          <StatusDot status={dot} />
        </div>

        {unsupportedDevice ? (
          <div className="win__solo">
            <CapabilityNotice reason={state.reason} />
          </div>
        ) : (
          <div className="win__body">
            <div className="steps">
              <Step n={1} title="Video" mod={stepVideo}>
                {file && (
                  <ProbeReadout
                    name={file.name}
                    size={file.size}
                    probe={input?.probe ?? null}
                    state={
                      name === "probing"
                        ? "loading"
                        : unreadable
                          ? "unreadable"
                          : input
                            ? "read"
                            : "loading"
                    }
                  />
                )}
                {!file && (
                  <p className="step__hint">
                    Choose a video or drop one here. It stays on this computer.
                  </p>
                )}
                <FileIntake
                  onFile={onFile}
                  disabled={!canPick}
                  notice={dropNotice}
                  quiet={Boolean(input)}
                  label={file ? "Choose another video" : "Choose a video"}
                />
              </Step>

              <Step n={2} title="What should happen?" mod={stepAsk}>
                <RequestField
                  value={request}
                  onChange={setRequest}
                  onSubmit={(text) =>
                    dispatch(
                      name === "awaitingConfirm"
                        ? { type: "requestEdited", request: text }
                        : { type: "requestSubmitted", request: text },
                    )
                  }
                  locked={
                    ![
                      "checkingCapability",
                      "ready",
                      "probing",
                      "awaitingRequest",
                      "awaitingConfirm",
                    ].includes(name)
                  }
                  canSubmit={name === "awaitingRequest" || edited}
                  submitLabel={
                    name === "awaitingConfirm"
                      ? "Make a new plan"
                      : "Make a plan"
                  }
                  inputRef={field}
                />
              </Step>

              <Step n={3} title="Plan" mod={stepPlan}>
                {name === "planning" && (
                  <p className="step__hint" role="status">
                    Working out a plan
                  </p>
                )}
                {name === "askingUser" && (
                  <AskUser
                    question={state.question}
                    onAnswer={(text) => dispatch({ type: "answered", text })}
                  />
                )}
                {name === "unsupported" && (
                  <Unsupported reason={state.reason} onNewRequest={again} />
                )}
                {showPlan && (
                  <PlanCard
                    key={state.request}
                    chips={chips}
                    state={
                      name === "awaitingConfirm"
                        ? edited
                          ? "edited"
                          : "proposed"
                        : "confirmed"
                    }
                    onRun={() => dispatch({ type: "confirmed" })}
                    onChange={() => field.current?.focus()}
                  />
                )}
                {!showPlan &&
                  !["planning", "askingUser", "unsupported"].includes(name) && (
                    <p className="step__hint">{IDLE.plan}</p>
                  )}
              </Step>

              <Step n={4} title="Checks" mod={stepChecks}>
                {state.history.length === 0 &&
                  !["running", "checking"].includes(name) && (
                    <p className="step__hint">{IDLE.checks}</p>
                  )}
                <RunLog runs={state.history}>
                  {name === "running" && (
                    <RunProgress
                      percent={progress}
                      label={state.history.length ? "Running again" : "Running"}
                    />
                  )}
                  {name === "checking" && (
                    <RunProgress percent={null} label="Checking the result" />
                  )}
                  {name === "done" && (
                    <p className="run__done" role="status">
                      Done, every check passed
                    </p>
                  )}
                  {name === "failed" && (
                    <div className="notice notice--bad" role="status">
                      <p className="notice__t">Nothing to download</p>
                      <p>{FAIL_TEXT[state.reason] ?? state.reason}</p>
                      {state.error && (
                        <p className="notice__detail">{state.error}</p>
                      )}
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={again}
                      >
                        Try another request
                      </button>
                    </div>
                  )}
                </RunLog>
              </Step>

              <Step n={5} title="Save" mod={name === "done" ? "is-done" : ""}>
                {name !== "done" && <p className="step__hint">{IDLE.save}</p>}
                {name === "done" && (
                  <div className="reveal is-on">
                    <div className="save">
                      <DownloadButton
                        key={outHandle}
                        blob={result?.blob ?? null}
                        name={outName}
                      />
                      <small>
                        {result?.blob
                          ? `${outName}, ${sizeText(result.blob.size)}`
                          : result
                            ? "This result can't be saved as one file yet"
                            : "Getting the file ready"}
                      </small>
                    </div>
                    <CommandReveal
                      args={displayArgs(
                        passing.args,
                        { [INPUT_ID]: file?.name ?? "input" },
                        { out1: outName },
                      )}
                      chips={chips}
                    />
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost again"
                      onClick={again}
                    >
                      Start another request
                    </button>
                  </div>
                )}
              </Step>
            </div>

            <div className="stage">
              <Viewer
                originalUrl={unreadable ? null : originalUrl}
                resultUrl={result?.url ?? null}
                name={file?.name ?? ""}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
