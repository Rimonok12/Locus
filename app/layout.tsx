import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Locus — Issue tracking at the speed of thought",
  description:
    "Locus is a keyboard-first, local-first project tracker: issues, boards, cycles, projects and a command palette — built with Next.js, TypeScript, Tailwind and Zustand.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Locus — Issue tracking at the speed of thought",
    description: "Keyboard-first, local-first project tracker built with Next.js + TypeScript.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
