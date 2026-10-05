"use client";
/* ─── Locus · projects: shared hooks, helpers and small building blocks ─── */

import {
  useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode,
} from "react";
import { useSync } from "@/lib/sync/store";
import { STATE_TYPES, HEALTH_COLOR, HEALTH_LABEL, progressOf } from "@/lib/model";
import { hrefFor } from "@/lib/router";
import { Dropdown } from "@/components/primitives/overlay";
import { HealthDot } from "@/components/primitives/icons";
import type { Health, Issue, Project, ProjectUpdate, StateType } from "@/lib/types";

export type Progress = ReturnType<typeof progressOf>;

/* ═══ helpers ═══ */

/** true when a key event comes from a text field / editor (shortcuts must ignore it) */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export const projectUrl = (id: string) => `${window.location.origin}${hrefFor({ kind: "project", id, tab: "overview" })}`;

export const isClosed = (p: Pick<Project, "status">) => p.status === "completed" || p.status === "canceled";

export const pct = (ratio: number) => Math.round(Math.min(1, Math.max(0, ratio)) * 100);

/** Common emoji offered by the project icon picker. */
export const PROJECT_EMOJIS = [
  "🚀", "✨", "🎯", "📦", "🔥", "⚡", "🧪", "🛠️",
  "🧩", "📈", "📊", "💡", "🔒", "🌐", "📱", "💻",
  "🎨", "🧭", "🗺️", "📣", "💬", "📝", "📚", "🏗️",
  "⚙️", "🔧", "🐛", "🧹", "🚢", "🏁", "🎉", "❤️",
  "⭐", "🌱", "🌍", "☁️", "🔍", "🧠", "🤖", "💰",
  "🛒", "📅", "⏱️", "🔔", "🏆", "🎁", "🧬", "🪄",
];

/* ═══ data hooks ═══ */

/** Progress of every project + which teams its issues belong to (one pass over issues). */
export function useProjectStats() {
  const issues = useSync((s) => s.issues);
  const states = useSync((s) => s.workflow_states);
  return useMemo(() => {
    const byProject = new Map<string, Issue[]>();
    const issueTeams: Record<string, Set<string>> = {};
    for (const i of Object.values(issues)) {
      if (!i.project_id || i.archived_at) continue;
      const arr = byProject.get(i.project_id);
      if (arr) arr.push(i); else byProject.set(i.project_id, [i]);
      if (!issueTeams[i.project_id]) issueTeams[i.project_id] = new Set();
      issueTeams[i.project_id].add(i.team_id);
    }
    const progress: Record<string, Progress> = {};
    byProject.forEach((list, pid) => { progress[pid] = progressOf(list, states); });
    return { progress, issueTeams };
  }, [issues, states]);
}

export interface TypeBucket { count: number; points: number }

/** Everything the project overview needs about its issues. */
export function useProjectBreakdown(projectId: string) {
  const issues = useSync((s) => s.issues);
  const states = useSync((s) => s.workflow_states);
  return useMemo(() => {
    const list = Object.values(issues).filter((i) => i.project_id === projectId && !i.archived_at);
    const byType = Object.fromEntries(STATE_TYPES.map((t) => [t, { count: 0, points: 0 }])) as Record<StateType, TypeBucket>;
    const byMilestone: Record<string, Issue[]> = {};
    let hasEstimates = false;
    for (const i of list) {
      const t = states[i.state_id]?.type ?? "backlog";
      byType[t].count++;
      byType[t].points += i.estimate ?? 1;
      if (i.estimate != null) hasEstimates = true;
      if (i.milestone_id) (byMilestone[i.milestone_id] = byMilestone[i.milestone_id] ?? []).push(i);
    }
    return { list, progress: progressOf(list, states), byType, byMilestone, hasEstimates, states };
  }, [issues, states, projectId]);
}

/** Updates of one project, newest first. */
export function useProjectUpdates(projectId: string): ProjectUpdate[] {
  const updates = useSync((s) => s.project_updates);
  return useMemo(
    () => Object.values(updates).filter((u) => u.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [updates, projectId],
  );
}

export function useIsFavoriteProject(projectId: string): boolean {
  return useSync((s) => {
    for (const f of Object.values(s.favorites)) if (f.kind === "project" && f.target_id === projectId && f.user_id === s.userId) return true;
    return false;
  });
}

/**
 * Debounced persistence: `schedule(v)` saves after `delay` ms of quiet, `flush()` saves now.
 * Pending values are flushed on unmount so nothing typed is ever lost.
 */
export function useDebouncedSave<T>(save: (v: T) => void, delay = 700) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ v: T } | null>(null);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current;
    pending.current = null;
    if (p) saveRef.current(p.v);
  }, []);
  const schedule = useCallback((v: T) => {
    pending.current = { v };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }, [flush, delay]);
  useEffect(() => flush, [flush]);
  return { schedule, flush };
}

/* ═══ small components ═══ */

/** Colored health pill ("On track"). */
export function HealthBadge({ health, size = "sm" }: { health: Health; size?: "sm" | "xs" }) {
  const c = HEALTH_COLOR[health];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium ${size === "xs" ? "h-5 px-1.5 text-[10.5px]" : "h-[22px] px-2 text-xxs"}`}
      style={{ color: c, background: `${c}1f` }}
    >
      <HealthDot health={health} size={7} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

/**
 * Text input that edits a persisted value in place: saves on blur / Enter,
 * Escape reverts. External changes flow in while it isn't focused, and a blur
 * without edits never writes (so it can't clobber a concurrent remote change).
 */
export function InlineInput({
  value, onSave, required = false, className = "", maxLength = 80, ...rest
}: {
  value: string;
  onSave: (v: string) => void;
  required?: boolean;
  className?: string;
  maxLength?: number;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onFocus" | "onKeyDown" | "className" | "maxLength">) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const cancelled = useRef(false);
  const dirty = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return (
    <input
      {...rest}
      value={draft}
      maxLength={maxLength}
      onChange={(e) => { dirty.current = true; setDraft(e.target.value); }}
      onFocus={() => { focused.current = true; dirty.current = false; }}
      onBlur={() => {
        focused.current = false;
        const edited = dirty.current;
        dirty.current = false;
        if (cancelled.current || !edited) { cancelled.current = false; setDraft(value); return; }
        const v = draft.trim();
        if (required && !v) { setDraft(value); return; }
        setDraft(v);
        if (v !== value) onSave(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelled.current = true; e.currentTarget.blur(); }
      }}
      className={`min-w-0 bg-transparent outline-none placeholder:text-faint ${className}`}
    />
  );
}

/** Bordered property chip that opens a menu (create modal, overview). */
export function ChipDropdown({
  icon, label, empty, title, width = 260, align = "start", tone, children,
}: {
  icon: ReactNode;
  label: ReactNode;
  empty?: boolean;
  title: string;
  width?: number;
  align?: "start" | "end" | "center";
  tone?: "danger";
  children: (close: () => void) => ReactNode;
}) {
  // the Popover hands focus back to this trigger on close, so Tab / ⌘↵ keep flowing
  return (
    <Dropdown
      width={width}
      align={align}
      trigger={(p) => (
        <button
          ref={p.ref}
          type="button"
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup="dialog"
          title={title}
          className={`focus-ring inline-flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12.5px] transition-colors hover:bg-wash sm:h-7 ${
            p.open ? "border-line-strong bg-wash" : "border-line-strong"
          } ${tone === "danger" ? "text-danger" : empty ? "text-faint" : "text-ink"}`}
        >
          <span className="flex shrink-0 items-center">{icon}</span>
          <span className="truncate">{label}</span>
        </button>
      )}
    >
      {children}
    </Dropdown>
  );
}

/** Small uppercase-ish section title used across the overview. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex h-6 items-center justify-between gap-2">
      <h2 className="text-[12.5px] font-medium text-dim">{children}</h2>
      {right}
    </div>
  );
}
