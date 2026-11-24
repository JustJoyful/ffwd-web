import { chores } from "./app/content/chores.js";

// Static site: no runtime server, every page is rendered to HTML at build time. /404 is the page a static host
// serves for an address that does not exist (scripts/postbuild.mjs copies it to 404.html).
// /app is prerendered too (review B1): without its own HTML file a static host answers the full page load of /app with the
// 404 page. It prerenders the route's HydrateFallback ("Starting ffwd"); the browser then runs the real tool.
export default {
  ssr: false,
  prerender: [
    "/",
    "/privacy",
    "/requirements",
    "/app",
    "/chores",
    ...chores.map((c) => `/chores/${c.slug}`),
    "/404",
  ],
};
