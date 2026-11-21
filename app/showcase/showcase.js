// The app-window demo, ported from the first IIFE of mockup-v5/app.js.
// mountShowcase(root) builds the tabs and thumbnails inside `root`, runs the demo, and returns a cleanup function
// that stops every timer, frame, listener and media-query listener and removes what it injected, so React
// StrictMode (mount, unmount, mount) and leaving the page leave nothing behind.
import { SITE_URL } from "../config.js";
import { CHORES, D } from "../content/showcase-chores.js";
import { fmt } from "../lib/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const CYCLE = 8500;

const el = (t, c, txt) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (txt != null) e.textContent = txt;
  return e;
};

const icon = (ok) => {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 18 18");
  s.setAttribute("class", "ico");
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", ok ? "passed" : "failed");
  s.innerHTML = ok
    ? '<circle cx="9" cy="9" r="8"/><path d="M5.5 9.3l2.3 2.3 4.7-5"/>'
    : '<circle cx="9" cy="9" r="8"/><path d="M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6"/>';
  return s;
};

// `assign` and `clipboard` are injected by tests; by default a click navigates with a full page load (the tool needs
// the cross-origin isolation headers of its own document) and the clipboard is the browser's.
export function mountShowcase(
  root,
  {
    search = location.search,
    assign = (url) => location.assign(url),
    clipboard = globalThis.navigator?.clipboard,
  } = {},
) {
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const ac = new AbortController();
  const { signal } = ac;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- static parts ---- */
  const track = $("[data-track]");
  for (let i = 0; i < 8; i++) {
    const s = el("span");
    const im = new Image();
    Object.assign(im, {
      src: `/media/mer-f${i}.jpg`,
      alt: "",
      width: 400,
      height: 225,
      decoding: "async",
    });
    s.append(im);
    track.append(s);
  }
  const tl = $("[data-tl]");
  const viewer = $("[data-viewer]");
  const tabsBox = $("[data-tabs]");
  CHORES.forEach((c, i) => {
    const b = el("button", "tab");
    b.type = "button";
    b.role = "tab";
    b.id = `tab-${c.id}`;
    b.setAttribute("aria-controls", "win");
    b.setAttribute("aria-selected", "false");
    b.tabIndex = i ? -1 : 0;
    b.append(document.createTextNode(c.tab), el("i", "tab__bar"));
    b.addEventListener(
      "click",
      () => {
        stopCycle();
        show(i);
      },
      { signal },
    );
    tabsBox.append(b);
  });
  tabsBox.addEventListener(
    "keydown",
    (e) => {
      if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
      stopCycle();
      const n =
        (cur + (e.key === "ArrowRight" ? 1 : CHORES.length - 1)) %
        CHORES.length;
      show(n);
      $$(".tab")[n].focus();
    },
    { signal },
  );

  /* ---- showing one chore ---- */
  let cur = -1;
  let timers = [];
  const frames = new Set();
  // Every requestAnimationFrame goes through here so cleanup can cancel the ones still pending.
  const frame = (fn) => {
    const id = requestAnimationFrame((t) => {
      frames.delete(id);
      fn(t);
    });
    frames.add(id);
  };
  const later = (fn, ms) => timers.push(setTimeout(fn, reduced ? 0 : ms));
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const stepState = (name, s) => {
    const st = $(`[data-step="${name}"]`);
    st.classList.toggle("is-done", s === "done");
    st.classList.toggle("is-active", s === "active");
  };

  function show(i) {
    clear();
    cur = i;
    const c = CHORES[i];
    $$(".tab").forEach((b, k) => {
      b.setAttribute("aria-selected", String(k === i));
      b.tabIndex = k === i ? 0 : -1;
    });
    const tb = $$(".tab")[i];
    tabsBox.scrollTo({
      left: tb.offsetLeft - (tabsBox.clientWidth - tb.offsetWidth) / 2,
      behavior: reduced ? "auto" : "smooth",
    });
    $("#win").setAttribute("aria-labelledby", `tab-${c.id}`);

    // file + probe
    $("[data-file-name]").textContent = c.file.name;
    $("[data-file-size]").textContent = c.file.size;
    const probe = $("[data-probe]");
    probe.textContent = "";
    c.file.probe.forEach(([k, v]) =>
      probe.append(el("dt", null, k), el("dd", null, v)),
    );
    stepState("video", "done");

    // reset the rest
    const typed = $("[data-typed]");
    typed.textContent = "";
    const ask = $("[data-ask]");
    ask.classList.add("is-focus");
    const plan = $("[data-plan]");
    plan.textContent = "";
    const runs = $("[data-runs]");
    runs.textContent = "";
    const save = $("[data-save]");
    save.classList.remove("is-on");
    $("[data-cmd]").hidden = true;
    $("[data-cmdlink]").setAttribute("aria-expanded", "false");
    ["ask", "plan", "check", "save"].forEach((s) => stepState(s, ""));
    stepState("ask", "active");

    // stage
    tl.toggleAttribute("data-range", !!c.range);
    tl.toggleAttribute("data-crop", !!c.crop);
    viewer.toggleAttribute("data-crop", !!c.crop);
    const lo = c.range ? c.range[0] : 0,
      hi = c.range ? c.range[1] : D;
    tl.style.setProperty("--a", `${(lo / D) * 100}%`);
    tl.style.setProperty("--b", `${(hi / D) * 100}%`);
    $("[data-ra]").textContent = fmt(lo);
    $("[data-rb]").textContent = fmt(hi);
    $$("span", track).forEach((s, k) =>
      s.classList.toggle("is-out", (k + 0.5) * (D / 8) < lo),
    );
    $("[data-tl-alt]").textContent = c.range
      ? `Keeps ${fmt(lo)} to ${fmt(hi)} of the clip.`
      : c.crop
        ? "Crops a tall 9:16 window from the middle of each frame."
        : "The whole clip is kept.";
    $$(".tick", tl).forEach((t) => t.remove());
    if (c.badge) {
      viewer.setAttribute("data-badge", "");
      const b = $("[data-badge-text]");
      b.textContent = "";
      b.append(
        el("span", null, c.badge[0]),
        el("span", null, "→"),
        el("b", null, c.badge[1]),
      );
    } else viewer.removeAttribute("data-badge");
    const extra = $("[data-extra]");
    extra.textContent = "";

    // 1. type the sentence
    const txt = c.ask;
    let n = 0;
    const type = () => {
      n += 1;
      typed.textContent = txt.slice(0, n);
      if (n < txt.length) later(type, 26);
      else afterType();
    };
    if (reduced) {
      typed.textContent = txt;
      afterType();
    } else later(type, 250);

    function afterType() {
      ask.classList.remove("is-focus");
      stepState("ask", "done");
      stepState("plan", "active");
      // 2. the plan
      c.plan.forEach(([k, v, ch], j) =>
        later(
          () => {
            const chip = el("span", `chip reveal${ch ? " is-change" : ""}`);
            chip.append(document.createTextNode(k), el("b", null, v));
            plan.append(chip);
            frame(() => chip.classList.add("is-on"));
          },
          120 + j * 90,
        ),
      );
      const tPlan = 120 + c.plan.length * 90 + 260;
      later(() => {
        stepState("plan", "done");
        stepState("check", "active");
        stageExtras(c);
      }, tPlan);
      // 3. checks, run by run
      let t = tPlan + 300;
      c.runs.forEach((r) => {
        later(() => {
          const block = el("div", "run");
          if (r.t) block.append(el("p", "run__t", r.t));
          const list = el("div", "checks");
          block.append(list);
          runs.append(block);
          r.checks.forEach(([k, v, ok, why], j) =>
            later(() => {
              const row = el("div", `ck reveal${ok ? "" : " is-fail"}`);
              const b = el("b", null, v);
              if (why) b.append(el("em", null, why));
              row.append(el("span", null, k), b, icon(!!ok));
              list.append(row);
              frame(() => row.classList.add("is-on"));
            }, j * 220),
          );
        }, t);
        t += r.checks.length * 220 + 650;
      });
      // 4. save
      later(() => {
        stepState("check", "done");
        stepState("save", "done");
        $("[data-out]").textContent = c.out.size
          ? `${c.out.name}, ${c.out.size}`
          : c.out.name;
        $("[data-dl]").textContent = c.every ? "Download pictures" : "Download";
        $("[data-cmd]").textContent = c.cmd;
        save.classList.add("is-on");
      }, t);
    }
  }

  function stageExtras(c) {
    const extra = $("[data-extra]");
    if (c.every) {
      for (let s = 0; s < D - 1 / 30; s += c.every) {
        const k = el("span", "tick");
        k.style.left = `${(s / D) * 100}%`;
        tl.append(k);
        later(() => k.classList.add("is-on"), (s / c.every) * 70);
      }
      const shots = el("div", "shots");
      for (let i = 0; i < 8; i++) {
        const f = el("figure");
        const im = new Image();
        Object.assign(im, {
          src: `/media/mer-f${i}.jpg`,
          alt: `Picture taken at ${fmt(i * 2)}`,
          width: 400,
          height: 225,
        });
        f.append(im, el("figcaption", null, fmt(i * 2)));
        shots.append(f);
        later(() => f.classList.add("is-on"), 300 + i * 80);
      }
      extra.append(shots);
    }
    if (c.meter) {
      const m = c.meter;
      const max = m.input;
      const box = el("div", "meter");
      const head = el("div", "meter__head");
      head.append(
        el("span", null, "File size"),
        el("span", null, `Limit ${m.limit} MB`),
      );
      box.append(head);
      const row = (label, val, cls) => {
        const r = el("div", "meter__row");
        const bar = el("div", "bar");
        const fill = el("i", cls);
        const lim = el("u");
        lim.style.left = `${(m.limit / max) * 100}%`;
        bar.append(fill, lim);
        r.append(el("span", null, label), bar, el("b", null, `${val} MB`));
        box.append(r);
        later(() => {
          fill.style.width = `${(val / max) * 100}%`;
        }, 60);
        return r;
      };
      row("Your video", m.input, "in");
      later(() => row("Run 1", m.runs[0], "over"), 900);
      later(() => row("Run 2", m.runs[1], "ok"), 2300);
      extra.append(box);
    }
  }

  /* ---- auto-cycle until the visitor takes over ---- */
  let cycleTimer = null;
  const win = $("#win");
  function startCycle() {
    if (reduced) return;
    document.documentElement.style.setProperty("--cycle", `${CYCLE}ms`);
    tabsBox.classList.add("cycling");
    cycleTimer = setInterval(() => show((cur + 1) % CHORES.length), CYCLE);
  }
  function stopCycle() {
    clearInterval(cycleTimer);
    cycleTimer = null;
    tabsBox.classList.remove("cycling");
  }
  win.addEventListener("pointerenter", stopCycle, { signal });
  win.addEventListener("focusin", stopCycle, { signal });

  /* ---- playhead + timecode follow the real video ---- */
  const vid = $("#vid");
  const ph = $("[data-ph]");
  const tc = $("[data-tc]");
  const tick = () => {
    const t = vid.currentTime || 0;
    ph.style.transform = `translateX(${(t / D) * tl.clientWidth}px)`;
    tc.textContent = fmt(t);
    frame(tick);
  };
  frame(tick);
  if (reduced) {
    vid.pause();
    vid.removeAttribute("autoplay");
  }

  /* ---- command reveal + buttons ---- */
  $("[data-cmdlink]").addEventListener(
    "click",
    (e) => {
      const pre = $("[data-cmd]");
      pre.hidden = !pre.hidden;
      e.currentTarget.setAttribute("aria-expanded", String(!pre.hidden));
    },
    { signal },
  );
  const status = $("[data-status]");
  const narrow = matchMedia("(max-width: 767px)");
  const cta = $(".ctas [data-choose]");
  const ctaText = cta.textContent;
  const label = () => {
    cta.textContent = narrow.matches ? "Send to my laptop" : "Choose a video";
  };
  label();
  narrow.addEventListener("change", label, { signal });
  document.addEventListener(
    "click",
    (e) => {
      if (e.target.closest("[data-choose]")) {
        e.preventDefault();
        if (!narrow.matches) return assign("/app");
        // A phone can't run the tool: copy the link so it can be opened on a laptop. If the clipboard is missing or
        // refuses, show the link as text so it can still be copied by hand.
        const url = `${SITE_URL}/app`;
        Promise.resolve()
          .then(() => clipboard.writeText(url))
          .then(
            () => "Link copied. Open it on your laptop.",
            () => `Open this link on your laptop: ${url}`,
          )
          .then((text) => {
            if (signal.aborted) return;
            status.textContent = text;
            // the button that was pressed may be far from the status line (the nav, the closing section)
            status.scrollIntoView({
              behavior: reduced ? "auto" : "smooth",
              block: "center",
            });
          });
      }
      if (e.target.closest("[data-sample]")) {
        stopCycle();
        show(0);
        win.scrollIntoView({
          behavior: reduced ? "auto" : "smooth",
          block: "center",
        });
      }
    },
    { signal },
  );

  const wanted = CHORES.findIndex(
    (c) => c.id === new URLSearchParams(search).get("tab"),
  );
  show(wanted >= 0 ? wanted : 0);
  if (wanted < 0) startCycle();

  return () => {
    ac.abort();
    clear();
    stopCycle();
    frames.forEach((id) => cancelAnimationFrame(id));
    frames.clear();
    document.documentElement.style.removeProperty("--cycle");
    tabsBox.textContent = "";
    track.textContent = "";
    $("[data-extra]").textContent = "";
    $$(".tick", tl).forEach((t) => t.remove());
    cta.textContent = ctaText;
  };
}
