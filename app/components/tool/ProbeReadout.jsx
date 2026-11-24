import { displaySize } from "../../agent/checker/quality.js";

const CODEC = {
  h264: "H.264",
  hevc: "HEVC",
  vp9: "VP9",
  av1: "AV1",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
};

export const UNREADABLE_TEXT =
  "This video can't be read. It may be damaged or in a format ffwd doesn't support. Try another file.";

// The engine that reads videos did not start. Said plainly so the person does not blame the file.
export const ENGINE_TEXT =
  "ffwd's video engine didn't start, so it can't read this video. Nothing is wrong with your file. Reload the page and try again.";

const sizeText = (n) =>
  n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1000))} KB`;
const clock = (s) => {
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
};

/** The label/value pairs a person cares about, in the home page's words. */
export function probeRows(probe, name = "") {
  const v = probe.streams.find((s) => s.type === "video");
  const a = probe.streams.find((s) => s.type === "audio");
  const ext = /\.([A-Za-z0-9]{2,5})$/.exec(name)?.[1]?.toUpperCase();
  const box = ext ?? probe.container.split(",")[0].toUpperCase();
  const [w, h] = v ? displaySize(v) : [null, null];
  return [
    ["Length", probe.duration_s ? clock(probe.duration_s) : "Unknown"],
    ["Picture", w ? `${w} × ${h}` : "None"],
    [
      "Format",
      v ? `${box}, ${CODEC[v.codec] ?? String(v.codec).toUpperCase()}` : box,
    ],
    ["Sound", a ? (CODEC[a.codec] ?? String(a.codec).toUpperCase()) : "None"],
  ];
}

/**
 * @param {{ name: string, size: number, probe: object | null, state: "loading" | "read" | "unreadable" | "engine" }} props
 */
export default function ProbeReadout({ name, size, probe, state }) {
  return (
    <div className="readout" data-state={state}>
      <p className="readout__file">
        {/* a long name is cut with an ellipsis; the whole name stays in the title and for screen readers */}
        <b title={name}>{name}</b>
        <span className="tn">{sizeText(size)}</span>
      </p>
      {state === "loading" && (
        <p className="readout__note" role="status">
          Reading the video
        </p>
      )}
      {state === "unreadable" && (
        <p className="readout__note readout__note--bad" role="alert">
          {UNREADABLE_TEXT}
        </p>
      )}
      {state === "engine" && (
        <p className="readout__note readout__note--bad" role="alert">
          {ENGINE_TEXT}
        </p>
      )}
      {state === "read" && probe && (
        <dl className="probe">
          {probeRows(probe, name).flatMap(([k, v]) => [
            <dt key={`k${k}`}>{k}</dt>,
            <dd key={`v${k}`}>{v}</dd>,
          ])}
        </dl>
      )}
    </div>
  );
}
