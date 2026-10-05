"use client";
/* ─── Locus · issue surfaces · keyboard + pointer interactions shared by list and board ───
   • keeps ui.visibleIds in sync with what the surface renders
   • J/K/arrows move focus (Shift extends the selection), X toggles, Enter/O opens,
     Space peeks, Escape clears the selection, ⌘/Ctrl+A selects everything visible
   • delegated row handlers: click (shift = range, ⌘/Ctrl = new tab), hover focus,
     context menu, and an optional touch long-press that opens the context menu
   ──────────────────────────────────────────────────────────────────────────── */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef,
  type FocusEvent, type MouseEvent, type RefObject, type SyntheticEvent, type TouchEvent,
} from "react";
import { ui, useUI } from "@/lib/ui";
import { useSync } from "@/lib/sync/store";
import { issueKey } from "@/lib/model";
import { navigate } from "@/lib/router";
import { anyOverlayOpen } from "@/components/primitives/overlay";
import { isInteractiveTarget, isTypingTarget, sameIds } from "./shared";

export interface MenuRequest { id: string; x: number; y: number }

const LONG_PRESS_MS = 480;

/** Enter/Space belong to the list unless they target a control inside it (rows/cards themselves are links) */
function ownsActivation(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (el && typeof el.hasAttribute === "function" && el.hasAttribute("data-issue-id")) return false;
  return isInteractiveTarget(t);
}

function rowOf(e: SyntheticEvent<HTMLElement>): HTMLElement | null {
  const t = e.target as HTMLElement | null;
  if (!t || typeof t.closest !== "function") return null;
  const row = t.closest<HTMLElement>("[data-issue-id]");
  // events bubbling through React portals (popovers) have targets outside this container
  return row && e.currentTarget.contains(row) ? row : null;
}

export function useListInteractions({
  ids, containerRef, openMenu, longPress = false, suspended,
}: {
  /** issue ids in render order (deduped) */
  ids: string[];
  containerRef: RefObject<HTMLElement>;
  openMenu: (req: MenuRequest) => void;
  longPress?: boolean;
  /** while this returns true (e.g. a keyboard drag), list shortcuts stand down */
  suspended?: () => boolean;
}) {
  const idsRef = useRef(ids);
  const openMenuRef = useRef(openMenu);
  const suspendedRef = useRef(suspended);
  useLayoutEffect(() => {
    idsRef.current = ids;
    openMenuRef.current = openMenu;
    suspendedRef.current = suspended;
  });

  /** last row the user acted on (keyboard focus, X, checkbox, shift-click) — shift-click ranges start here */
  const anchor = useRef<string | null>(null);
  /** active Shift+J/K extension: where it started and the selection it extends */
  const extension = useRef<{ anchor: string; base: string[] } | null>(null);
  const suppressUntil = useRef(0);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN });
  const press = useRef<{ id: string; x: number; y: number; timer: number; fired: boolean } | null>(null);

  /* ─── visible ids → ui store ─── */
  useEffect(() => {
    if (!sameIds(useUI.getState().visibleIds, ids)) ui.setVisibleIds(ids);
  }, [ids]);
  useEffect(() => () => ui.setVisibleIds([]), []);

  const reveal = useCallback((id: string) => {
    const root = containerRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    // when keyboard focus already lives inside the list, carry it along (keeps Tab order coherent)
    if (root && document.activeElement && document.activeElement !== el && root.contains(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
  }, [containerRef]);

  const selectRange = useCallback((id: string) => {
    const list = idsRef.current;
    const from = anchor.current ? list.indexOf(anchor.current) : -1;
    const to = list.indexOf(id);
    extension.current = null;
    if (from < 0 || to < 0) {
      ui.toggleSelected(id);
      anchor.current = id;
    } else {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      ui.setSelected(Array.from(new Set([...useUI.getState().selected, ...list.slice(lo, hi + 1)])));
    }
    ui.setFocused(id);
  }, []);

  const toggleSelect = useCallback((id: string, range: boolean) => {
    if (range) { selectRange(id); return; }
    extension.current = null;
    anchor.current = id;
    ui.toggleSelected(id);
    ui.setFocused(id);
  }, [selectRange]);

  /* ─── keyboard ─── */
  useEffect(() => {
    const move = (dir: 1 | -1, extend: boolean) => {
      const list = idsRef.current;
      if (!list.length) return;
      const s = useUI.getState();
      const cur = s.focusedId ? list.indexOf(s.focusedId) : -1;
      const nextIdx = cur < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, cur + dir));
      const next = list[nextIdx];
      if (extend) {
        const start = cur >= 0 ? list[cur] : next;
        if (!extension.current || !list.includes(extension.current.anchor)) {
          extension.current = { anchor: start, base: s.selected };
        }
        const a = list.indexOf(extension.current.anchor);
        const [lo, hi] = a < nextIdx ? [a, nextIdx] : [nextIdx, a];
        ui.setSelected(Array.from(new Set([...extension.current.base, ...list.slice(lo, hi + 1)])));
        anchor.current = extension.current.anchor;
      } else {
        extension.current = null;
        anchor.current = next;
      }
      ui.setFocused(next);
      if (s.peekIssueId && s.peekIssueId !== next) ui.peek(next);
      reveal(next);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (isTypingTarget(e.target) || anyOverlayOpen()) return;
      if (suspendedRef.current?.()) return;
      const list = idsRef.current;
      const s = useUI.getState();
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && key === "a") {
        if (!list.length) return;
        e.preventDefault();
        extension.current = null;
        ui.setSelected([...list]);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const focused = s.focusedId && list.includes(s.focusedId) ? s.focusedId : null;
      switch (key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1, e.shiftKey);
          return;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1, e.shiftKey);
          return;
        case "x":
          if (e.shiftKey || !focused) return;
          e.preventDefault();
          if (!e.repeat) toggleSelect(focused, false); // holding X must not flicker the selection
          return;
        case "Enter":
        case "o": {
          if (e.shiftKey || !focused || ownsActivation(e.target)) return;
          const issue = useSync.getState().issues[focused];
          if (!issue) return;
          e.preventDefault();
          if (!e.repeat) navigate({ kind: "issue", identifier: issueKey(issue) });
          return;
        }
        case " ":
          if (e.shiftKey || ownsActivation(e.target)) return;
          if (e.repeat) { if (s.peekIssueId || focused) e.preventDefault(); return; }
          if (s.peekIssueId) { e.preventDefault(); ui.peek(null); return; }
          if (!focused) return;
          e.preventDefault();
          ui.peek(focused);
          return;
        case "Escape":
          if (!s.selected.length) return;
          e.preventDefault();
          extension.current = null;
          ui.clearSelection();
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reveal, toggleSelect]);

  /* ─── delegated pointer handlers ─── */
  const clearPress = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  useEffect(() => clearPress, [clearPress]);

  const handlers = useMemo(() => {
    const base = {
      onClick(e: MouseEvent<HTMLElement>) {
        if (e.defaultPrevented) return;
        const row = rowOf(e);
        if (!row) return;
        if (Date.now() < suppressUntil.current) { e.preventDefault(); return; }
        const id = row.dataset.issueId as string;
        if (e.shiftKey) { e.preventDefault(); selectRange(id); return; }
        if (e.metaKey || e.ctrlKey || e.altKey || e.button !== 0) return; // native: open in a new tab/window
        const href = row.getAttribute("href");
        if (!href) return;
        e.preventDefault();
        navigate(href);
      },
      onFocus(e: FocusEvent<HTMLElement>) {
        // Tab / click focus on a row or card makes it the list's focused issue
        const row = rowOf(e);
        if (!row) return;
        const id = row.dataset.issueId as string;
        if (useUI.getState().focusedId !== id) ui.setFocused(id);
      },
      onMouseMove(e: MouseEvent<HTMLElement>) {
        // only real pointer movement moves focus (content scrolling under a still cursor must not steal it)
        const p = pointer.current;
        if (p.x === e.clientX && p.y === e.clientY) return;
        p.x = e.clientX;
        p.y = e.clientY;
        const row = rowOf(e);
        if (!row) return;
        const id = row.dataset.issueId as string;
        if (useUI.getState().focusedId !== id) ui.setFocused(id);
      },
      onContextMenu(e: MouseEvent<HTMLElement>) {
        const row = rowOf(e);
        if (!row) return;
        e.preventDefault();
        clearPress();
        const id = row.dataset.issueId as string;
        let { clientX: x, clientY: y } = e;
        if (!x && !y) { // keyboard context-menu key
          const r = row.getBoundingClientRect();
          x = r.left + 32;
          y = r.bottom;
        }
        ui.setFocused(id);
        openMenuRef.current({ id, x, y });
      },
    };
    if (!longPress) return base;
    return {
      ...base,
      onTouchStart(e: TouchEvent<HTMLElement>) {
        clearPress();
        if (e.touches.length !== 1) return;
        const row = rowOf(e);
        if (!row) return;
        const t = e.touches[0];
        const id = row.dataset.issueId as string;
        const state = { id, x: t.clientX, y: t.clientY, fired: false, timer: 0 };
        state.timer = window.setTimeout(() => {
          state.fired = true;
          ui.setFocused(id);
          try { navigator.vibrate?.(8); } catch { /* unsupported */ }
        }, LONG_PRESS_MS);
        press.current = state;
      },
      onTouchMove(e: TouchEvent<HTMLElement>) {
        const p = press.current;
        if (!p) return;
        const t = e.touches[0];
        if (!t || Math.hypot(t.clientX - p.x, t.clientY - p.y) > 8) clearPress();
      },
      onTouchEnd(e: TouchEvent<HTMLElement>) {
        const p = press.current;
        clearPress();
        if (!p?.fired) return;
        // swallow the synthetic mouse events / click that would follow, then open the menu
        e.preventDefault();
        suppressUntil.current = Date.now() + 700;
        openMenuRef.current({ id: p.id, x: p.x, y: p.y });
      },
      onTouchCancel() {
        clearPress();
      },
    };
  }, [longPress, selectRange, clearPress]);

  const suppressClicks = useCallback((ms: number) => {
    suppressUntil.current = Date.now() + ms;
  }, []);

  return { handlers, toggleSelect, suppressClicks };
}
