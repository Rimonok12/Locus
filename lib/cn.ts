/* ─── Locus · className merge (later classes win, Tailwind-aware) ─── */

import { extendTailwindMerge } from "tailwind-merge";

const TOKENS = [
  "canvas", "sidebar", "surface", "raised", "line", "line-strong", "ink", "dim", "faint", "accent", "accent-hover",
  "accent-ink", "accent-soft", "wash", "danger", "success", "warning",
];

const merge = extendTailwindMerge({
  extend: {
    theme: { colors: TOKENS },
    classGroups: { "font-size": [{ text: ["xxs", "xs2", "sm2"] }] },
  },
});

export function cn(...parts: (string | false | null | undefined)[]): string {
  return merge(parts.filter(Boolean).join(" "));
}
