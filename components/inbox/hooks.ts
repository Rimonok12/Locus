"use client";
/* ─── Locus · small hooks + keyboard guards shared by inbox / search / cycles ─── */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { anyOverlayOpen } from "@/components/primitives/overlay";
import { useUI } from "@/lib/ui";

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** True when a key event comes from somewhere the user is typing (inputs, textareas, rich text, comboboxes). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type);
  return Boolean(target.closest("[contenteditable='true'], [contenteditable=''], [role='textbox'], [role='combobox']"));
}

/** True when the event target activates natively on Enter / Space (links, buttons). */
export function isActivatable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("a[href], button, [role='button'], [role='menuitem']"));
}

/** Any modal, popover, palette, picker, confirm dialog, peek panel or the mobile nav drawer currently open. */
export function overlayOpen(): boolean {
  const u = useUI.getState();
  return anyOverlayOpen() || u.paletteOpen || Boolean(u.createIssue) || Boolean(u.picker) || u.shortcutsOpen
    || Boolean(u.confirm) || Boolean(u.peekIssueId) || u.mobileNavOpen;
}

/** A clock that re-renders the caller every `intervalMs` (relative times, snooze expiry). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    const onVisible = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [intervalMs]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** md breakpoint and up (two-pane layouts). */
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");

/** Observed content width of an element (responsive SVG charts). */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.clientWidth));
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w != null) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Per-viewer UI memory (collapsed panels…). Never throws. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function writePref(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
