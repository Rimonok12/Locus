"use client";
/* ─── Locus · UI state (overlays, selection, toasts, preferences) ─── */

import { create } from "zustand";
import type { DisplayOptions, Filter, Issue } from "@/lib/types";

export type PickerKind =
  | "status" | "priority" | "assignee" | "labels" | "project" | "cycle" | "estimate"
  | "team" | "due" | "parent" | "milestone";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
  action?: { label: string; run: () => void };
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export type Theme = "light" | "dark" | "system";

interface UIState {
  /* overlays */
  paletteOpen: boolean;
  createIssue: null | { defaults: Partial<Issue> };
  picker: null | { kind: PickerKind; issueIds: string[] };
  shortcutsOpen: boolean;
  confirm: ConfirmRequest | null;
  peekIssueId: string | null;

  /* list interaction */
  selected: string[];
  focusedId: string | null;
  /** ordered ids currently rendered by the active list/board (for J/K, shift-select, select-all) */
  visibleIds: string[];

  /* chrome */
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  theme: Theme;

  /* per-view preferences, keyed by view key (e.g. "team:<id>:all") */
  display: Record<string, Partial<DisplayOptions>>;
  filters: Record<string, Filter[]>;

  toasts: Toast[];
}

const load = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
};

export const useUI = create<UIState>()(() => ({
  paletteOpen: false,
  createIssue: null,
  picker: null,
  shortcutsOpen: false,
  confirm: null,
  peekIssueId: null,
  selected: [],
  focusedId: null,
  visibleIds: [],
  sidebarCollapsed: load("locus:sidebar-collapsed", false),
  mobileNavOpen: false,
  theme: load<Theme>("locus:theme", "system"),
  display: load("locus:display", {}),
  filters: {},
  toasts: [],
}));

const set = useUI.setState;
const get = useUI.getState;

/* ─── actions ─── */
export const ui = {
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  // global dialogs close the mobile nav drawer (as ⌘K does), so dismissing them never lands back in it
  openCreateIssue: (defaults: Partial<Issue> = {}) => set({ createIssue: { defaults }, paletteOpen: false, mobileNavOpen: false }),
  closeCreateIssue: () => set({ createIssue: null }),
  openPicker: (kind: PickerKind, issueIds: string[]) =>
    issueIds.length ? set({ picker: { kind, issueIds }, paletteOpen: false }) : undefined,
  closePicker: () => set({ picker: null }),
  openShortcuts: () => set({ shortcutsOpen: true, mobileNavOpen: false }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
  askConfirm: (req: ConfirmRequest) => set({ confirm: req, mobileNavOpen: false }),
  closeConfirm: () => set({ confirm: null }),
  peek: (id: string | null) => set({ peekIssueId: id }),

  setSelected: (ids: string[]) => set({ selected: ids }),
  toggleSelected: (id: string) =>
    set((s) => ({ selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] })),
  clearSelection: () => set({ selected: [] }),
  setFocused: (id: string | null) => set({ focusedId: id }),
  setVisibleIds: (ids: string[]) => set({ visibleIds: ids }),
  /** ids the next keyboard action applies to: the selection, else the focused issue */
  targetIds: (): string[] => {
    const s = get();
    if (s.selected.length) return s.selected;
    if (s.peekIssueId) return [s.peekIssueId];
    return s.focusedId ? [s.focusedId] : [];
  },

  toggleSidebar: () =>
    set((s) => {
      save("locus:sidebar-collapsed", !s.sidebarCollapsed);
      return { sidebarCollapsed: !s.sidebarCollapsed };
    }),
  setMobileNav: (open: boolean) => set({ mobileNavOpen: open }),
  setTheme: (theme: Theme) => {
    save("locus:theme", theme);
    set({ theme });
    applyTheme(theme);
  },

  setDisplay: (viewKey: string, patch: Partial<DisplayOptions>) =>
    set((s) => {
      const display = { ...s.display, [viewKey]: { ...s.display[viewKey], ...patch } };
      save("locus:display", display);
      return { display };
    }),
  resetDisplay: (viewKey: string) =>
    set((s) => {
      const display = { ...s.display };
      delete display[viewKey];
      save("locus:display", display);
      return { display };
    }),
  setFilters: (viewKey: string, filters: Filter[]) => set((s) => ({ filters: { ...s.filters, [viewKey]: filters } })),
};

/* ─── toasts ─── */
let toastSeq = 0;
function pushToast(kind: Toast["kind"], message: string, action?: Toast["action"]) {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message, action }] }));
  setTimeout(() => dismissToast(id), action ? 7000 : kind === "error" ? 6000 : 3500);
  return id;
}
export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
export const toast = Object.assign(
  (message: string, action?: Toast["action"]) => pushToast("info", message, action),
  {
    success: (message: string, action?: Toast["action"]) => pushToast("success", message, action),
    error: (message: string) => pushToast("error", message),
  },
);

/* ─── theme ─── */
/** Canvas colors (globals.css --canvas); the browser chrome / status bar follows the in-app theme. */
export const THEME_COLOR = { light: "#f9f7f7", dark: "#0c1a2c" } as const;

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const dark =
    theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  // Our own theme-color tag (created by the root layout's head script). Next renders none, so React
  // never owns, re-mounts or removes it.
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.removeAttribute("media");
  meta.content =
    getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim() || (dark ? THEME_COLOR.dark : THEME_COLOR.light);
}
