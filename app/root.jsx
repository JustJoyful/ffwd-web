import { Links, Outlet, Scripts } from "react-router";
import "./styles/fonts.css";

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

export function Layout({ children }) {
  // suppressHydrationWarning on <html>: the inline head script adds the "js" class (and ?theme / ?font
  // attributes) before React hydrates, so the attributes differ from the server markup on purpose.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ffwd: describe the chore, get a checked video</title>
        <meta
          name="description"
          content="A free tool that cuts, converts and fixes video from one sentence. It runs on your own computer, never uploads your video, and checks every result."
        />
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

export default function Root() {
  return <Outlet />;
}
