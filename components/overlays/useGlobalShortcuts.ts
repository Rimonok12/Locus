"use client";
/* ─── Locus · global keyboard shortcuts ──────────────────────────────────────
   One window keydown listener (bubble phase, so views that consume a key in the
   capture phase — issue page, peek, inbox, search — win and we see
   defaultPrevented). Lists own J/K/X/Enter/O/Space/F (and ⌘A, Shift+J/K), the
   issue page owns its J/K; everything else that is global lives here.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";
import { navigate, type Route } from "@/lib/router";
import { toast, ui, useUI, type PickerKind } from "@/lib/ui";
import { useSync } from "@/lib/sync/store";
import { anyOverlayOpen, modalOpen } from "@/components/primitives/overlay";
import {
  activeTeams, confirmDeleteIssues, copyIssueIds, copyIssueLinks, createDefaultsFor, isTypingTarget, myTeamsOf,
  routeFromLocation, routeTeam, targetIssueIds, toggleAssignToMe,
} from "./commands";
import type { Team } from "@/lib/types";

const CHORD_MS = 1200;
/** the docked sidebar's breakpoint (Tailwind `md`); below it the sidebar is the navigation drawer */
const WIDE = "(min-width: 768px)";

const PICKERS: Record<string, PickerKind> = { s: "status", p: "priority", a: "assignee", l: "labels" };
const SHIFT_PICKERS: Record<string, PickerKind> = { p: "project", c: "cycle", e: "estimate", d: "due", m: "team" };

/** ⌘K: open/close the palette. It replaces the transient dialogs (property picker, shortcut help)
    but never stacks on top of work in progress — a new issue, a pending confirmation, or a view's own form. */
function togglePalette() {
  const u = useUI.getState();
  if (u.paletteOpen) { ui.closePalette(); return; }
  if (u.createIssue || u.confirm) return;
  const replaceable = Boolean(u.picker) || u.shortcutsOpen;
  if (!replaceable && modalOpen()) return;
  if (u.picker) ui.closePicker();
  if (u.shortcutsOpen) ui.closeShortcuts();
  if (u.mobileNavOpen) ui.setMobileNav(false);
  ui.openPalette();
}

/** A dialog, palette, menu or the mobile drawer owns the keyboard. */
function overlayActive(u: ReturnType<typeof useUI.getState>): boolean {
  return u.paletteOpen || Boolean(u.createIssue) || Boolean(u.picker) || u.shortcutsOpen || Boolean(u.confirm) || anyOverlayOpen();
}

/** "[" — collapse/expand the sidebar; below md (no docked sidebar) it opens the navigation drawer. */
function toggleSidebar() {
  if (window.matchMedia(WIDE).matches) ui.toggleSidebar();
  else ui.setMobileNav(true);
}

/** The team "G T / G A / G B / G C" should land on: the one in view, else the first of mine. */
function contextTeam(): Team | undefined {
  const s = useSync.getState();
  return routeTeam(routeFromLocation(), s) ?? myTeamsOf(s)[0] ?? activeTeams(s)[0];
}

function goToTeam(build: (t: Team) => Route) {
  const t = contextTeam();
  navigate(t ? build(t) : { kind: "settings", section: "teams" });
}

/** Second key of a "G then …" chord. Returns true when handled. */
function goTo(key: string): boolean {
  switch (key) {
    case "i": navigate({ kind: "inbox" }); return true;
    case "m": navigate({ kind: "my-issues", tab: "assigned" }); return true;
    case "p": navigate({ kind: "projects", tab: "all" }); return true;
    case "v": navigate({ kind: "views" }); return true;
    case "s": navigate({ kind: "settings", section: "account" }); return true;
    case "t": goToTeam((t) => ({ kind: "team", key: t.key, tab: "all" })); return true;
    case "a": goToTeam((t) => ({ kind: "team", key: t.key, tab: "active" })); return true;
    case "b": goToTeam((t) => ({ kind: "team", key: t.key, tab: "backlog" })); return true;
    case "c": {
      const s = useSync.getState();
      const current = contextTeam();
      const team = current?.cycles_enabled ? current : myTeamsOf(s).find((t) => t.cycles_enabled);
      if (team) navigate({ kind: "team-cycles", key: team.key });
      else toast(current ? `Cycles are turned off for ${current.name}` : "None of your teams use cycles");
      return true;
    }
  }
  return false;
}

/** "/" — go to search, or focus its box when already there. */
function goToSearch() {
  if (routeFromLocation().kind === "search") {
    const input = document.querySelector<HTMLInputElement>("main input[type='search'], main input[type='text'], main input:not([type])");
    input?.focus();
    input?.select();
    return;
  }
  navigate({ kind: "search" });
}

export function useGlobalShortcuts() {
  useEffect(() => {
    let chordAt = 0;

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTypingTarget(e.target);
      const key = e.key ?? "";
      const lower = key.length === 1 ? key.toLowerCase() : key;

      /* ⌘K — toggles the palette even while typing (unless a field / menu consumed the combo) */
      if (mod && !e.altKey && !e.shiftKey && lower === "k") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        chordAt = 0;
        if (!e.repeat) togglePalette();
        return;
      }

      // a view that handled the key (capture phase), a menu or dialog that closed on Escape, wins
      if (e.defaultPrevented) { chordAt = 0; return; }
      const u = useUI.getState();

      /* Escape closes the mobile drawer. It sits above everything on the page, so it goes first:
         ahead of overlayActive() (anyOverlayOpen() is true while the drawer is open) and ahead of
         the typing check (focus can be left in a field behind the drawer's backdrop). */
      if (key === "Escape" && u.mobileNavOpen && !mod && !e.altKey && !e.shiftKey) {
        chordAt = 0;
        e.preventDefault();
        ui.setMobileNav(false);
        return;
      }

      // fields keep their keys
      if (typing) { chordAt = 0; return; }

      /* Escape: selection → peek (dialogs, menus and the drawer are handled above / close themselves) */
      if (key === "Escape") {
        chordAt = 0;
        if (mod || e.altKey || e.shiftKey) return;
        if (overlayActive(u)) return;
        if (u.selected.length) { e.preventDefault(); ui.clearSelection(); return; }
        if (u.peekIssueId) { e.preventDefault(); ui.peek(null); }
        return;
      }

      if (overlayActive(u)) { chordAt = 0; return; }

      /* modifier combos acting on the target issues */
      if (mod) {
        chordAt = 0;
        if (e.altKey) return;
        const isPeriod = !e.shiftKey && (e.code === "Period" || key === ".");
        const isComma = e.shiftKey && (e.code === "Comma" || key === "," || key === "<");
        const isDelete = !e.shiftKey && (key === "Backspace" || key === "Delete");
        if (!isPeriod && !isComma && !isDelete) return;
        const ids = targetIssueIds();
        if (!ids.length) return;
        e.preventDefault();
        if (e.repeat) return;
        if (isPeriod) copyIssueIds(ids);
        else if (isComma) copyIssueLinks(ids);
        else confirmDeleteIssues(ids);
        return;
      }
      if (e.altKey) { chordAt = 0; return; }
      if (e.repeat) return;

      /* G-chords */
      if (chordAt) {
        const live = Date.now() - chordAt <= CHORD_MS;
        chordAt = 0;
        if (live && !e.shiftKey && goTo(lower)) { e.preventDefault(); return; }
      }
      if (lower === "g" && !e.shiftKey) { chordAt = Date.now(); return; }

      /* general */
      if (key === "?") { e.preventDefault(); ui.openShortcuts(); return; }
      if (key === "/") { e.preventDefault(); goToSearch(); return; }
      if (key === "[") { e.preventDefault(); toggleSidebar(); return; }
      if (lower === "c" && !e.shiftKey) {
        e.preventDefault();
        ui.openCreateIssue(createDefaultsFor(routeFromLocation()));
        return;
      }

      /* issue shortcuts on ui.targetIds() (falls back to the open issue page) */
      const pickerKind: PickerKind | undefined = (e.shiftKey ? SHIFT_PICKERS : PICKERS)[lower];
      const isAssignMe = lower === "i" && !e.shiftKey;
      if (!pickerKind && !isAssignMe) return;
      const ids = targetIssueIds();
      if (!ids.length) return;
      e.preventDefault();
      if (pickerKind) ui.openPicker(pickerKind, ids);
      else toggleAssignToMe(ids);
    };

    /* The drawer is CSS-hidden at md+, but while mobileNavOpen stays true anyOverlayOpen() keeps
       every shortcut stood down. Growing the window past the breakpoint (rotation, resize, split
       view) therefore closes it, so the keyboard never goes dead behind an invisible drawer. */
    const wide = window.matchMedia(WIDE);
    const onWide = () => {
      if (wide.matches && useUI.getState().mobileNavOpen) ui.setMobileNav(false);
    };

    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, []);
}
