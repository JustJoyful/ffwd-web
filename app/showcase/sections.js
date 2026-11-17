// Page sections, ported from the second IIFE of mockup-v5/app.js: scroll reveals and the "Checked, not guessed"
// stepper. mountSections(root) returns a cleanup function that disconnects both observers and removes the
// inline visuals it cloned, so StrictMode (mount, unmount, mount) leaves one set.
export function mountSections(root) {
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const rv = $$(".rv");
  if (!("IntersectionObserver" in window)) {
    rv.forEach((e) => e.classList.add("is-in"));
    return () => {};
  }
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }),
    { rootMargin: "0px 0px -12% 0px" },
  );
  rv.forEach((e) => io.observe(e));

  const steps = $$(".cstep");
  if (matchMedia("(max-width: 59.9375em)").matches) {
    const ckd = $(".ckd");
    ckd.classList.add("ckd--inline");
    steps.forEach((st) => {
      const v = $(`[data-vis="${st.dataset.step}"]`).cloneNode(true);
      v.classList.add("vis--inline");
      v.removeAttribute("data-vis");
      st.append(v);
    });
    return () => {
      io.disconnect();
      $$(".vis--inline").forEach((v) => v.remove());
      ckd.classList.remove("ckd--inline");
    };
  }
  const vis = $$("[data-vis]");
  const showStep = (n) => {
    steps.forEach((s) => s.classList.toggle("is-on", s.dataset.step === n));
    vis.forEach((v) => v.classList.toggle("is-on", v.dataset.vis === n));
  };
  const so = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) showStep(e.target.dataset.step);
      }),
    {
      rootMargin: matchMedia("(max-width: 59.9375em)").matches
        ? "-70% 0px -20% 0px"
        : "-45% 0px -45% 0px",
    },
  );
  steps.forEach((s) => so.observe(s));
  return () => {
    io.disconnect();
    so.disconnect();
  };
}
