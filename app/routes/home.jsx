import { useEffect, useRef } from "react";
import "../styles/theme.css";
import { mountSections } from "../showcase/sections.js";

// Static markup ported 1:1 from mockup-v5/index.html. No state and no props, so React never re-renders it:
// the showcase and sections modules own the demo DOM after mount. The effect mounts both on <main> and its
// cleanup undoes them, which keeps StrictMode (mount, unmount, mount) and client-side navigation clean.
// The showcase (the demo, its chore data and formatters, about 5 kB gzip) is imported when the effect runs, not up
// front: the page is readable without it and the 120 kB budget counts only what every visit loads first. The
// sections module is small and hides/reveals content, so it stays in the page's own chunk.

const Logo = () => (
  <svg viewBox="0 0 28 20" aria-hidden="true">
    <path d="M0 0 14 7v6L0 20Z" fill="var(--text)" />
    <path d="M17 5l11 5-11 5Z" fill="var(--accent)" />
  </svg>
);

const Pass = () => (
  <svg className="ico" viewBox="0 0 18 18" role="img" aria-label="passed">
    <circle cx="9" cy="9" r="8" />
    <path d="M5.5 9.3l2.3 2.3 4.7-5" />
  </svg>
);

const Fail = () => (
  <svg className="ico" viewBox="0 0 18 18" role="img" aria-label="failed">
    <circle cx="9" cy="9" r="8" />
    <path d="M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6" />
  </svg>
);

export default function Home() {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    let stopShowcase = null;
    let left = false; // the effect was cleaned up before the showcase chunk arrived (StrictMode, fast navigation)
    import("../showcase/showcase.js")
      .then(({ mountShowcase }) => {
        if (!left) stopShowcase = mountShowcase(root);
      })
      .catch(() => {}); // a failed chunk load leaves the page readable without the demo
    const stopSections = mountSections(root);
    return () => {
      left = true;
      stopShowcase?.();
      stopSections();
    };
  }, []);

  return (
    <>
      <header className="nav">
        <a className="brand" href="/" aria-label="ffwd, home">
          <Logo />
          <span>ffwd</span>
        </a>
        <nav aria-label="Main">
          <a href="/chores">Chores</a>
          <a href="#checked">How it checks</a>
          <a href="/privacy">Privacy</a>
          <a href="https://github.com/JustJoyful/ffwd" rel="noopener">
            GitHub
          </a>
        </nav>
        <div className="nav__end">
          <a className="btn btn--sm btn--ghost" href="/app" data-choose="">
            Open ffwd
          </a>
        </div>
      </header>
      <p className="preview-flag">Early preview</p>

      <main id="main" ref={ref}>
        <div className="top">
          <section className="intro" aria-labelledby="h1">
            <h1 id="h1">
              Describe the chore.<span>Get a checked video.</span>
            </h1>
            <p>
              ffwd turns one sentence into the right edit, runs it on your own
              computer, and measures the result against what you asked. Nothing
              is uploaded.
            </p>
            <div className="ctas">
              <a className="btn btn--accent" href="/app" data-choose="">
                Choose a video
              </a>
              <button className="btn btn--ghost" type="button" data-sample="">
                Try the sample clip
              </button>
            </div>
            <p className="status-line" role="status" data-status=""></p>
          </section>

          <section
            className="showcase"
            aria-label="ffwd at work on a sample clip"
          >
            <div
              className="tabs"
              role="tablist"
              aria-label="Example chores"
              data-tabs=""
            ></div>

            <div className="stand">
              <div className="win" role="tabpanel" data-ui="" id="win">
                <div className="win__bar">
                  <span className="win__brand">
                    <Logo />
                    ffwd
                  </span>
                  <span className="file-pill">
                    <b data-file-name="">detective.mp4</b>
                    <span data-file-size="" className="tn">
                      12.1 MB
                    </span>
                  </span>
                  <span className="win__state">
                    <i className="dot"></i>Model ready, on this computer
                  </span>
                </div>

                <div className="win__body">
                  <div className="steps">
                    <section className="step" data-step="video">
                      <span className="num">1</span>
                      <h3>Video</h3>
                      <div className="step__body">
                        <dl className="probe" data-probe=""></dl>
                      </div>
                    </section>
                    <section className="step" data-step="ask">
                      <span className="num">2</span>
                      <h3>What should happen?</h3>
                      <div className="step__body">
                        <p className="ask" data-ask="">
                          <span data-typed=""></span>
                          <i className="caret" aria-hidden="true"></i>
                        </p>
                      </div>
                    </section>
                    <section className="step" data-step="plan">
                      <span className="num">3</span>
                      <h3>Plan</h3>
                      <div className="step__body">
                        <div className="chips" data-plan=""></div>
                      </div>
                    </section>
                    <section className="step" data-step="check">
                      <span className="num">4</span>
                      <h3>Checks</h3>
                      <div
                        className="step__body"
                        data-runs=""
                        aria-live="polite"
                      ></div>
                    </section>
                    <section className="step" data-step="save">
                      <span className="num">5</span>
                      <h3>Save</h3>
                      <div className="step__body reveal" data-save="">
                        <div className="save">
                          <button
                            className="btn btn--sm"
                            type="button"
                            data-dl=""
                          >
                            Download
                          </button>
                          <small data-out=""></small>
                        </div>
                        <button
                          className="cmdlink"
                          type="button"
                          data-cmdlink=""
                          aria-expanded="false"
                        >
                          Show the FFmpeg command
                        </button>
                        <pre className="cmd" data-cmd="" hidden></pre>
                      </div>
                    </section>
                  </div>

                  <div className="stage">
                    <div className="viewer" data-viewer="">
                      <video
                        id="vid"
                        autoPlay
                        muted
                        loop
                        playsInline
                        poster="/media/mer-poster.jpg"
                        aria-label="Sample clip from Meridian: a detective's office, a car, a beach"
                      >
                        <source src="/media/mer-loop.mp4" type="video/mp4" />
                      </video>
                      <div className="crop" aria-hidden="true"></div>
                      <span className="tc" data-tc="">
                        0:00
                      </span>
                      <span className="badge" data-badge-text=""></span>
                    </div>
                    <div className="tl" data-tl="">
                      <div className="tl__ruler" aria-hidden="true">
                        <span>0:00</span>
                        <span>0:04</span>
                        <span>0:08</span>
                        <span>0:12</span>
                        <span>0:16</span>
                      </div>
                      <div className="track" data-track=""></div>
                      <div className="range" aria-hidden="true">
                        <span
                          className="range__t range__t--a"
                          data-ra=""
                        ></span>
                        <span
                          className="range__t range__t--b"
                          data-rb=""
                        ></span>
                      </div>
                      <div className="ph" data-ph="" aria-hidden="true"></div>
                      <p className="sr" data-tl-alt=""></p>
                    </div>
                    <div className="extra" data-extra=""></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* 2. Checked, not guessed */}
        <section className="light ckd" id="checked" aria-labelledby="ckd-h">
          <div className="wrap">
            <div className="ckd__head rv">
              <h2 id="ckd-h">Checked, not guessed</h2>
              <p className="statement">
                ffwd doesn't stop at done.
                <br />
                It stops at checked.
              </p>
              <p className="lead-l">
                Every file is measured against what you asked, before it's
                yours.
              </p>
            </div>
            <div className="ckd__body">
              <div className="ckd__visual" data-ui="" data-vis-root="">
                <div className="vis is-on" data-vis="1">
                  <div className="card">
                    <p className="card__t">Copied from a chat</p>
                    <pre className="cmd cmd--guess">
                      ffmpeg -i detective.mp4 -fs 3M small.mp4
                    </pre>
                    <div className="checks">
                      <div className="ck is-q">
                        <span>Size</span>
                        <b>
                          3.2 MB<em>still over 3 MB</em>
                        </b>
                        <i className="q">?</i>
                      </div>
                      <div className="ck is-q">
                        <span>Length</span>
                        <b>
                          0:15<em>ends 0.8 s early</em>
                        </b>
                        <i className="q">?</i>
                      </div>
                    </div>
                    <p className="card__note">
                      Nothing checked it, so nothing told you.
                    </p>
                  </div>
                </div>
                <div className="vis" data-vis="2">
                  <div className="card">
                    <p className="card__t">What should happen?</p>
                    <p className="ask">
                      Make it small enough to email, under 3 MB
                    </p>
                    <p className="card__t" style={{ marginTop: "16px" }}>
                      Plan
                    </p>
                    <div className="chips">
                      <span className="chip is-change">
                        Size<b>under 3 MB</b>
                      </span>
                      <span className="chip">
                        Length<b>0:16, unchanged</b>
                      </span>
                      <span className="chip">
                        Picture<b>1920 × 1080, unchanged</b>
                      </span>
                    </div>
                    <div className="card__actions">
                      <span className="btn btn--sm btn--blue">Run it</span>
                      <span className="card__hint">or change the plan</span>
                    </div>
                  </div>
                </div>
                <div className="vis" data-vis="3">
                  <div className="card">
                    <div className="meter">
                      <div className="meter__head">
                        <span>File size</span>
                        <span>Limit 3 MB</span>
                      </div>
                      <div className="meter__row">
                        <span>Your video</span>
                        <div className="bar">
                          <i className="in" style={{ "--w": "100%" }}></i>
                          <u style={{ left: "24.8%" }}></u>
                        </div>
                        <b>12.1 MB</b>
                      </div>
                      <div className="meter__row">
                        <span>Run 1</span>
                        <div className="bar">
                          <i className="over" style={{ "--w": "26.4%" }}></i>
                          <u style={{ left: "24.8%" }}></u>
                        </div>
                        <b>3.2 MB</b>
                      </div>
                    </div>
                    <div className="checks" style={{ marginTop: "12px" }}>
                      <div className="ck is-fail">
                        <span>Size</span>
                        <b>
                          3.2 MB<em>over your 3 MB limit</em>
                        </b>
                        <Fail />
                      </div>
                      <div className="ck">
                        <span>Length</span>
                        <b>0:16</b>
                        <Pass />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="vis" data-vis="4">
                  <div className="card">
                    <div className="meter">
                      <div className="meter__head">
                        <span>File size</span>
                        <span>Limit 3 MB</span>
                      </div>
                      <div className="meter__row">
                        <span>Run 1</span>
                        <div className="bar">
                          <i className="over" style={{ "--w": "26.4%" }}></i>
                          <u style={{ left: "24.8%" }}></u>
                        </div>
                        <b>3.2 MB</b>
                      </div>
                      <div className="meter__row">
                        <span>Run 2</span>
                        <div className="bar">
                          <i className="ok" style={{ "--w": "14%" }}></i>
                          <u style={{ left: "24.8%" }}></u>
                        </div>
                        <b>1.7 MB</b>
                      </div>
                    </div>
                    <div className="checks" style={{ marginTop: "12px" }}>
                      <div className="ck">
                        <span>Size</span>
                        <b>1.7 MB</b>
                        <Pass />
                      </div>
                      <div className="ck">
                        <span>Length</span>
                        <b>0:16</b>
                        <Pass />
                      </div>
                      <div className="ck">
                        <span>Picture</span>
                        <b>1920 × 1080</b>
                        <Pass />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="vis" data-vis="5">
                  <div className="card">
                    <div className="result">
                      <img
                        src="/media/mer-poster.jpg"
                        alt=""
                        width="1280"
                        height="720"
                        loading="lazy"
                      />
                      <div>
                        <p className="result__name">detective-small.mp4</p>
                        <p className="result__meta">
                          1.7 MB, 0:16, 1920 × 1080
                        </p>
                        <p className="result__ok">Every check passed</p>
                      </div>
                    </div>
                    <div className="card__actions">
                      <span className="btn btn--sm btn--blue">Download</span>
                      <span className="card__hint">
                        Show the FFmpeg command
                      </span>
                    </div>
                    <pre className="cmd">
                      ffmpeg -i detective.mp4 -c:v libx264 -crf 26
                      detective-small.mp4
                    </pre>
                  </div>
                </div>
              </div>
              <ol className="ckd__steps">
                <li className="cstep is-on" data-step="1">
                  <h3>A guess looks like an answer.</h3>
                  <p>
                    Ask a chatbot and you get a command that looks right.
                    Nothing checks it against your video.
                  </p>
                </li>
                <li className="cstep" data-step="2">
                  <h3>First, a plan you can read.</h3>
                  <p>
                    Before anything runs, ffwd shows what it will make: under 3
                    MB, same length, same picture. You confirm it or change it.
                  </p>
                </li>
                <li className="cstep" data-step="3">
                  <h3>Then it measures.</h3>
                  <p>
                    Run 1 came out at 3.2 MB. That is over your limit, so it
                    does not count.
                  </p>
                </li>
                <li className="cstep" data-step="4">
                  <h3>And tries again.</h3>
                  <p>
                    It lowered the quality a little. Run 2 came out at 1.7 MB,
                    and every check passes.
                  </p>
                </li>
                <li className="cstep" data-step="5">
                  <h3>You get the file, and the proof.</h3>
                  <p>
                    Every result comes with its checks, and the exact command if
                    you want to see it.
                  </p>
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* 3. Privacy */}
        <section className="light priv" id="privacy" aria-labelledby="priv-h">
          <div className="wrap priv__grid">
            <div className="rv">
              <h2 id="priv-h">Stays on this computer</h2>
              <p className="lead-l">
                ffwd runs inside your browser tab. Your video is never uploaded.
              </p>
              <details className="how">
                <summary>How to check</summary>
                <p>
                  Open your browser's developer tools, watch the network tab
                  while a job runs, and look for your video. It is not there.
                  [Confirm on the built site before publishing.]
                </p>
              </details>
            </div>
            <div className="ledger rv">
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
          </div>
        </section>

        {/* 4. The letter */}
        <section
          className="light letter"
          id="research"
          aria-labelledby="letter-h"
        >
          <div className="wrap letter__grid">
            <div className="rv">
              <h2 id="letter-h">A small model, trained for one job</h2>
              <div className="letter__text">
                <p>
                  ffwd is a small language model that I trained to do one job:
                  turn a sentence about a video into FFmpeg commands.
                </p>
                <p>
                  It is small on purpose. At about 0.6 billion parameters it
                  downloads once and runs on your own laptop, so there is no
                  server to pay for and nothing to upload.
                </p>
                <p>
                  It can still be wrong. That is why every result is measured
                  against the plan you confirmed, and why a failed check is
                  shown to you instead of hidden.
                </p>
                <p>
                  I am still testing it. The final results are not in, and this
                  page will not quote a number until they are.
                </p>
                <p className="sign">
                  Joydeep Das <span>[role line]</span>
                </p>
              </div>
            </div>
            <div className="results rv">
              <h3>Results after the final test run</h3>
              <dl>
                <div>
                  <dt>Regex baseline</dt>
                  <dd>Not run yet</dd>
                </div>
                <div>
                  <dt>Base model</dt>
                  <dd>Not run yet</dd>
                </div>
                <div>
                  <dt>ffwd</dt>
                  <dd>Not run yet</dd>
                </div>
                <div>
                  <dt>Frontier model</dt>
                  <dd>Not run yet</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* 5. Closing bookend */}
        <section className="end" aria-labelledby="end-h">
          <div className="end__inner rv">
            <h2 id="end-h">
              Describe it.<span>Get it checked.</span>
            </h2>
            <div className="ctas">
              <a className="btn btn--accent" href="/app" data-choose="">
                Choose a video
              </a>
              <button className="btn btn--ghost" type="button" data-sample="">
                Try the sample clip
              </button>
            </div>
            <p className="end__small">
              Free and open source. Runs in Chrome or Edge on a laptop.
            </p>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="foot__links">
          <nav aria-label="Footer">
            <a href="/chores">Chores</a>
            <a href="#checked">How it checks</a>
            <a href="/privacy">Privacy</a>
            <a href="/requirements">System requirements</a>
            <a href="#research">Research</a>
            <a href="https://github.com/JustJoyful/ffwd" rel="noopener">
              GitHub
            </a>
            <a href="https://github.com/JustJoyful/ffwd-web" rel="noopener">
              Site source
            </a>
          </nav>
          <p>Licensed under GPL-3.0. [contact address]</p>
        </div>
        <p className="foot__credit">
          Sample footage:{" "}
          <a href="https://opencontent.netflix.com/">Meridian</a> by Netflix,
          licensed under{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
          Cut, cropped, resized and colour-adjusted.
        </p>
        <p className="foot__word" aria-hidden="true">
          ffwd
        </p>
      </footer>
    </>
  );
}
