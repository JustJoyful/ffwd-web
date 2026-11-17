// Static site: no runtime server, "/" is rendered to HTML at build time.
export default {
  ssr: false,
  prerender: ["/", "/privacy", "/requirements"],
};
