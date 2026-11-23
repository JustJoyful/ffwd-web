import "../styles/theme.css";
import "../styles/pages.css";
import { SiteFooter, SiteNav } from "../components/site/Shell.jsx";

// COPY FOR OWNER REVIEW. Shown for any address that is not a page: it says so and gives a way home.
export function meta() {
  return [
    { title: "Page not found: ffwd" },
    { name: "robots", content: "noindex" },
  ];
}

export default function NotFound() {
  return (
    <>
      <SiteNav />
      <main id="main" className="page">
        <div className="wrap page__top">
          <h1>There is no page here</h1>
          <div className="prose" style={{ marginTop: "1.5rem" }}>
            <p>The address may have a typo, or the page may have moved.</p>
            <p>
              <a href="/">Go to the home page</a>, or{" "}
              <a href="/chores">see the chores ffwd can do</a>.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
