"use client";
/* ─── Locus · global keyboard shortcuts ──────────────────────────────────────
   One window keydown listener for app-wide keys. Lists own J/K/X/Enter/Space/F
   (and ⌘A, Shift+J/K); everything else that is global lives here.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";
import { navigate, type Route } from "@/lib/router";
import { toast, ui, useUI, type PickerKind } from "@/lib/ui";
import { useSync } from "@/lib/sync/store";
import { anyOverlayOpen } from "@/components/primitives/overlay";
import {
  activeTeams, confirmDeleteIssues, copyIssueIds, copyIssueLinks, createDefaultsFor, isTypingTarget, myTeamsOf,
  routeFromLocation, routeTeam, targetIssueIds, toggleAssignToMe,
} from "./commands";
import type { Team } from "@/lib/types";

const CHORD_MS = 1200;

const PICKERS: Record<string, PickerKind> = { s: "status", p: "priority", a: "assignee", l: "labels" };
const SHIFT_PICKERS: Record<string, PickerKind> = { p: "project", c: "cycle", e: "estimate", d: "due", m: "team" };

/** ⌘K: open/close the palette without stacking it on top of another dialog. */
function togglePalette() {
  const u = useUI.getState();
  if (u.paletteOpen) { ui.closePalette(); return; }
  if (u.createIssue || u.picker || u.confirm) return;
  if (u.shortcutsOpen) ui.closeShortcuts();
  if (u.mobileNavOpen) ui.setMobileNav(false);
  ui.openPalette();
}

/** The team "G A / G B / G C" should land on: the one in view, else the first of mine. */
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
    case "t": {
      const s = useSync.getState();
      const t = myTeamsOf(s)[0] ?? activeTeams(s)[0];
      navigate(t ? { kind: "team", key: t.key, tab: "all" } : { kind: "settings", section: "teams" });
      return true;
    }
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

      /* ⌘K — always, even while typing (unless an editor consumed it) */
      if (mod && !e.altKey && !e.shiftKey && lower === "k") {
        if (typing && e.defaultPrevented) return;
        e.preventDefault();
        if (!e.repeat) togglePalette();
        return;
      }

      if (typing || e.defaultPrevented) { chordAt = 0; return; }
      const u = useUI.getState();
      if (u.paletteOpen || u.createIssue || u.picker || u.shortcutsOpen || u.confirm || anyOverlayOpen()) { chordAt = 0; return; }

      /* modifier combos acting on the target issues */
      if (mod) {
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
      if (e.altKey) return;

      /* Escape: selection → peek → mobile drawer */
      if (key === "Escape") {
        chordAt = 0;
        if (u.selected.length) { e.preventDefault(); ui.clearSelection(); return; }
        if (u.peekIssueId) { e.preventDefault(); ui.peek(null); return; }
        if (u.mobileNavOpen) { e.preventDefault(); ui.setMobileNav(false); }
        return;
      }

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
      if (key === "[") { e.preventDefault(); ui.toggleSidebar(); return; }
      if (lower === "c" && !e.shiftKey) {
        e.preventDefault();
        ui.openCreateIssue(createDefaultsFor(routeFromLocation()));
        return;
      }

      /* issue shortcuts on ui.targetIds() */
      const pickerKind: PickerKind | undefined = (e.shiftKey ? SHIFT_PICKERS : PICKERS)[lower];
      const isAssignMe = lower === "i" && !e.shiftKey;
      if (!pickerKind && !isAssignMe) return;
      const ids = targetIssueIds();
      if (!ids.length) return;
      e.preventDefault();
      if (pickerKind) ui.openPicker(pickerKind, ids);
      else toggleAssignToMe(ids);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
