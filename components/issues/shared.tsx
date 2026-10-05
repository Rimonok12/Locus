"use client";
/* ─── Locus · issue surfaces · shared pieces (group icons, row chips, toolbar button, helpers) ─── */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CalendarDays, Hexagon, Layers, RefreshCw, Tag, Triangle } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { useUI } from "@/lib/ui";
import { STATE_TYPES, STATE_TYPE_COLOR, cycleName, type IssueGroup, type QueryCtx } from "@/lib/model";
import { dueInfo, formatDate, formatDateTime, shortAge } from "@/lib/format";
import { Avatar } from "@/components/primitives/Avatar";
import { LabelDot, PriorityIcon, ProgressRing, ProjectIcon, StateIcon, TeamIcon } from "@/components/primitives/icons";
import { anyOverlayOpen } from "@/components/primitives/overlay";
import { StateGlyph } from "@/components/pickers";
import type { Filter, Priority, StateType } from "@/lib/types";

/* ═══ small helpers ═══ */

/** true when a key event comes from somewhere the user is typing */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']"));
}

/** true when Enter / Space on this target already means something (button, link, menu item…) */
export function isInteractiveTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(el.closest("button, a[href], summary, [role='button'], [role='menuitem'], [role='checkbox'], [role='switch'], [role='option']"));
}

/**
 * true while something layered owns the keyboard: a popover/modal (overlay registry), the mobile
 * nav drawer (anyOverlayOpen covers it), or a store-driven overlay that is opening this tick
 * (palette, create-issue, picker, shortcuts help, confirm) before its Modal has registered.
 */
export function overlayActive(): boolean {
  if (anyOverlayOpen()) return true;
  const u = useUI.getState();
  return Boolean(u.paletteOpen || u.createIssue || u.picker || u.shortcutsOpen || u.confirm);
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Set view of an id array, cached per array instance (selection checks stay O(1) per row). */
const setCache = new WeakMap<readonly string[], Set<string>>();
export function asSet(arr: readonly string[]): Set<string> {
  let s = setCache.get(arr);
  if (!s) { s = new Set(arr); setCache.set(arr, s); }
  return s;
}

export type SubCounts = Map<string, { total: number; done: number }>;

/**
 * Could an issue in this status group (a workflow state, or a state type on multi-team
 * views) pass the view's status filters? Used to drop status columns / empty groups that
 * can never hold an issue (e.g. Backlog and Done on a team's Active tab).
 */
export function statusGroupAllowed(group: IssueGroup, filters: Filter[], ctx: QueryCtx): boolean {
  if (group.grouping !== "status" || !group.value) return true;
  const state = ctx.states[group.value];
  const type = (state?.type ?? group.value) as StateType;
  for (const f of filters) {
    if (!f.values.length) continue;
    if (f.field === "state_type") {
      const hit = f.values.includes(type);
      if (f.op === "is" ? !hit : hit) return false;
    } else if (f.field === "status") {
      if (state) {
        const hit = f.values.includes(state.id);
        if (f.op === "is" ? !hit : hit) return false;
      } else if (f.op === "is" && !f.values.some((v) => ctx.states[v]?.type === type)) {
        return false;
      }
    }
  }
  return true;
}

/* ═══ header toolbar button (Filter / Display / favorite) ═══ */

export const ToolbarButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; label: string; active?: boolean; bordered?: boolean; iconOnly?: boolean }
>(function ToolbarButton({ icon, label, active, bordered, iconOnly, className = "", type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={iconOnly ? label : undefined}
      className={`focus-ring inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium transition-colors sm:h-7 sm:min-w-7 ${
        iconOnly ? "" : "px-2"
      } ${bordered ? "border border-line-strong bg-surface shadow-card" : ""} ${active ? "bg-wash text-ink" : "text-dim hover:bg-wash hover:text-ink"} ${className}`}
      {...rest}
    >
      {icon}
      {!iconOnly && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
});

/* ═══ group icon (list section headers, board columns) ═══ */

export function GroupIcon({ group, ctx }: { group: IssueGroup; ctx: QueryCtx }) {
  const v = group.value;
  switch (group.grouping) {
    case "status": {
      if (v && ctx.states[v]) return <StateGlyph stateId={v} />;
      const t: StateType = v && (STATE_TYPES as string[]).includes(v) ? (v as StateType) : "backlog";
      return <StateIcon type={t} color={STATE_TYPE_COLOR[t]} />;
    }
    case "priority":
      return <PriorityIcon priority={Number(v ?? 0) as Priority} className="text-dim" />;
    case "assignee":
      return <Avatar userId={v} size={16} />;
    case "project": {
      const p = v ? ctx.projects[v] : undefined;
      return p ? <ProjectIcon icon={p.icon} color={p.color} /> : <Hexagon size={14} className="text-faint" />;
    }
    case "cycle":
      return <RefreshCw size={13} className={v ? "text-dim" : "text-faint"} />;
    case "label":
      return v ? <LabelDot color={group.color ?? ctx.labels[v]?.color ?? "var(--faint)"} /> : <Tag size={13} className="text-faint" />;
    case "team":
      return v && ctx.teams[v] ? <TeamIcon team={ctx.teams[v]} size={16} /> : <Layers size={13} className="text-faint" />;
    default:
      return <Layers size={13} className="text-faint" />;
  }
}

/* ═══ compact property chips (rows + cards) ═══ */

const CHIP = "h-[22px] shrink-0 items-center gap-1 rounded-full border border-line-strong px-2 text-xxs font-medium text-dim";

export function ProjectChip({ id, display = "inline-flex" }: { id: string | null; display?: string }) {
  const p = useSync((s) => (id ? s.projects[id] : undefined));
  if (!p) return null;
  return (
    <span title={`Project · ${p.name}`} className={`${display} ${CHIP} max-w-[170px]`}>
      <ProjectIcon icon={p.icon} color={p.color} size={12} />
      <span className="truncate">{p.name}</span>
    </span>
  );
}

export function CycleChip({ id, display = "inline-flex" }: { id: string | null; display?: string }) {
  const c = useSync((s) => (id ? s.cycles[id] : undefined));
  if (!c) return null;
  return (
    <span title={`Cycle · ${cycleName(c)} (${formatDate(c.starts_at)} – ${formatDate(c.ends_at)})`} className={`${display} ${CHIP} max-w-[140px]`}>
      <RefreshCw size={11} className="shrink-0" />
      <span className="truncate">{cycleName(c)}</span>
    </span>
  );
}

export function MilestoneChip({ id, display = "inline-flex" }: { id: string | null; display?: string }) {
  const m = useSync((s) => (id ? s.project_milestones[id] : undefined));
  if (!m) return null;
  return (
    <span title={`Milestone · ${m.name}`} className={`${display} ${CHIP} max-w-[140px]`}>
      <Triangle size={10} className="shrink-0" />
      <span className="truncate">{m.name}</span>
    </span>
  );
}

export function EstimateChip({ value, display = "inline-flex" }: { value: number | null; display?: string }) {
  if (value == null) return null;
  return (
    <span title={`Estimate · ${value} point${value === 1 ? "" : "s"}`} className={`${display} ${CHIP} tabular-nums`}>
      <Triangle size={10} className="shrink-0" />
      {value}
    </span>
  );
}

export function DueChip({ date, display = "inline-flex" }: { date: string | null; display?: string }) {
  const d = dueInfo(date);
  if (!d || !date) return null;
  const tone = d.tone === "overdue" ? "text-danger" : d.tone === "soon" ? "text-warning" : "";
  return (
    <span title={`${d.tone === "overdue" ? "Overdue · due" : "Due"} ${formatDate(date, true)}`} className={`${display} ${CHIP} ${tone}`}>
      <CalendarDays size={11} className="shrink-0" />
      {d.label}
    </span>
  );
}

export function AgeLabel({ iso, verb, display = "inline-flex" }: { iso: string; verb: string; display?: string }) {
  return (
    <span title={`${verb} ${formatDateTime(iso)}`} className={`${display} w-10 shrink-0 justify-end text-xxs tabular-nums text-faint`}>
      {shortAge(iso)}
    </span>
  );
}

export function SubIssueChip({ done, total }: { done: number; total: number }) {
  return (
    <span
      title={`${done} of ${total} sub-issue${total === 1 ? "" : "s"} done`}
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-line px-1.5 text-xxs tabular-nums text-faint"
    >
      <ProgressRing value={total ? done / total : 0} size={11} color={done === total ? "var(--success)" : "var(--accent)"} />
      {done}/{total}
    </span>
  );
}
