"use client";
/* ─── Locus · overlays: Popover (anchored), Dropdown (trigger + popover), Modal ─── */

import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/cn";

/** Renders into document.body. Mounts synchronously on the client so children can be measured immediately. */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(() => typeof document !== "undefined");
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

/* ─── overlay registry ───────────────────────────────────────────────────────
   • openOverlays counts every open Popover/Modal so global shortcuts can stand down.
   • popoverClosers lets a Modal that opens on top dismiss menus left open underneath.
   • modalStack makes Escape close only the top-most modal.                       */
let openOverlays = 0;
const popoverClosers = new Set<() => void>();
const modalStack: string[] = [];
let popoverSeq = 0;
const popoverStack: number[] = [];

export const anyOverlayOpen = () => openOverlays > 0 || useUI.getState().mobileNavOpen;
export function closeAllPopovers() {
  for (const close of Array.from(popoverClosers)) close();
}

function useOverlayCount(active: boolean) {
  useEffect(() => {
    if (!active) return;
    openOverlays++;
    return () => { openOverlays--; };
  }, [active]);
}

type Side = "bottom" | "top" | "right" | "left";
type Align = "start" | "end" | "center";

const FOCUSABLE = "[autofocus], input:not([type=hidden]):not([disabled]), textarea:not([disabled])";
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex], [contenteditable]:not([contenteditable="false"])';
const tabbables = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);

/** Fixed-position popover anchored to an element (or a point). Closes on outside click / Escape. */
export function Popover({
  open, onClose, anchor, side = "bottom", align = "start", offset = 4, width, children, className = "", returnFocus = true,
}: {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | { x: number; y: number } | null;
  side?: Side;
  align?: Align;
  offset?: number;
  width?: number | "anchor";
  children: ReactNode;
  className?: string;
  /** move focus back to the anchor element when the popover closes (menu-button behaviour) */
  returnFocus?: boolean;
}) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<CSSProperties>({ top: 0, left: 0, opacity: 0, pointerEvents: "none" });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useOverlayCount(open);

  const place = useCallback(() => {
    if (!anchor || !node) return;
    const r = anchor instanceof HTMLElement
      ? anchor.getBoundingClientRect()
      : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
    const pw = node.offsetWidth;
    const ph = node.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = 0;
    let left = 0;
    if (side === "bottom" || side === "top") {
      const below = r.bottom + offset;
      const above = r.top - offset - ph;
      top = side === "bottom" ? (below + ph > vh - 8 && above > 8 ? above : below) : (above < 8 ? below : above);
      left = align === "start" ? r.left : align === "end" ? r.right - pw : r.left + r.width / 2 - pw / 2;
    } else {
      const right = r.right + offset;
      const leftSide = r.left - offset - pw;
      left = side === "right" ? (right + pw > vw - 8 ? leftSide : right) : (leftSide < 8 ? right : leftSide);
      top = align === "start" ? r.top : align === "end" ? r.bottom - ph : r.top + r.height / 2 - ph / 2;
    }
    left = Math.max(8, Math.min(left, vw - pw - 8));
    top = Math.max(8, Math.min(top, vh - ph - 8));
    setPos({ top, left, ...(width === "anchor" ? { width: r.width } : {}) });
  }, [anchor, node, side, align, offset, width]);

  // place as soon as the content node exists, and keep it placed while it resizes / the page scrolls
  useLayoutEffect(() => {
    if (!open || !node) return;
    place();
    const ro = new ResizeObserver(place);
    ro.observe(node);
    // the popover's own scrolling (tall menus) never moves its anchor
    const onScroll = (e: Event) => { if (!node.contains(e.target as Node)) place(); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, node, place]);

  // reset to "unplaced" while closed so the next open never flashes at a stale position
  useLayoutEffect(() => {
    if (!open) setPos({ top: 0, left: 0, opacity: 0, pointerEvents: "none" });
  }, [open]);

  // focus the first input (cmdk search etc.) once visible; restore focus to the trigger on close
  useEffect(() => {
    if (!open || !node) return;
    const prev = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      const target = node.querySelector<HTMLElement>(FOCUSABLE);
      if (target && !node.contains(document.activeElement)) target.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(id);
      if (!returnFocus) return;
      const back = anchor instanceof HTMLElement ? anchor : prev;
      // only steal focus back if it was inside the popover (or nowhere)
      const active = document.activeElement;
      if (back && back.isConnected && (!active || active === document.body || node.contains(active))) {
        back.focus({ preventScroll: true });
      }
    };
  }, [open, node, anchor, returnFocus]);

  useEffect(() => {
    if (!open) return;
    const seq = ++popoverSeq;
    popoverStack.push(seq);
    if (node) node.setAttribute("data-seq", String(seq));
    const close = () => closeRef.current();
    popoverClosers.add(close);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (node?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      // a click inside a popover opened from this one (nested menu) is not "outside"
      const owner = t.closest?.("[data-locus-popover]");
      if (owner && Number(owner.getAttribute("data-seq") ?? 0) > seq) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || popoverStack[popoverStack.length - 1] !== seq) return;
      e.stopPropagation();
      e.preventDefault();
      close();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      popoverClosers.delete(close);
      const i = popoverStack.lastIndexOf(seq);
      if (i >= 0) popoverStack.splice(i, 1);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, anchor, node]);

  if (!open) return null;
  return (
    <Portal>
      <div
        ref={setNode}
        role="dialog"
        data-locus-popover=""
        // never taller than the viewport: tall menus (date picker, long lists) scroll instead of clipping;
        // overflow-x stays hidden so content wider than a fixed width is clipped, not scrolled
        className={cn("anim-pop fixed z-[90] max-h-[calc(100dvh-16px)] overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg bg-surface shadow-pop", className)}
        style={{ ...pos, ...(typeof width === "number" ? { width } : {}) }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </Portal>
  );
}

/** Uncontrolled trigger + popover. `children` receives a close() callback. */
export function Dropdown({
  trigger, children, side, align, width, className, onOpenChange, disabled,
}: {
  trigger: (props: { ref: (el: HTMLElement | null) => void; onClick: (e: React.MouseEvent) => void; "aria-expanded": boolean; open: boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  side?: Side;
  align?: Align;
  width?: number | "anchor";
  className?: string;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const change = useCallback((v: boolean) => { setOpen(v); onOpenChange?.(v); }, [onOpenChange]);
  const close = useCallback(() => change(false), [change]);
  return (
    <>
      {trigger({
        ref: setAnchor,
        onClick: (e) => { e.stopPropagation(); e.preventDefault(); if (!disabled) change(!open); },
        "aria-expanded": open,
        open,
      })}
      <Popover open={open} onClose={close} anchor={anchor} side={side} align={align} width={width} className={className}>
        {children(close)}
      </Popover>
    </>
  );
}

/**
 * Centered modal dialog with backdrop. Escape closes only the top-most modal; Tab / Shift+Tab stay
 * inside it, and focus moves into it when it opens (so keys never act on the page behind).
 */
export function Modal({
  open, onClose, children, width = 560, className = "", position = "center", label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
  position?: "center" | "top";
  label?: string;
}) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayCount(open);

  useEffect(() => {
    if (!open) return;
    closeAllPopovers(); // menus opened underneath must not float above this modal
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      // Tiptap list indent / mention pick call preventDefault first and win
      if (e.key === "Tab" && !e.defaultPrevented && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (modalStack[modalStack.length - 1] !== id) return; // only the top-most modal traps
        const panel = panelRef.current;
        if (!panel) return;
        const active = document.activeElement as HTMLElement | null;
        if (active?.closest("[data-locus-popover]")) return; // popovers opened from the modal live outside the panel
        const list = tabbables(panel);
        if (!list.length) { e.preventDefault(); panel.focus({ preventScroll: true }); return; }
        const first = list[0];
        const last = list[list.length - 1];
        const inside = !!active && panel.contains(active) && active !== panel;
        if (e.shiftKey ? (!inside || active === first) : (!inside || active === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus({ preventScroll: true });
        }
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (modalStack[modalStack.length - 1] !== id) return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    // initial focus fallback: after children's autoFocus and after closed popovers returned focus to their anchors
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && modalStack[modalStack.length - 1] === id && !panel.contains(document.activeElement)) {
        panel.focus({ preventScroll: true });
      }
    });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      const i = modalStack.lastIndexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, id]);

  if (!open) return null;
  return (
    <Portal>
      <div
        className={`anim-fade fixed inset-0 z-[80] flex justify-center bg-black/30 px-3 backdrop-blur-[1px] dark:bg-black/50 sm:px-4 ${position === "top" ? "items-start pt-[8vh] sm:pt-[12vh]" : "items-center"}`}
        onMouseDown={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className={`anim-modal max-h-[88dvh] w-full overflow-y-auto rounded-xl bg-surface shadow-modal outline-none ${className}`}
          style={{ maxWidth: width }}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}

/** True while a modal is open (for components that must ignore Escape then). */
export const modalOpen = () => modalStack.length > 0;
