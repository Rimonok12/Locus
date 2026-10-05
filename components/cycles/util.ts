"use client";
/* ─── Locus · cycle helpers (labels, timing, stats, issue buckets) ─── */

import { useMemo } from "react";
import { useSync } from "@/lib/sync/store";
import { ui } from "@/lib/ui";
import { cyclePhase, todayISO } from "@/lib/model";
import { daysBetween, formatDate } from "@/lib/format";
import { deleteCycle, isFavorite, toggleFavorite } from "@/lib/sync/actions";
import type { Cycle, Issue, WorkflowState } from "@/lib/types";

/** cycleName() that also copes with an optimistic row whose number hasn't come back yet */
export const cycleTitle = (c: Pick<Cycle, "name" | "number">) =>
  c.name || (c.number ? `Cycle ${c.number}` : "New cycle");

export const cycleRange = (c: Pick<Cycle, "starts_at" | "ends_at">) => `${formatDate(c.starts_at)} → ${formatDate(c.ends_at)}`;

/** The viewer's local calendar day (YYYY-MM-DD) of a timestamp — the same calendar todayISO() uses. */
export function localDayOf(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "6 days left" · "Ends today" · "Starts tomorrow" · "Completed Oct 4" · "Ended Oct 4".
 * `ends_at` is exclusive (the next cycle starts on it), so a running cycle always has at least one day
 * left, today included; phase and count come from the same local `today`.
 */
export function cycleTiming(c: Cycle, today = todayISO()): string {
  const phase = cyclePhase(c, today);
  if (phase === "current") {
    const n = daysBetween(today, c.ends_at);
    return n <= 1 ? "Ends today" : `${n} days left`;
  }
  if (phase === "upcoming") {
    const n = daysBetween(today, c.starts_at);
    return n <= 1 ? "Starts tomorrow" : `Starts in ${n} days`;
  }
  return c.completed_at ? `Completed ${formatDate(localDayOf(c.completed_at))}` : `Ended ${formatDate(c.ends_at)}`;
}

/** Non-archived issues per cycle id. */
export function useIssuesByCycle(teamId: string | undefined): Map<string, Issue[]> {
  const issues = useSync((s) => s.issues);
  return useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of Object.values(issues)) {
      if (!i.cycle_id || i.archived_at || (teamId && i.team_id !== teamId)) continue;
      const list = m.get(i.cycle_id);
      if (list) list.push(i); else m.set(i.cycle_id, [i]);
    }
    return m;
  }, [issues, teamId]);
}

export const EMPTY_ISSUES: Issue[] = [];

export interface CycleStats {
  /** non-canceled issues */
  count: number;
  /** estimate points, 1 per unestimated issue */
  scope: number;
  startedCount: number;
  startedPts: number;
  doneCount: number;
  donePts: number;
}

export function cycleStats(issues: Issue[], states: Record<string, WorkflowState>): CycleStats {
  const out: CycleStats = { count: 0, scope: 0, startedCount: 0, startedPts: 0, doneCount: 0, donePts: 0 };
  for (const i of issues) {
    const t = states[i.state_id]?.type;
    if (t === "canceled") continue;
    const pts = i.estimate ?? 1;
    out.count++;
    out.scope += pts;
    if (t === "started") { out.startedCount++; out.startedPts += pts; }
    if (t === "completed") { out.doneCount++; out.donePts += pts; }
  }
  return out;
}

export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** Ask, then delete a cycle (and drop it from favorites). */
export function confirmDeleteCycle(cycle: Cycle, issueCount: number, afterConfirm?: () => void) {
  ui.askConfirm({
    title: `Delete ${cycleTitle(cycle)}?`,
    body: issueCount
      ? `${issueCount} issue${issueCount === 1 ? "" : "s"} will be removed from this cycle. The issues themselves are kept.`
      : "This cycle has no issues. This can’t be undone.",
    confirmLabel: "Delete cycle",
    destructive: true,
    onConfirm: async () => {
      afterConfirm?.();
      if (isFavorite("cycle", cycle.id)) toggleFavorite("cycle", cycle.id);
      await deleteCycle(cycle.id);
    },
  });
}
