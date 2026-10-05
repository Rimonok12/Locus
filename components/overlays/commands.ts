"use client";
/* ─── Locus · overlay helpers: route context, shared issue commands, key glyphs ───
   Used by the global shortcuts, the command palette and the bulk action bar so
   every entry point behaves identically.
   ──────────────────────────────────────────────────────────────────────────── */

import { useSync, type SyncState } from "@/lib/sync/store";
import { ui, useUI } from "@/lib/ui";
import { parseRoute, type Route } from "@/lib/router";
import { cyclePhase, findIssueByKey, issueKey, todayISO } from "@/lib/model";
import { archiveIssues, copyText, deleteIssues, issueUrl, updateIssues } from "@/lib/sync/actions";
import { isMac, modKey } from "@/lib/format";
import type { Cycle, Issue, Team } from "@/lib/types";

/* ═══ keyboard helpers ═══ */

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** True when a key event comes from somewhere the user is typing text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type);
  return Boolean(target.closest("[contenteditable='true'], [contenteditable='']"));
}

/** Key glyphs that adapt to the platform (⌘ / Ctrl, ⇧ / Shift, ⌫ / Backspace). */
export const keys = {
  mod: () => modKey(),
  shift: () => (isMac() ? "⇧" : "Shift"),
  alt: () => (isMac() ? "⌥" : "Alt"),
  backspace: () => (isMac() ? "⌫" : "Backspace"),
  enter: "↵",
};

/* ═══ route context ═══ */

const safeDecode = (s: string) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

/** The workspace route for the current URL (usable outside React). */
export function routeFromLocation(): Route {
  const [, , ...rest] = window.location.pathname.split("/");
  return parseRoute(rest.filter(Boolean).map(safeDecode));
}

const byName = (a: Team, b: Team) => a.name.localeCompare(b.name);

export function activeTeams(s: SyncState = useSync.getState()): Team[] {
  return Object.values(s.teams).filter((t) => !t.archived_at).sort(byName);
}

/** Teams the current user belongs to (mirrors useMyTeams for non-hook callers). */
export function myTeamsOf(s: SyncState = useSync.getState()): Team[] {
  return activeTeams(s).filter((t) => s.team_members[`${t.id}:${s.userId}`]);
}

export function teamByKey(key: string | undefined, s: SyncState = useSync.getState()): Team | undefined {
  if (!key) return undefined;
  const k = key.toUpperCase();
  return Object.values(s.teams).find((t) => t.key === k && !t.archived_at);
}

/** The team the current route is "inside", if any. */
export function routeTeam(route: Route, s: SyncState = useSync.getState()): Team | undefined {
  switch (route.kind) {
    case "team":
    case "team-cycles":
    case "cycle":
    case "team-projects":
      return teamByKey(route.key, s);
    case "settings":
      return teamByKey(route.teamKey, s);
    case "issue": {
      const issue = findIssueByKey(route.identifier, s);
      const t = issue ? s.teams[issue.team_id] : undefined;
      return t && !t.archived_at ? t : undefined;
    }
    case "project": {
      const p = s.projects[route.id];
      const t = p?.team_ids.map((id) => s.teams[id]).find((x) => x && !x.archived_at);
      return t;
    }
    case "view": {
      const v = s.views[route.id];
      const t = v?.team_id ? s.teams[v.team_id] : undefined;
      return t && !t.archived_at ? t : undefined;
    }
    default:
      return undefined;
  }
}

/** The cycle a cycle route points at ("current" resolves to the running cycle). */
export function routeCycle(team: Team, number: number | "current", s: SyncState = useSync.getState()): Cycle | undefined {
  const cycles = Object.values(s.cycles).filter((c) => c.team_id === team.id);
  if (number === "current") {
    const today = todayISO();
    return cycles.filter((c) => cyclePhase(c, today) === "current").sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  }
  return cycles.find((c) => c.number === number);
}

/** Create-issue defaults implied by where the user is. */
export function createDefaultsFor(route: Route, s: SyncState = useSync.getState()): Partial<Issue> {
  switch (route.kind) {
    case "team":
    case "team-cycles":
    case "team-projects": {
      const t = teamByKey(route.key, s);
      return t ? { team_id: t.id } : {};
    }
    case "cycle": {
      const t = teamByKey(route.key, s);
      if (!t) return {};
      const c = t.cycles_enabled ? routeCycle(t, route.number, s) : undefined;
      return c ? { team_id: t.id, cycle_id: c.id } : { team_id: t.id };
    }
    case "project": {
      const p = s.projects[route.id];
      if (!p) return {};
      const t = p.team_ids.map((id) => s.teams[id]).find((x) => x && !x.archived_at);
      return t ? { project_id: p.id, team_id: t.id } : { project_id: p.id };
    }
    case "my-issues":
      return route.tab === "assigned" && s.userId ? { assignee_id: s.userId } : {};
    case "issue":
    case "view": {
      const t = routeTeam(route, s);
      return t ? { team_id: t.id } : {};
    }
    default:
      return {};
  }
}

/* ═══ issue targets & commands ═══ */

/** Keep only ids that still exist in the store. */
export function liveIds(ids: string[], s: SyncState = useSync.getState()): string[] {
  return ids.filter((id) => s.issues[id]);
}

/** Issues the next keyboard/palette action applies to: selection → peek → focus → the open issue page. */
export function targetIssueIds(): string[] {
  const s = useSync.getState();
  const ids = liveIds(ui.targetIds(), s);
  if (ids.length) return ids;
  const route = routeFromLocation();
  if (route.kind === "issue") {
    const issue = findIssueByKey(route.identifier, s);
    if (issue) return [issue.id];
  }
  return [];
}

const issuesOf = (ids: string[]) => {
  const s = useSync.getState();
  return ids.map((id) => s.issues[id]).filter(Boolean) as Issue[];
};

/** Assign to me, or unassign when every target is already mine. */
export function toggleAssignToMe(ids: string[]) {
  const me = useSync.getState().userId;
  const list = issuesOf(ids);
  if (!list.length || !me) return;
  const allMine = list.every((i) => i.assignee_id === me);
  updateIssues(list.map((i) => i.id), { assignee_id: allMine ? null : me });
}

export function allAssignedToMe(ids: string[]): boolean {
  const me = useSync.getState().userId;
  const list = issuesOf(ids);
  return list.length > 0 && list.every((i) => i.assignee_id === me);
}

export function copyIssueIds(ids: string[]) {
  const list = issuesOf(ids);
  if (!list.length) return;
  const keysList = list.map((i) => issueKey(i));
  copyText(keysList.join(", "), list.length === 1 ? `Copied ${keysList[0]}` : `Copied ${list.length} issue IDs`);
}

export function copyIssueLinks(ids: string[]) {
  const list = issuesOf(ids);
  if (!list.length) return;
  copyText(list.map(issueUrl).join("\n"), list.length === 1 ? `Copied link to ${issueKey(list[0])}` : `Copied ${list.length} links`);
}

/** Drop ids from transient list state (selection / focus / peek). */
function forget(ids: string[]) {
  const u = useUI.getState();
  const gone = new Set(ids);
  if (u.selected.some((id) => gone.has(id))) ui.setSelected(u.selected.filter((id) => !gone.has(id)));
  if (u.peekIssueId && gone.has(u.peekIssueId)) ui.peek(null);
  if (u.focusedId && gone.has(u.focusedId)) {
    // move focus to the next visible row so keyboard flow continues
    const idx = u.visibleIds.indexOf(u.focusedId);
    const next = u.visibleIds.slice(idx + 1).find((id) => !gone.has(id)) ?? u.visibleIds.slice(0, Math.max(0, idx)).reverse().find((id) => !gone.has(id));
    ui.setFocused(next ?? null);
  }
}

export function archiveTargets(ids: string[]) {
  const list = issuesOf(ids);
  if (!list.length) return;
  forget(list.map((i) => i.id));
  archiveIssues(list.map((i) => i.id));
}

/** Ask before deleting; deletion itself offers Undo in its toast. */
export function confirmDeleteIssues(ids: string[]) {
  const list = issuesOf(ids);
  if (!list.length) return;
  const n = list.length;
  ui.askConfirm({
    title: n === 1 ? `Delete ${issueKey(list[0])}?` : `Delete ${n} issues?`,
    body: n === 1
      ? `“${list[0].title}” will be deleted along with its comments and history. You can undo this right after.`
      : `These ${n} issues will be deleted along with their comments and history. You can undo this right after.`,
    confirmLabel: n === 1 ? "Delete issue" : `Delete ${n} issues`,
    destructive: true,
    onConfirm: async () => {
      const idsNow = list.map((i) => i.id);
      forget(idsNow);
      await deleteIssues(idsNow);
    },
  });
}
