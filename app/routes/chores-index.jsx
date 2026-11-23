import "../styles/theme.css";
import "../styles/pages.css";
import { SiteFooter, SiteNav } from "../components/site/Shell.jsx";
import { chores } from "../content/chores.js";
import { SITE_URL } from "../config.js";

// COPY FOR OWNER REVIEW.
export function meta() {
  return [
    { title: "Video chores ffwd can do, in plain words" },
    {
      name: "description",
      content:
        "Cut the start off a video, make it vertical, shrink it to email, fix an iPhone video or save a picture every few seconds. Each page opens ffwd ready to go.",
    },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/chores` },
  ];
}

export default function ChoresIndex() {
  return (
    <>
      <SiteNav />
      <main id="main" className="page">
        <div className="wrap">
          <div className="page__top">
            <h1>Video chores, in plain words</h1>
            <p className="lead-l">
              Pick the one you need. Each page shows what ffwd does and opens
              the tool with the request filled in.
            </p>
          </div>
          <div className="cards">
            {chores.map((c) => (
              <a key={c.slug} href={`/chores/${c.slug}`}>
                <h2>{c.title}</h2>
                <p>{c.question}</p>
              </a>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
