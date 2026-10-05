"use client";
/* ─── Locus · highlight query matches inside a string ─── */

import { useMemo } from "react";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marks the whole query where it appears; otherwise each word of it (2+ chars). */
export function splitMatches(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q || !text) return [{ text, hit: false }];
  const lowerText = text.toLowerCase();
  const terms = lowerText.includes(q.toLowerCase()) ? [q] : q.split(/\s+/).filter((t) => t.length > 1 && lowerText.includes(t.toLowerCase()));
  if (!terms.length) return [{ text, hit: false }];
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  const lowered = new Set(terms.map((t) => t.toLowerCase()));
  return text.split(re).filter(Boolean).map((part) => ({ text: part, hit: lowered.has(part.toLowerCase()) }));
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => splitMatches(text, query), [text, query]);
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-accent-soft px-px text-ink">{p.text}</mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
