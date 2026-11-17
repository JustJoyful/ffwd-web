import { chores } from "./app/content/chores.js";

// Static site: no runtime server, every page is rendered to HTML at build time. /404 is the page a static host
// serves for an address that does not exist (scripts/postbuild.mjs copies it to 404.html).
export default {
  ssr: false,
  prerender: [
    "/",
    "/privacy",
    "/requirements",
    "/chores",
    ...chores.map((c) => `/chores/${c.slug}`),
    "/404",
  ],
};
