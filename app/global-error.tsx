"use client";
/* ─── Locus · last-resort error UI ───────────────────────────────────────────
   Replaces the ROOT layout when it (or anything app/error.tsx can't catch)
   throws, so none of the layout's CSS, fonts or theme script can be assumed:
   it renders its own <html>/<body> with a few inline styles. It sits outside
   the app router, so retry is a full reload rather than reset().
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";

const LIGHT = "--bg:#f9f7f7;--surface:#fff;--line:#c9d3e6;--ink:#112d4e;--dim:#51688c;--faint:#7489ab;--accent:#3f72af;--accent-hover:#36649c;--danger:#e5484d;--glow:rgba(63,114,175,.12)";
const DARK = "--bg:#0c1a2c;--surface:#112d4e;--line:#2e5583;--ink:#f9f7f7;--dim:#aabdd8;--faint:#7390b5;--accent:#6ea2dd;--accent-hover:#82b1e4;--danger:#f06a6e;--glow:rgba(110,162,221,.18)";

const CSS = `
:root{${LIGHT};color-scheme:light}
:root.dark{${DARK};color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not(.light){${DARK};color-scheme:dark}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:48px 16px;background:var(--bg) radial-gradient(56% 480px at 50% 0,var(--glow),transparent 72%) no-repeat;color:var(--ink);font:13px/1.5 "Inter Variable",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:380px;display:flex;flex-direction:column;align-items:center;text-align:center}
.badge{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--danger);box-shadow:0 0 0 4px color-mix(in srgb,var(--danger) 10%,transparent)}
h1{margin:20px 0 0;font-size:20px;font-weight:600;line-height:1.25;letter-spacing:-.012em}
p{margin:8px 0 0;max-width:340px;color:var(--dim);line-height:1.6}
.actions{margin-top:24px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;width:100%}
.btn{height:40px;padding:0 16px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;font-family:inherit;font-size:14px;font-weight:500;line-height:1;text-decoration:none;cursor:pointer;transition:background-color .15s}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.primary{border:0;background:var(--accent);color:#fff}
.primary:hover{background:var(--accent-hover)}
.secondary{border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.secondary:hover{border-color:var(--faint)}
.id{margin-top:24px;font-size:11px;color:var(--faint)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dim);user-select:all}
@media (max-width:480px){.btn{flex:1 1 100%}}
`;

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[locus] fatal error", error);
  }, [error]);

  // The root layout's theme script didn't run: honour the saved theme here (system → the media query).
  useEffect(() => {
    try {
      const t: unknown = JSON.parse(localStorage.getItem("locus:theme") || '"system"');
      if (t === "dark" || t === "light") document.documentElement.classList.add(t);
    } catch {
      /* storage unavailable: the media query decides */
    }
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>Something went wrong · Locus</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <main role="alert">
          <span className="badge" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </span>
          <h1>Something went wrong</h1>
          <p>Locus hit an unexpected error and couldn’t load. Reload the page to try again.</p>
          <div className="actions">
            <button type="button" className="btn primary" autoFocus onClick={() => window.location.reload()}>
              Reload
            </button>
            <a href="/" className="btn secondary">Go to Locus</a>
          </div>
          {error.digest && (
            <p className="id">
              Error ID <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
