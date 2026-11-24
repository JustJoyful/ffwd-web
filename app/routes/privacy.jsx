import "../styles/theme.css";
import "../styles/pages.css";
import { SiteFooter, SiteNav } from "../components/site/Shell.jsx";
import { ANALYTICS_PERSISTENCE, RESPECT_DNT_GPC } from "../config.js";
import { EVENTS, TRANSPORT_KEYS } from "../lib/analytics.js";
import { PATH_CHOICE, modelHost } from "../model/config.js";

// COPY FOR OWNER REVIEW. The ledger table and the "How to check" text come from COPY_PAGE.md section 3. The event
// list is printed from EVENTS (app/lib/analytics.js), the same object the code sends from, so the page and the code
// cannot drift: a new event without a note below stops the build.

export function meta() {
  return [
    { title: "Privacy: what ffwd sends and what stays on your computer" },
    {
      name: "description",
      content:
        "ffwd runs in your browser tab and never uploads your video. This page lists the few anonymous counts it sends, and everything it never collects.",
    },
  ];
}

// One plain sentence per event. soon: the event exists in the code but nothing sends it until the model or the desktop
// app exists.
const NOTE = {
  site_visit: {
    text: "You opened a page. It says which page, and the website you came from (the domain only, never the full address).",
  },
  capability_checked: {
    text: "ffwd checked whether your browser can run it. It says whether the model will run on your graphics chip (WebGPU) or on the processor, and, if ffwd cannot run at all, which reason from a fixed list.",
  },
  model_load_started: {
    text: "The model began downloading or loading. It says which version and whether it was already saved in your browser.",
  },
  model_load_completed: {
    text: "The model finished loading. It says which version, whether it was already saved in your browser, how long it took as a range such as “5 to 15 s”, whether it runs on your graphics chip or your processor, and what the one-time graphics check found (passed, failed, or skipped). It never says which graphics chip you have; that stays in your browser.",
  },
  edit_started: {
    text: "A plan was shown for your request. It says which kind of chore (a code such as F1), whether it ran in the browser or the desktop app, and the size of your video and the number of files as ranges such as “10 to 100 MB”.",
  },
  spec_confirmed: {
    text: "You pressed Run it. It says only whether you changed your request first.",
  },
  edit_completed: {
    text: "A result passed its checks. It says how many runs that took, how long as a range, whether the video had to be rebuilt instead of copied, and the model version.",
  },
  edit_failed: {
    text: "No result passed its checks. It says why, from a fixed list, for example that the run limit was reached.",
  },
  ask_user_shown: {
    text: "ffwd asked you a question. It sends a category, never the question.",
  },
  unsupported_shown: {
    text: "ffwd said it can't do your request. It sends a category, never your words.",
  },
  helper_detected: {
    text: "The desktop app was found on your computer.",
    soon: true,
  },
  helper_handoff: {
    text: "A job was handed to the desktop app.",
    soon: true,
  },
};
for (const name of Object.keys(EVENTS))
  if (!NOTE[name]) throw new Error(`privacy page: no note for event ${name}`);

const Codes = ({ items }) =>
  items.map((k, i) => (
    <span key={k}>
      {i > 0 && ", "}
      <code>{k}</code>
    </span>
  ));

export default function Privacy() {
  return (
    <>
      <SiteNav />
      <main id="main" className="page">
        <div className="wrap">
          <section className="priv priv__grid page__top" aria-labelledby="h1">
            <div>
              <h1 id="h1">Stays on this computer</h1>
              <p className="lead-l">
                ffwd runs inside your browser tab. Your video is never uploaded.
              </p>
              <details className="how">
                <summary>How to check</summary>
                <ol>
                  <li>
                    Open your browser's developer tools (F12 in most browsers)
                    and choose the Network tab.
                  </li>
                  <li>Choose a video and run a job.</li>
                  <li>
                    Look through the requests. Your video is not in any of them.
                    The only requests to the counting service hold the
                    categories and numbers listed below.
                  </li>
                </ol>
                <p>[Confirm on the built site before publishing.]</p>
              </details>
            </div>
            <div className="ledger">
              <table>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">Where it goes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Your video</td>
                    <td className="stay">Stays on this computer</td>
                  </tr>
                  <tr>
                    <td>The sentence you type</td>
                    <td className="stay">Stays on this computer</td>
                  </tr>
                  <tr>
                    <td>File names and folders</td>
                    <td className="stay">Stays on this computer</td>
                  </tr>
                  <tr>
                    <td>The model and video tools</td>
                    <td>Downloaded once, then kept in your browser</td>
                  </tr>
                  <tr>
                    <td>Visits, finished jobs and which kind of chore</td>
                    <td>Sent as anonymous counts</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="count-h">
            <h2 id="count-h">What ffwd counts</h2>
            <div className="prose">
              <p>
                ffwd counts visits and finished jobs, so its owner can see
                whether it is useful. The counting is done by PostHog and it is
                anonymous: there is no account and no sign-in, and ffwd never
                links a count to a name.
              </p>
              <p>
                Each count is one of the events below. A detail is one value
                that goes with it. Sizes and times are sent as ranges, never as
                exact numbers. Nothing else is sent.
              </p>
            </div>
            <dl className="terms">
              {Object.entries(EVENTS).map(([name, keys]) => (
                <div key={name}>
                  <dt>
                    <code>{name}</code>
                  </dt>
                  <dd>
                    {NOTE[name].text}{" "}
                    <span>
                      Details: <Codes items={keys} />.
                    </span>
                    {NOTE[name].soon && (
                      <span className="soon">
                        {" "}
                        Not sent yet: this arrives with a later version.
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="prose" style={{ marginTop: "1rem" }}>
              To receive these counts PostHog also needs a project key and a
              random ID for your browser (
              <Codes items={TRANSPORT_KEYS} />
              ). None of these says anything about you. ffwd strips everything
              else PostHog would normally add, such as the address of the page.
            </p>
          </section>

          <section id="never-collected" aria-labelledby="never-h">
            <h2 id="never-h">What ffwd never collects</h2>
            <ul className="prose">
              <li>Your videos, or anything inside them.</li>
              <li>The sentence you type to describe the chore.</li>
              <li>Your file names, folders or paths on your computer.</li>
              <li>
                Web addresses, clicks, keystrokes or screen recordings.
                Automatic capture and session replay are off.
              </li>
              <li>
                Your IP address.{" "}
                <span>
                  [Confirm IP capture is off in the PostHog project settings
                  before publishing.]
                </span>
              </li>
            </ul>
          </section>

          <section aria-labelledby="id-h">
            <h2 id="id-h">The ID in your browser</h2>
            <div className="prose">
              {ANALYTICS_PERSISTENCE === "localStorage" ? (
                <p>
                  To tell a returning browser from a new one, ffwd keeps a
                  random anonymous ID in your browser's local storage on this
                  device. It is not linked to who you are, and ffwd sets no
                  cookies. Clearing your browser's site data removes it.
                </p>
              ) : (
                <p>
                  ffwd keeps no ID in your browser. Each visit is counted on its
                  own, so a returning visitor looks like a new one.
                </p>
              )}
              {RESPECT_DNT_GPC && (
                <p>
                  If your browser sends Do Not Track or Global Privacy Control,
                  ffwd respects it: the counting service is not loaded at all,
                  so no ID is created.
                </p>
              )}
            </div>
          </section>

          <section id="model-download" aria-labelledby="dl-h">
            <h2 id="dl-h">Where the model comes from</h2>
            <p className="prose">
              The model file is downloaded once, from{" "}
              {modelHost() ? <code>{modelHost()}</code> : "the model host"}.
              That server sees your IP address and your browser type when you
              download it, as any website does. ffwd sends it no video, no text
              and no file names. After that the model is kept in your browser
              and is not downloaded again.
            </p>
          </section>

          <section id="device-memory" aria-labelledby="dev-h">
            <h2 id="dev-h">What else your browser remembers</h2>
            <p className="prose">
              To pick the faster way to run the model, ffwd remembers in your
              browser's local storage a short description of your graphics chip
              (its maker and model name), your browser's version number and two
              speed measurements. It stays on your computer and is never sent
              anywhere. It is forgotten after {PATH_CHOICE.cacheTtlDays} days,
              or after {PATH_CHOICE.runtimeVerdictHours} hours if your graphics
              chip gave answers ffwd could not read.
            </p>
          </section>

          <section aria-labelledby="ask-h">
            <h2 id="ask-h">Questions</h2>
            <p className="prose">
              Write to <span>[contact address]</span>.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
