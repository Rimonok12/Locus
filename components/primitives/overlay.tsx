"use client";
/* ─── Locus · overlays: Popover (anchored), Dropdown (trigger + popover), Modal ─── */

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

/** Overlays register here so that global shortcuts can tell when one is open. */
let openOverlays = 0;
export const anyOverlayOpen = () => openOverlays > 0;
function useOverlayCount(active: boolean) {
  useEffect(() => {
    if (!active) return;
    openOverlays++;
    return () => { openOverlays--; };
  }, [active]);
}

type Side = "bottom" | "top" | "right" | "left";
type Align = "start" | "end" | "center";

/** Fixed-position popover anchored to an element (or a point). Closes on outside click / Escape. */
export function Popover({
  open, onClose, anchor, side = "bottom", align = "start", offset = 4, width, children, className = "",
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
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  useOverlayCount(open);

  const place = useCallback(() => {
    if (!anchor || !ref.current) return;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
    const pw = ref.current.offsetWidth;
    const ph = ref.current.offsetHeight;
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
    setPos({ top, left, ...(width === "anchor" ? { width: r.width } : width ? { width } : {}) });
  }, [anchor, side, align, offset, width]);

  useLayoutEffect(() => {
    if (!open) { setPos({ visibility: "hidden" }); return; }
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        className={`anim-pop fixed z-[90] overflow-hidden rounded-lg bg-surface shadow-pop ${className}`}
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

/** Centered modal dialog with backdrop. */
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
  useOverlayCount(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <Portal>
      <div
        className={`anim-fade fixed inset-0 z-[80] flex justify-center bg-black/30 px-4 backdrop-blur-[1px] dark:bg-black/50 ${position === "top" ? "items-start pt-[12vh]" : "items-center"}`}
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={`anim-modal w-full overflow-hidden rounded-xl bg-surface shadow-modal ${className}`}
          style={{ maxWidth: width }}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}
