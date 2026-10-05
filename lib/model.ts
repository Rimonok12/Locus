"use client";
/* ─── Locus · domain constants, selectors and the issue query engine ─── */

import { useMemo } from "react";
import { useSync, type SyncState } from "@/lib/sync/store";
import { useUI } from "@/lib/ui";
import type {
  Cycle, DisplayOptions, DisplayProperty, Filter, Grouping, Health, Issue, Label, Ordering, Priority,
  Profile, Project, ProjectStatus, StateType, Team, WorkflowState, WorkspaceMember,
} from "@/lib/types";

type Rec<T> = Record<string, T>;

/* ═══ constants ═══ */

export const STATE_TYPES: StateType[] = ["backlog", "unstarted", "started", "completed", "canceled"];
export const STATE_TYPE_ORDER: Record<StateType, number> = { backlog: 0, unstarted: 1, started: 2, completed: 3, canceled: 4 };
export const STATE_TYPE_LABEL: Record<StateType, string> = {
  backlog: "Backlog", unstarted: "Todo", started: "In Progress", completed: "Done", canceled: "Canceled",
};
export const STATE_TYPE_COLOR: Record<StateType, string> = {
  backlog: "#bec2c8", unstarted: "#e2e2e2", started: "#f2c94c", completed: "#5e6ad2", canceled: "#95a2b3",
};

export const PRIORITIES: { value: Priority; label: string; shortcut: string }[] = [
  { value: 0, label: "No priority", shortcut: "0" },
  { value: 1, label: "Urgent", shortcut: "1" },
  { value: 2, label: "High", shortcut: "2" },
  { value: 3, label: "Medium", shortcut: "3" },
  { value: 4, label: "Low", shortcut: "4" },
];
export const PRIORITY_LABEL: Record<Priority, string> = { 0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };
/** sort rank: urgent first, no-priority last */
export const PRIORITY_RANK: Record<Priority, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 0: 4 };

export const ESTIMATES = [1, 2, 3, 5, 8, 13];

export const PROJECT_STATUSES: { value: ProjectStatus; label: string; color: string }[] = [
  { value: "backlog", label: "Backlog", color: "#bec2c8" },
  { value: "planned", label: "Planned", color: "#e2e2e2" },
  { value: "started", label: "In Progress", color: "#f2c94c" },
  { value: "paused", label: "Paused", color: "#95a2b3" },
  { value: "completed", label: "Completed", color: "#5e6ad2" },
  { value: "canceled", label: "Canceled", color: "#95a2b3" },
];
export const PROJECT_STATUS_LABEL = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.value, s.label])) as Record<ProjectStatus, string>;

export const HEALTH: { value: Health; label: string; color: string }[] = [
  { value: "on_track", label: "On track", color: "#26b5ce" },
  { value: "at_risk", label: "At risk", color: "#f2994a" },
  { value: "off_track", label: "Off track", color: "#eb5757" },
];
export const HEALTH_LABEL: Record<Health, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track" };
export const HEALTH_COLOR: Record<Health, string> = { on_track: "#26b5ce", at_risk: "#f2994a", off_track: "#eb5757" };

/** swatches offered by every color picker */
export const COLORS = [
  "#5e6ad2", "#26b5ce", "#0f7488", "#4cb782", "#f2c94c", "#f2994a", "#eb5757", "#bb87fc",
  "#e93d82", "#4ea7fc", "#95a2b3", "#6e56cf",
];

export const PROPERTY_LABEL: Record<DisplayProperty, string> = {
  id: "ID", status: "Status", priority: "Priority", assignee: "Assignee", labels: "Labels", project: "Project",
  cycle: "Cycle", estimate: "Estimate", due: "Due date", created: "Created", updated: "Updated",
  milestone: "Milestone", subIssues: "Sub-issue count",
};

/* ═══ basic selectors ═══ */

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

export const useMe = () => useSync((s) => s.profiles[s.userId]);
export const useMeId = () => useSync((s) => s.userId);
export const useWorkspace = () => useSync((s) => s.workspaces[s.workspaceId]);
export const useIsAdmin = () => useSync((s) => s.workspace_members[s.userId]?.role === "admin");

export function useMembers(): Profile[] {
  const members = useSync((s) => s.workspace_members);
  const profiles = useSync((s) => s.profiles);
  return useMemo(
    () => Object.values(members).map((m) => profiles[m.user_id]).filter(Boolean).sort(byName),
    [members, profiles],
  );
}

export function useTeams(): Team[] {
  const teams = useSync((s) => s.teams);
  return useMemo(() => Object.values(teams).filter((t) => !t.archived_at).sort(byName), [teams]);
}

export function useMyTeams(): Team[] {
  const teams = useTeams();
  const tm = useSync((s) => s.team_members);
  const me = useMeId();
  return useMemo(() => teams.filter((t) => tm[`${t.id}:${me}`]), [teams, tm, me]);
}

export function useTeamByKey(key: string | undefined): Team | undefined {
  const teams = useSync((s) => s.teams);
  return useMemo(() => Object.values(teams).find((t) => t.key === key?.toUpperCase()), [teams, key]);
}

export function sortStates(states: WorkflowState[]): WorkflowState[] {
  return [...states].sort((a, b) => STATE_TYPE_ORDER[a.type] - STATE_TYPE_ORDER[b.type] || a.position - b.position);
}

export function useTeamStates(teamId: string | undefined): WorkflowState[] {
  const states = useSync((s) => s.workflow_states);
  return useMemo(() => sortStates(Object.values(states).filter((st) => st.team_id === teamId)), [states, teamId]);
}

export function defaultStateFor(teamId: string, states: Rec<WorkflowState>, type: StateType = "unstarted"): WorkflowState | undefined {
  const own = sortStates(Object.values(states).filter((s) => s.team_id === teamId));
  return own.find((s) => s.type === type) ?? own.find((s) => s.type === "unstarted") ?? own[0];
}

/** workspace labels + (optionally) one team's labels */
export function useLabels(teamId?: string | null): Label[] {
  const labels = useSync((s) => s.labels);
  return useMemo(
    () => Object.values(labels).filter((l) => !l.team_id || !teamId || l.team_id === teamId).sort(byName),
    [labels, teamId],
  );
}

export function useProjects(includeArchived = false): Project[] {
  const projects = useSync((s) => s.projects);
  return useMemo(
    () => Object.values(projects).filter((p) => includeArchived || !p.archived_at)
      .sort((a, b) => a.sort_order - b.sort_order || byName(a, b)),
    [projects, includeArchived],
  );
}

export function useTeamCycles(teamId: string | undefined): Cycle[] {
  const cycles = useSync((s) => s.cycles);
  return useMemo(() => Object.values(cycles).filter((c) => c.team_id === teamId).sort((a, b) => a.number - b.number), [cycles, teamId]);
}

/** today's date (YYYY-MM-DD) in the user's local timezone */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function cyclePhase(c: Cycle, today = todayISO()): "past" | "current" | "upcoming" {
  if (c.completed_at || c.ends_at <= today) return "past";
  if (c.starts_at <= today) return "current";
  return "upcoming";
}
export const cycleName = (c: Cycle) => c.name || `Cycle ${c.number}`;

export function issueKey(issue: Pick<Issue, "team_id" | "number">, teams: Rec<Team> = useSync.getState().teams): string {
  const key = teams[issue.team_id]?.key ?? "???";
  return issue.number ? `${key}-${issue.number}` : `${key}-…`;
}

export function useIssue(id: string | null | undefined): Issue | undefined {
  return useSync((s) => (id ? s.issues[id] : undefined));
}

export function findIssueByKey(identifier: string, s: SyncState = useSync.getState()): Issue | undefined {
  const m = identifier.toUpperCase().match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
  if (!m) return undefined;
  const team = Object.values(s.teams).find((t) => t.key === m[1]);
  if (!team) return undefined;
  const n = Number(m[2]);
  return Object.values(s.issues).find((i) => i.team_id === team.id && i.number === n);
}

export function useIssueByKey(identifier: string): Issue | undefined {
  const issues = useSync((s) => s.issues);
  const teams = useSync((s) => s.teams);
  return useMemo(() => findIssueByKey(identifier, { ...useSync.getState(), issues, teams }), [identifier, issues, teams]);
}

export function useSubIssues(parentId: string | undefined): Issue[] {
  const issues = useSync((s) => s.issues);
  const states = useSync((s) => s.workflow_states);
  return useMemo(
    () => Object.values(issues).filter((i) => i.parent_id === parentId && !i.archived_at)
      .sort((a, b) => STATE_TYPE_ORDER[states[a.state_id]?.type ?? "backlog"] - STATE_TYPE_ORDER[states[b.state_id]?.type ?? "backlog"] || a.sort_order - b.sort_order),
    [issues, states, parentId],
  );
}

export function displayName(p: Profile | undefined | null): string {
  if (!p) return "Unknown";
  return p.name || p.display_name || p.email.split("@")[0];
}

/** progress of a set of issues (completed share, canceled excluded), Linear-style */
export function progressOf(issues: Issue[], states: Rec<WorkflowState>) {
  let total = 0, done = 0, started = 0, scope = 0, completedScope = 0;
  for (const i of issues) {
    const t = states[i.state_id]?.type;
    if (t === "canceled") continue;
    total++;
    const pts = i.estimate ?? 1;
    scope += pts;
    if (t === "completed") { done++; completedScope += pts; }
    else if (t === "started") started++;
  }
  return { total, done, started, scope, completedScope, ratio: total ? done / total : 0 };
}

/* ═══ query engine: filter → completed window → sort → group ═══ */

export interface QueryCtx {
  me: string;
  states: Rec<WorkflowState>;
  teams: Rec<Team>;
  labels: Rec<Label>;
  projects: Rec<Project>;
  cycles: Rec<Cycle>;
  profiles: Rec<Profile>;
  members: Rec<WorkspaceMember>;
  today: string;
}

export const ctxOf = (s: SyncState): QueryCtx => ({
  me: s.userId, states: s.workflow_states, teams: s.teams, labels: s.labels, projects: s.projects,
  cycles: s.cycles, profiles: s.profiles, members: s.workspace_members, today: todayISO(),
});

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function filterValuesOf(issue: Issue, f: Filter, ctx: QueryCtx): (string | null)[] {
  switch (f.field) {
    case "status": return [issue.state_id];
    case "state_type": return [ctx.states[issue.state_id]?.type ?? null];
    case "assignee": return [issue.assignee_id];
    case "creator": return [issue.creator_id];
    case "priority": return [String(issue.priority)];
    case "label": return issue.label_ids.length ? issue.label_ids : [null];
    case "project": return [issue.project_id];
    case "cycle": return [issue.cycle_id];
    case "team": return [issue.team_id];
    case "estimate": return [issue.estimate == null ? null : String(issue.estimate)];
    case "due": {
      const d = issue.due_date;
      if (!d) return [null];
      const out: string[] = [];
      if (d < ctx.today) out.push("overdue");
      if (d === ctx.today) out.push("today");
      if (d >= ctx.today && d <= addDays(ctx.today, 7)) out.push("week");
      return out.length ? out : ["later"];
    }
  }
}

export function matchesFilter(issue: Issue, f: Filter, ctx: QueryCtx): boolean {
  if (!f.values.length) return true;
  const wanted = new Set(f.values.map((v) => (v === "me" ? ctx.me : v === "none" ? null : v)));
  const have = filterValuesOf(issue, f, ctx);
  // "current" cycle token
  if (f.field === "cycle" && f.values.includes("current")) {
    const cyc = issue.cycle_id ? ctx.cycles[issue.cycle_id] : undefined;
    if (cyc && cyclePhase(cyc, ctx.today) === "current") return f.op === "is";
  }
  const hit = have.some((v) => wanted.has(v));
  return f.op === "is" ? hit : !hit;
}

export const applyFilters = (issues: Issue[], filters: Filter[], ctx: QueryCtx) =>
  filters.length ? issues.filter((i) => filters.every((f) => matchesFilter(i, f, ctx))) : issues;

export function applyCompletedWindow(issues: Issue[], window: DisplayOptions["completed"], ctx: QueryCtx) {
  if (window === "all") return issues;
  const days = window === "day" ? 1 : window === "week" ? 7 : window === "month" ? 30 : -1;
  const cutoff = days < 0 ? Infinity : Date.now() - days * 864e5;
  return issues.filter((i) => {
    const t = ctx.states[i.state_id]?.type;
    if (t !== "completed" && t !== "canceled") return true;
    if (days < 0) return false;
    const at = Date.parse(i.completed_at ?? i.canceled_at ?? i.updated_at);
    return at >= cutoff;
  });
}

export function sortIssues(issues: Issue[], ordering: Ordering): Issue[] {
  const arr = [...issues];
  const cmp: Record<Ordering, (a: Issue, b: Issue) => number> = {
    manual: (a, b) => a.sort_order - b.sort_order,
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sort_order - b.sort_order,
    updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    created: (a, b) => b.created_at.localeCompare(a.created_at),
    due: (a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    title: (a, b) => a.title.localeCompare(b.title),
    estimate: (a, b) => (b.estimate ?? -1) - (a.estimate ?? -1),
  };
  return arr.sort((a, b) => cmp[ordering](a, b) || b.created_at.localeCompare(a.created_at));
}

export interface IssueGroup {
  key: string;
  grouping: Grouping;
  /** the value issues in this group share: state id / state type / user id / project id / priority / … ; null = "none" */
  value: string | null;
  label: string;
  color?: string;
  issues: Issue[];
}

/** Build groups. For status grouping, a single team groups by its workflow states; mixed teams group by state type. */
export function groupIssues(issues: Issue[], display: DisplayOptions, ctx: QueryCtx, opts: { teamId?: string } = {}): IssueGroup[] {
  const sorted = sortIssues(issues, display.ordering);
  const mk = (key: string, value: string | null, label: string, color?: string): IssueGroup =>
    ({ key, grouping: display.grouping, value, label, color, issues: [] });
  const groups = new Map<string, IssueGroup>();
  const order: string[] = [];
  const add = (g: IssueGroup) => { if (!groups.has(g.key)) { groups.set(g.key, g); order.push(g.key); } return groups.get(g.key)!; };

  switch (display.grouping) {
    case "none": {
      const g = add(mk("all", null, "All issues"));
      g.issues = sorted;
      return [g];
    }
    case "status": {
      if (opts.teamId) {
        for (const st of sortStates(Object.values(ctx.states).filter((s) => s.team_id === opts.teamId)))
          add(mk(st.id, st.id, st.name, st.color));
        for (const i of sorted) groups.get(i.state_id)?.issues.push(i);
      } else {
        for (const t of STATE_TYPES) add(mk(t, t, STATE_TYPE_LABEL[t], STATE_TYPE_COLOR[t]));
        for (const i of sorted) groups.get(ctx.states[i.state_id]?.type ?? "backlog")?.issues.push(i);
      }
      break;
    }
    case "priority": {
      for (const p of [1, 2, 3, 4, 0] as Priority[]) add(mk(String(p), String(p), PRIORITY_LABEL[p]));
      for (const i of sorted) groups.get(String(i.priority))!.issues.push(i);
      break;
    }
    case "assignee": {
      const people = Object.values(ctx.members).map((m) => ctx.profiles[m.user_id]).filter(Boolean).sort(byName);
      for (const p of people) add(mk(p.id, p.id, displayName(p)));
      add(mk("none", null, "No assignee"));
      for (const i of sorted) (groups.get(i.assignee_id ?? "none") ?? groups.get("none")!).issues.push(i);
      break;
    }
    case "project": {
      for (const p of Object.values(ctx.projects).filter((p) => !p.archived_at).sort((a, b) => a.sort_order - b.sort_order || byName(a, b)))
        add(mk(p.id, p.id, p.name, p.color));
      add(mk("none", null, "No project"));
      for (const i of sorted) (groups.get(i.project_id ?? "none") ?? groups.get("none")!).issues.push(i);
      break;
    }
    case "cycle": {
      const cycles = Object.values(ctx.cycles).filter((c) => !opts.teamId || c.team_id === opts.teamId).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      for (const c of cycles) add(mk(c.id, c.id, `${opts.teamId ? "" : `${ctx.teams[c.team_id]?.key ?? ""} · `}${cycleName(c)}`));
      add(mk("none", null, "No cycle"));
      for (const i of sorted) (groups.get(i.cycle_id ?? "none") ?? groups.get("none")!).issues.push(i);
      break;
    }
    case "label": {
      for (const l of Object.values(ctx.labels).sort(byName)) add(mk(l.id, l.id, l.name, l.color));
      add(mk("none", null, "No labels"));
      for (const i of sorted) {
        if (!i.label_ids.length) groups.get("none")!.issues.push(i);
        for (const l of i.label_ids) groups.get(l)?.issues.push(i);
      }
      break;
    }
    case "team": {
      for (const t of Object.values(ctx.teams).filter((t) => !t.archived_at).sort(byName)) add(mk(t.id, t.id, t.name, t.color));
      for (const i of sorted) groups.get(i.team_id)?.issues.push(i);
      break;
    }
  }
  const out = order.map((k) => groups.get(k)!);
  return display.showEmptyGroups ? out : out.filter((g) => g.issues.length);
}

/** The patch that moves an issue into a group (drag & drop between groups / board columns). */
export function patchForGroup(group: IssueGroup, issue: Issue, ctx: QueryCtx): Partial<Issue> | null {
  switch (group.grouping) {
    case "status": {
      if (!group.value) return null;
      if (ctx.states[group.value]) {
        if (ctx.states[group.value].team_id === issue.team_id) return { state_id: group.value };
        const same = defaultStateFor(issue.team_id, ctx.states, ctx.states[group.value].type);
        return same ? { state_id: same.id } : null;
      }
      const st = defaultStateFor(issue.team_id, ctx.states, group.value as StateType);
      return st ? { state_id: st.id } : null;
    }
    case "priority": return { priority: Number(group.value) as Priority };
    case "assignee": return { assignee_id: group.value };
    case "project": return { project_id: group.value };
    case "cycle": {
      if (group.value && ctx.cycles[group.value]?.team_id !== issue.team_id) return null;
      return { cycle_id: group.value };
    }
    case "label": return group.value && !issue.label_ids.includes(group.value) ? { label_ids: [...issue.label_ids, group.value] } : null;
    case "team": return group.value ? { team_id: group.value } : null;
    default: return null;
  }
}

/** A sort_order strictly between two neighbours (undefined = open end). */
export function between(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return (next as number) - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

/* ═══ display defaults & the view hook ═══ */

export const DEFAULT_PROPERTIES: Record<DisplayProperty, boolean> = {
  id: true, status: true, priority: true, assignee: true, labels: true, project: true, cycle: false,
  estimate: true, due: true, created: true, updated: false, milestone: false, subIssues: true,
};

export function defaultDisplay(patch: Partial<DisplayOptions> = {}): DisplayOptions {
  return {
    layout: "list",
    grouping: "status",
    ordering: "priority",
    completed: "all",
    showEmptyGroups: false,
    showSubIssues: true,
    ...patch,
    properties: { ...DEFAULT_PROPERTIES, ...(patch.properties ?? {}) },
  };
}

export interface IssueQuery {
  display: DisplayOptions;
  filters: Filter[];
  groups: IssueGroup[];
  /** issues in render order (deduped), used for keyboard navigation */
  flat: Issue[];
  total: number;
  ctx: QueryCtx;
  /** the single team this view is scoped to, when there is one */
  teamId?: string;
}

/**
 * The single entry point every issue list/board uses.
 * @param viewKey   storage key for display + filter preferences (e.g. `team:${id}:active`)
 * @param scope     base predicate deciding which issues belong to the view
 * @param defaults  default display options for this view
 * @param teamId    when the view is single-team (enables per-state grouping)
 * @param baseFilters filters baked into the view (saved views) — user filters are ANDed on top
 */
export function useIssueQuery(opts: {
  viewKey: string;
  scope: (i: Issue, ctx: QueryCtx) => boolean;
  defaults?: Partial<DisplayOptions>;
  teamId?: string;
  baseFilters?: Filter[];
  deps?: unknown[];
}): IssueQuery {
  const issues = useSync((s) => s.issues);
  const states = useSync((s) => s.workflow_states);
  const teams = useSync((s) => s.teams);
  const labels = useSync((s) => s.labels);
  const projects = useSync((s) => s.projects);
  const cycles = useSync((s) => s.cycles);
  const profiles = useSync((s) => s.profiles);
  const members = useSync((s) => s.workspace_members);
  const me = useSync((s) => s.userId);
  const stored = useUI((u) => u.display[opts.viewKey]);
  const userFilters = useUI((u) => u.filters[opts.viewKey]);

  const display = useMemo(
    () => defaultDisplay({ ...opts.defaults, ...stored, properties: { ...DEFAULT_PROPERTIES, ...opts.defaults?.properties, ...stored?.properties } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stored, opts.viewKey, JSON.stringify(opts.defaults)],
  );
  const filters = useMemo(() => [...(opts.baseFilters ?? []), ...(userFilters ?? [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userFilters, opts.viewKey, JSON.stringify(opts.baseFilters)]);

  return useMemo(() => {
    const ctx: QueryCtx = { me, states, teams, labels, projects, cycles, profiles, members, today: todayISO() };
    let list = Object.values(issues).filter((i) => !i.archived_at && opts.scope(i, ctx));
    if (!display.showSubIssues) list = list.filter((i) => !i.parent_id);
    list = applyFilters(list, filters, ctx);
    list = applyCompletedWindow(list, display.completed, ctx);
    const groups = groupIssues(list, display, ctx, { teamId: opts.teamId });
    const seen = new Set<string>();
    const flat: Issue[] = [];
    for (const g of groups) for (const i of g.issues) if (!seen.has(i.id)) { seen.add(i.id); flat.push(i); }
    return { display, filters, groups, flat, total: list.length, ctx, teamId: opts.teamId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, states, teams, labels, projects, cycles, profiles, members, me, display, filters, opts.viewKey, opts.teamId, ...(opts.deps ?? [])]);
}
