"use client";
/* ─── Locus · popover placement fix for workview menus ───────────────────────
   The shared Popover measures itself in a layout effect that runs before its
   Portal has mounted the content, so a freshly opened popover stays hidden
   (and unpositioned) until the next window resize/scroll, and autoFocus inside
   it fires while it is invisible. Render <PopFix/> anywhere inside popover
   content: once the content exists it makes the popover measure, keeps it
   measured while the content resizes, and (focus) moves focus to the first
   field. Harmless when the Popover already placed itself.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

export default function PopFix({ focus = false }: { focus?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let raf = 0;
    let tries = 0;
    const nudge = () => window.dispatchEvent(new Event("resize"));
    const tick = () => {
      const root = ref.current?.closest<HTMLElement>("[role='dialog']");
      if (!root) {
        if (tries++ < 12) raf = requestAnimationFrame(tick);
        return;
      }
      if (root.style.visibility === "hidden" || getComputedStyle(root).visibility === "hidden") flushSync(nudge);
      if (typeof ResizeObserver !== "undefined") {
        let first = true;
        ro = new ResizeObserver(() => {
          if (first) { first = false; return; }
          nudge();
        });
        ro.observe(root);
      }
      if (!focus || root.contains(document.activeElement)) return;
      const field = root.querySelector<HTMLElement>("input:not([type='hidden']), textarea");
      field?.focus({ preventScroll: true });
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [focus]);

  return <span ref={ref} hidden aria-hidden />;
}
