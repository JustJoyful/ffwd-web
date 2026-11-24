// Single config module for the site (RULES §6.2). Marketing pages and the tool read their constants from here.

// The longest request a link may pre-fill (/app?ask=). Longer text is cut; it is never sent anywhere.
export const ASK_MAX_CHARS = 300;

// The public address of the site. The domain is not confirmed (D-046), so this is a reserved placeholder that
// `pnpm check:release` refuses to publish. Set VITE_SITE_URL at build time, or edit this line once it is decided.
export const SITE_URL =
  import.meta.env?.VITE_SITE_URL ?? "https://ffwd.example";

// Analytics (ARCHITECTURE §9, WEB_ARCHITECTURE §10). OPEN OWNER QUESTIONS, defaults below:
// - ANALYTICS_PERSISTENCE is "localStorage" (owner decision 2026-11-25): PostHog's random anonymous id is kept in this
//   browser's localStorage so a returning visitor is counted once. Never a cookie: posthog-js writes cookies only for
//   persistence "cookie" or "localStorage+cookie" (the default), so this value is the cookie switch; the e2e spec checks
//   document.cookie stays empty. Analytics stays off until VITE_POSTHOG_KEY is set at build time.
// - RESPECT_DNT_GPC: when the browser sends Do Not Track or Global Privacy Control, PostHog is never loaded (allowed()
//   in lib/analytics.js), and it is also passed to posthog-js as respect_dnt, which honours both signals itself.
export const ANALYTICS_PERSISTENCE = "localStorage";
export const RESPECT_DNT_GPC = true;
// PostHog loads after the first pointer, key or scroll event, or after this many ms of idle, whichever comes first.
export const ANALYTICS_IDLE_MS = 3000;
// A string longer than this is never sent: free text does not fit in a category.
export const ANALYTICS_MAX_STRING = 40;
// Events asked for before PostHog has loaded wait in a queue this long; beyond it the oldest are dropped.
export const ANALYTICS_QUEUE_MAX = 50;

/**
 * The PostHog project key and host. With no key nothing is loaded and nothing is sent (dev, tests, e2e). A scripted
 * build (VITE_SCRIPTED_POLICY=1, the e2e server) may take them from `globalThis.__ffwdAnalytics` so a spec can give
 * one page a fake key; the branch is dead code in a normal build.
 * @returns {{ key: string, host: string, scripted: boolean }}
 */
export function analyticsSettings() {
  const scripted =
    import.meta.env?.VITE_SCRIPTED_POLICY === "1"
      ? globalThis.__ffwdAnalytics
      : null;
  return {
    scripted: Boolean(scripted),
    key: scripted?.key ?? import.meta.env?.VITE_POSTHOG_KEY ?? "",
    host:
      scripted?.host ??
      import.meta.env?.VITE_POSTHOG_HOST ??
      "https://us.i.posthog.com",
  };
}
