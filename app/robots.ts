/* ─── Locus · /robots.txt ───
   Default-deny: only the landing page and the two public entry points are crawlable. Workspaces
   live at /:slug/… (unknowable here), and the auth, onboarding, invite and setup routes are
   per-person, so "Disallow: /" covers them all. Crawlers resolve conflicts by the longest
   matching rule, so the Allow lines win for exactly these paths; "/$" is the landing page alone.
   The landing page's own CSS/JS/icon stay fetchable so it can be rendered. */

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/login$", "/signup$", "/_next/static/", "/favicon.svg"],
      disallow: ["/"],
    },
  };
}
