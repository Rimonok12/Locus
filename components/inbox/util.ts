"use client";
/* ─── Locus · inbox helpers (tabs, snooze presets, routing) ─── */

import { issueKey } from "@/lib/model";
import type { Route } from "@/lib/router";
import type { SyncState } from "@/lib/sync/store";
import type { Notification } from "@/lib/types";

export type InboxTab = "all" | "unread" | "snoozed";

export const isSnoozed = (n: Notification, now = Date.now()) =>
  Boolean(n.snoozed_until) && Date.parse(n.snoozed_until as string) > now;

/** Where a notification leads when opened full-page. */
export function routeForNotification(n: Notification, s: Pick<SyncState, "issues" | "teams" | "projects">): Route | null {
  if (n.issue_id) {
    const issue = s.issues[n.issue_id];
    return issue ? { kind: "issue", identifier: issueKey(issue, s.teams) } : null;
  }
  if (n.project_id && s.projects[n.project_id]) {
    return { kind: "project", id: n.project_id, tab: n.type === "project_update" ? "updates" : "overview" };
  }
  return null;
}

export interface SnoozePreset { id: string; label: string; hint: string; until: Date }

const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

export function snoozePresets(from = new Date()): SnoozePreset[] {
  const hour = new Date(from.getTime() + 60 * 60 * 1000);

  const tomorrow = new Date(from);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const nextWeek = new Date(from);
  nextWeek.setDate(nextWeek.getDate() + (((8 - nextWeek.getDay()) % 7) || 7)); // next Monday
  nextWeek.setHours(9, 0, 0, 0);

  return [
    { id: "hour", label: "1 hour", hint: hour.toLocaleTimeString(undefined, timeFmt), until: hour },
    { id: "tomorrow", label: "Tomorrow 9:00", hint: tomorrow.toLocaleString(undefined, { weekday: "short", ...timeFmt }), until: tomorrow },
    { id: "week", label: "Next week", hint: nextWeek.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" }), until: nextWeek },
  ];
}

/** "until 4:30 PM" today, "until Tue 9:00 AM" this week, "until Oct 12" later. */
export function snoozedUntilLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, timeFmt);
  if (d.getTime() - now.getTime() < 6 * 864e5) return d.toLocaleString(undefined, { weekday: "short", ...timeFmt });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
