import { useEffect } from "react";
import { Links, Meta, Outlet, Scripts, useLocation } from "react-router";
import "./styles/fonts.css";
import { analyticsSettings } from "./config.js";

// Same inline script as mockup-v5: runs before paint so the "js" class and ?theme / ?font previews never flash.
const headScript = `
  (function () {
    var root = document.documentElement, q = new URLSearchParams(location.search);
    root.classList.add('js');
    // light table is dormant for now; ?theme=light still previews it
    if (q.get('theme') === 'light') root.dataset.theme = 'light';
    if (q.get('font') === 'bricolage') root.dataset.font = 'bricolage';
  })();
`;

// The default title and description (the home page and the tool). A route with its own meta() replaces them.
export function meta() {
  return [
    { title: "ffwd: describe the chore, get a checked video" },
    {
      name: "description",
      content:
        "A free tool that cuts, converts and fixes video from one sentence. It runs on your own computer, never uploads your video, and checks every result.",
    },
  ];
}

export function Layout({ children }) {
  // suppressHydrationWarning on <html>: the inline head script adds the "js" class (and ?theme / ?font
  // attributes) before React hydrates, so the attributes differ from the server markup on purpose.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <meta name="color-scheme" content="dark" />
        <script dangerouslySetInnerHTML={{ __html: headScript }} />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

let visited = false; // module state: StrictMode runs effects twice in dev, a page load is one visit
export default function Root() {
  const { pathname } = useLocation();
  // One site_visit per page load (the path only matters on the first render). Nothing is sent without a PostHog key.
  // The analytics code (the wrapper, the bridge and the bucket lists, about 4 kB gzip) is imported here, after the page
  // is interactive, so it is not in the JavaScript every page loads up front (the 120 kB budget). With no key nothing
  // would be sent, so it is not even fetched.
  useEffect(() => {
    if (visited) return;
    visited = true;
    if (!analyticsSettings().key) return;
    Promise.all([
      import("./lib/analytics.js"),
      import("./tool/analytics-bridge.js"),
    ])
      .then(([a, b]) => {
        a.initAnalytics();
        b.siteVisit({ landing: b.landingFromPath(pathname) });
      })
      .catch(() => {}); // analytics must never break the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Outlet />;
}
