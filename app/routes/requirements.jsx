import "../styles/theme.css";
import "../styles/pages.css";
import { SiteFooter, SiteNav } from "../components/site/Shell.jsx";
import {
  MAX_FILE_BYTES_PER_GB,
  MIN_DEVICE_MEMORY_GB,
  REASON_TEXT,
  estimateWait,
  maxFileBytes,
} from "../lib/capability.js";

// COPY FOR OWNER REVIEW. Source of the content: PRD section 11 (provisional) and the checks in app/lib/capability.js.
// Every number is printed from a constant there (data-const marks it; the build test compares each one), so this page
// cannot disagree with what the tool actually checks. PRD section 11 still lists RAM and file-size limits as "to be
// measured in Phase 0", so the page calls the numbers provisional and states no figure of its own.

export function meta() {
  return [
    { title: "System requirements: what ffwd needs to run" },
    {
      name: "description",
      content:
        "ffwd runs in a current desktop browser with WebGPU and enough memory. This page says what it checks and what to do if your computer fails a check.",
    },
  ];
}

const MIB = 1024 * 1024;
const Num = ({ name, value }) => <b data-const={name}>{value}</b>;

// What to do, per reason. The first sentence of each section is the one the tool shows (REASON_TEXT).
const SECTIONS = {
  "no-isolation": {
    heading: "The page can't start the video engine",
    body: (
      <>
        <p>
          ffwd cuts and converts video with an engine that runs inside the page,
          and the engine needs a browser feature (shared memory) that is only
          switched on for sites that ask for it. Older browsers and some in-app
          browsers do not have it.
        </p>
        <p>
          Open the page in a current desktop Chrome, Edge or Firefox, not inside
          another app, and reload it.
        </p>
      </>
    ),
  },
  "no-webgpu": {
    heading: "No graphics acceleration: ffwd uses your processor",
    body: (
      <>
        <p>
          ffwd runs its model on your graphics chip through WebGPU when the
          browser offers a real one. Without it ffwd still works: it runs the
          model on your processor, more slowly, and the page tells you which one
          it is using.
        </p>
        <p>
          On the laptop we measured, the first step took about{" "}
          <Num
            name="CPU_FIRST_STEP_SECONDS"
            value={estimateWait("cpu").firstStepSeconds}
          />{" "}
          seconds and each step after it about{" "}
          <Num
            name="CPU_LATER_STEP_SECONDS"
            value={estimateWait("cpu").laterStepSeconds}
          />{" "}
          seconds. A slower computer takes longer. In Chrome or Edge, update the
          browser and check that hardware acceleration is switched on in its
          settings. Firefox and Safari are not tested yet.
        </p>
      </>
    ),
  },
  "low-memory": {
    heading: "The computer doesn't have enough memory",
    body: (
      <>
        <p>
          ffwd turns you away when your browser reports less than{" "}
          <Num name="MIN_DEVICE_MEMORY_GB" value={MIN_DEVICE_MEMORY_GB} /> GB of
          memory. Browsers round this number and cap it, so it is a guide and
          not an exact reading. This limit is provisional and will change once
          it has been measured on real computers.
        </p>
        <p>
          Close other tabs and programs and reload the page. The desktop app is
          planned but is not available yet.
        </p>
        <p>
          Large videos need memory too: ffwd warns before it opens a video
          bigger than about{" "}
          <Num name="MAX_FILE_MB_PER_GB" value={MAX_FILE_BYTES_PER_GB / MIB} />{" "}
          MB for each GB of memory, which is{" "}
          <Num name="MAX_FILE_MB_AT_4_GB" value={maxFileBytes(4) / MIB} /> MB on
          a computer with{" "}
          <Num name="MIN_DEVICE_MEMORY_GB" value={MIN_DEVICE_MEMORY_GB} /> GB.
          The warning does not stop you: a file that really is too big ends as
          "can't be read".
        </p>
      </>
    ),
  },
  mobile: {
    heading: "Phones and tablets",
    body: (
      <>
        <p>
          The video engine and the model need more room than a phone browser
          gives them.
        </p>
        <p>
          Open ffwd on a laptop or desktop computer. On the home page, the
          button on a phone copies the link so you can send it to yourself.
        </p>
      </>
    ),
  },
};
for (const id of Object.keys(REASON_TEXT))
  if (!SECTIONS[id]) throw new Error(`requirements page: no section for ${id}`);

export default function Requirements() {
  return (
    <>
      <SiteNav />
      <main id="main" className="page">
        <div className="wrap">
          <div className="page__top">
            <h1>What ffwd needs to run</h1>
            <div className="prose" style={{ marginTop: "1.5rem" }}>
              <p>
                ffwd runs in your browser, so it asks a little of your computer.
                It checks these things before it does anything, and tells you
                which one failed.
              </p>
              <ul>
                <li>A desktop or laptop computer.</li>
                <li>
                  A current Chrome or Edge. Firefox and Safari may work but are
                  not tested yet.
                </li>
                <li>
                  A graphics chip the browser can use (WebGPU) for speed.
                  Without one ffwd still runs, more slowly.
                </li>
                <li>
                  Enough memory:{" "}
                  <Num
                    name="MIN_DEVICE_MEMORY_GB"
                    value={MIN_DEVICE_MEMORY_GB}
                  />{" "}
                  GB or more, provisionally.
                </li>
              </ul>
              <p>
                A desktop app for bigger files is planned, for Windows first,
                then Linux, then macOS. It is not available yet.
              </p>
            </div>
          </div>

          {Object.entries(SECTIONS).map(([id, s]) => (
            <section key={id} id={id} aria-labelledby={`${id}-h`}>
              <h2 id={`${id}-h`}>{s.heading}</h2>
              <div className="prose">
                <p>{REASON_TEXT[id]}</p>
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
