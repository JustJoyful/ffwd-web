import "../styles/theme.css";
import "../styles/pages.css";
import ChoreDiagram from "../components/site/ChoreDiagram.jsx";
import { SiteFooter, SiteNav } from "../components/site/Shell.jsx";
import { SITE_URL } from "../config.js";
import { askLink, choreBySlug, choreDescription } from "../content/chores.js";
import NotFound from "./not-found.jsx";

// One page per chore (DESIGN "Chore page"): title in the chore's words, its diagram, the tool link pre-filled with the
// sentence, three steps, a plain answer on quality, other ways to ask, related chores. COPY FOR OWNER REVIEW.
export function meta({ params }) {
  const c = choreBySlug(params.slug);
  if (!c)
    return [
      { title: "Page not found: ffwd" },
      { name: "robots", content: "noindex" },
    ];
  return [
    { title: `${c.title}: ffwd` },
    { name: "description", content: choreDescription(c) },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/chores/${c.slug}` },
  ];
}

export default function Chore({ params }) {
  const c = choreBySlug(params.slug);
  if (!c) return <NotFound />; // a slug that is not listed (reached by client navigation) gets the 404 page
  const related = c.related.map(choreBySlug);
  return (
    <>
      <SiteNav />
      <main id="main" className="page">
        <div className="wrap">
          <div className="page__top">
            <h1>{c.title}</h1>
            <p className="lead-l">{c.question}</p>
          </div>

          <div className="chore__grid">
            <ChoreDiagram id={c.diagram} />
            <div>
              <h2 style={{ marginTop: 0 }}>Try it on your video</h2>
              <p className="prose" style={{ marginTop: "1rem" }}>
                Open ffwd with this request filled in. You still press Enter,
                and nothing runs until you confirm the plan.
              </p>
              <div className="chore__ask">
                <q>{c.sentence}</q>
                <a className="btn btn--accent" href={askLink(c.sentence)}>
                  Open ffwd with this
                </a>
              </div>
            </div>
          </div>

          <section aria-labelledby="steps-h">
            <h2 id="steps-h">Three steps</h2>
            <ol className="steps-n">
              {c.steps.map((s) => (
                <li key={s}>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="quality-h">
            <h2 id="quality-h">Will it look worse?</h2>
            <p className="prose">{c.quality}</p>
          </section>

          <section id="other-ways" aria-labelledby="ways-h">
            <h2 id="ways-h">Other ways to ask</h2>
            <div className="linklist">
              {c.otherWays.map((w) => (
                <a key={w} href={askLink(w)}>
                  {w}
                </a>
              ))}
            </div>
          </section>

          <section id="related" aria-labelledby="related-h">
            <h2 id="related-h">Related chores</h2>
            <div className="linklist">
              {related.map((r) => (
                <a key={r.slug} href={`/chores/${r.slug}`}>
                  {r.title}
                </a>
              ))}
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
