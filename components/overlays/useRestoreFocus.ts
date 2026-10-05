"use client";
/* ─── Locus · give focus back when a dialog of this module closes ────────────
   The foundation Modal doesn't restore focus. Dialogs here capture the element
   that had focus when they first rendered (before their own autofocus runs) and,
   once they unmount, hand focus back to it — unless something else took focus,
   another modal is now open, or the caller says the close was an action
   (navigation, a follow-up dialog) that should keep focus where it lands.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { modalOpen } from "@/components/primitives/overlay";

export function useRestoreFocus(skip?: () => boolean) {
  const [prev] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => () => {
    if (!prev || prev === document.body) return;
    // after the modal stack and any follow-up dialog have settled
    requestAnimationFrame(() => {
      if (skip?.() || modalOpen() || !prev.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      prev.focus({ preventScroll: true });
    });
    // `prev` is fixed for the dialog's lifetime; `skip` is read at close time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
