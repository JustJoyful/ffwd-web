import { Link } from "react-router";

// The nav and footer of every page except the home page (which keeps its own copy of the same markup, ported 1:1 from
// the approved mockup). Same classes, so the pages share the home page's look. "Open ffwd" is a plain <a>: the tool
// is a different document and must load fresh, with the cross-origin isolation headers.

const Logo = () => (
  <svg viewBox="0 0 28 20" aria-hidden="true">
    <path d="M0 0 14 7v6L0 20Z" fill="var(--text)" />
    <path d="M17 5l11 5-11 5Z" fill="var(--accent)" />
  </svg>
);

export function SiteNav() {
  return (
    <header className="nav">
      <Link className="brand" to="/" aria-label="ffwd, home">
        <Logo />
        <span>ffwd</span>
      </Link>
      <nav aria-label="Main">
        <Link to="/chores">Chores</Link>
        <Link to="/#checked">How it checks</Link>
        <Link to="/privacy">Privacy</Link>
        <a href="#">GitHub</a>
      </nav>
      <div className="nav__end">
        <a className="btn btn--sm btn--ghost" href="/app">
          Open ffwd
        </a>
      </div>
    </header>
  );
}

/** @param {{ credit?: boolean }} props credit: the page shows frames of the sample clip, so the footer names its source */
export function SiteFooter({ credit = false }) {
  return (
    <footer className="foot">
      <div className="foot__links">
        <nav aria-label="Footer">
          <Link to="/chores">Chores</Link>
          <Link to="/#checked">How it checks</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/requirements">System requirements</Link>
          <Link to="/#research">Research</Link>
          <a href="#">GitHub</a>
        </nav>
        <p>Licensed under GPL-3.0. [contact address]</p>
      </div>
      {credit && (
        <p className="foot__credit">
          Sample footage:{" "}
          <a href="https://opencontent.netflix.com/">Meridian</a> by Netflix,
          licensed under{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
          Cut, cropped, resized and colour-adjusted.
        </p>
      )}
    </footer>
  );
}
