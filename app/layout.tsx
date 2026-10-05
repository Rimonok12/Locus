import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Locus", template: "%s · Locus" },
  description:
    "Locus is a keyboard-first issue tracker for software teams: issues, boards, cycles, projects, real-time collaboration and a command menu.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Locus — Issue tracking at the speed of thought",
    description: "Keyboard-first, real-time issue tracking for software teams.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#141518" },
  ],
};

/* Apply the saved theme before first paint (no flash). */
const themeScript = `(function(){try{var t=JSON.parse(localStorage.getItem('locus:theme')||'"system"');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;if(d)e.classList.add('dark');e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
