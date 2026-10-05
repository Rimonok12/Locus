"use client";
/* ─── Locus · property pickers ───────────────────────────────────────────────
   Value-based menus (StatusMenu, PriorityMenu, …) usable anywhere — create
   modal, issue sidebar, filters — plus:
     • IssuePicker        applies a property to one or many issues (bulk/keyboard)
     • PropertyChip       anchored trigger + menu bound to a single issue field
   ──────────────────────────────────────────────────────────────────────────── */

import { useMemo, type ReactNode } from "react";
import { CalendarDays, Circle, CircleSlash, Hexagon, RefreshCw, Tag, Triangle, UserRound } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import {
  ESTIMATES, PRIORITIES, cycleName, cyclePhase, displayName, issueKey, sortStates, useLabels, useMembers,
  useProjects, useTeams, useTeamStates, useTeamCycles, PRIORITY_LABEL, todayISO,
} from "@/lib/model";
import { createLabel, setIssuesState, toggleIssueLabel, updateIssue, updateIssues } from "@/lib/sync/actions";
import { addDaysISO, dueInfo, formatDate, localToday } from "@/lib/format";
import { COLORS } from "@/lib/model";
import { SelectMenu, type MenuItem } from "@/components/primitives/SelectMenu";
import { Dropdown } from "@/components/primitives/overlay";
import { Avatar } from "@/components/primitives/Avatar";
import { LabelDot, PriorityIcon, ProjectIcon, StateIcon, TeamIcon } from "@/components/primitives/icons";
import { DatePicker } from "@/components/primitives/DatePicker";
import type { Issue, Priority, WorkflowState } from "@/lib/types";
import type { PickerKind } from "@/lib/ui";

const NONE = "__none";

/** fill fraction for "started" states: ordered position among the team's started states */
export function startedFraction(state: WorkflowState, all: Record<string, WorkflowState>): number {
  const started = sortStates(Object.values(all).filter((s) => s.team_id === state.team_id && s.type === "started"));
  const i = started.findIndex((s) => s.id === state.id);
  return started.length <= 1 ? 0.5 : 0.35 + (0.5 * i) / (started.length - 1);
}

export function StateGlyph({ stateId, size = 14 }: { stateId: string | null | undefined; size?: number }) {
  const states = useSync((s) => s.workflow_states);
  const st = stateId ? states[stateId] : undefined;
  if (!st) return <StateIcon type="backlog" color="var(--faint)" size={size} />;
  return <StateIcon type={st.type} color={st.color} size={size} fraction={st.type === "started" ? startedFraction(st, states) : 0.5} />;
}

/* ═══ value menus ═══ */

export function StatusMenu({ teamId, value, onChange }: { teamId: string; value: string | null; onChange: (stateId: string) => void }) {
  const states = useTeamStates(teamId);
  const items: MenuItem[] = states.map((s, i) => ({
    id: s.id, label: s.name, icon: <StateGlyph stateId={s.id} />, hint: i < 9 ? i + 1 : undefined, keywords: [s.type],
  }));
  return <SelectMenu items={items} selected={value} onSelect={onChange} placeholder="Change status…" />;
}

export function PriorityMenu({ value, onChange }: { value: Priority | null; onChange: (p: Priority) => void }) {
  const items: MenuItem[] = [0, 1, 2, 3, 4].map((p) => ({
    id: String(p), label: PRIORITY_LABEL[p as Priority], icon: <PriorityIcon priority={p as Priority} className="text-dim" />, hint: p,
  }));
  return <SelectMenu items={items} selected={value == null ? null : String(value)} onSelect={(id) => onChange(Number(id) as Priority)} placeholder="Set priority…" digitShortcuts={false} />;
}

export function AssigneeMenu({ value, onChange }: { value: string | null; onChange: (userId: string | null) => void }) {
  const members = useMembers();
  const me = useSync((s) => s.userId);
  const sorted = useMemo(() => [...members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0)), [members, me]);
  const items: MenuItem[] = [
    { id: NONE, label: "No assignee", icon: <UserRound size={14} className="text-faint" /> },
    ...sorted.map((p) => ({
      id: p.id, label: p.id === me ? `${displayName(p)} (you)` : displayName(p), icon: <Avatar profile={p} size={16} />,
      keywords: [p.email, p.display_name],
    })),
  ];
  return <SelectMenu items={items} selected={value ?? NONE} onSelect={(id) => onChange(id === NONE ? null : id)} placeholder="Assign to…" />;
}

export function LabelsMenu({ teamId, value, onToggle }: { teamId?: string | null; value: string[]; onToggle: (labelId: string) => void }) {
  const labels = useLabels(teamId);
  const items: MenuItem[] = labels.map((l) => ({ id: l.id, label: l.name, icon: <LabelDot color={l.color} /> }));
  return (
    <SelectMenu
      multi
      items={items}
      selected={value}
      onSelect={onToggle}
      placeholder="Change labels…"
      digitShortcuts={false}
      onCreate={async (name) => {
        const l = await createLabel(name, COLORS[Math.floor(Math.random() * COLORS.length)]);
        if (l) onToggle(l.id);
      }}
      createLabel={(q) => `Create new label: "${q}"`}
    />
  );
}

export function ProjectMenu({ value, onChange }: { value: string | null; onChange: (projectId: string | null) => void }) {
  const projects = useProjects();
  const items: MenuItem[] = [
    { id: NONE, label: "No project", icon: <Hexagon size={14} className="text-faint" /> },
    ...projects.map((p) => ({ id: p.id, label: p.name, icon: <ProjectIcon icon={p.icon} color={p.color} /> })),
  ];
  return <SelectMenu items={items} selected={value ?? NONE} onSelect={(id) => onChange(id === NONE ? null : id)} placeholder="Add to project…" />;
}

export function MilestoneMenu({ projectId, value, onChange }: { projectId: string; value: string | null; onChange: (id: string | null) => void }) {
  const all = useSync((s) => s.project_milestones);
  const items: MenuItem[] = [
    { id: NONE, label: "No milestone", icon: <Triangle size={13} className="text-faint" /> },
    ...Object.values(all).filter((m) => m.project_id === projectId).sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({ id: m.id, label: m.name, icon: <Triangle size={13} className="text-dim" />, hint: m.target_date ? formatDate(m.target_date) : undefined })),
  ];
  return <SelectMenu items={items} selected={value ?? NONE} onSelect={(id) => onChange(id === NONE ? null : id)} placeholder="Set milestone…" />;
}

export function CycleMenu({ teamId, value, onChange }: { teamId: string; value: string | null; onChange: (cycleId: string | null) => void }) {
  const cycles = useTeamCycles(teamId);
  const today = todayISO();
  const relevant = cycles.filter((c) => cyclePhase(c, today) !== "past" || c.id === value);
  const items: MenuItem[] = [
    { id: NONE, label: "No cycle", icon: <CircleSlash size={14} className="text-faint" /> },
    ...relevant.map((c) => ({
      id: c.id,
      label: cycleName(c),
      icon: <RefreshCw size={13} className="text-dim" />,
      hint: cyclePhase(c, today) === "current" ? "Current" : `${formatDate(c.starts_at)} – ${formatDate(c.ends_at)}`,
    })),
  ];
  return <SelectMenu items={items} selected={value ?? NONE} onSelect={(id) => onChange(id === NONE ? null : id)} placeholder="Add to cycle…" emptyText="No active or upcoming cycles" />;
}

export function EstimateMenu({ value, onChange }: { value: number | null; onChange: (e: number | null) => void }) {
  const items: MenuItem[] = [
    { id: NONE, label: "No estimate", icon: <Triangle size={13} className="text-faint" /> },
    ...ESTIMATES.map((e) => ({ id: String(e), label: `${e} point${e === 1 ? "" : "s"}`, icon: <Triangle size={13} className="text-dim" /> })),
  ];
  return <SelectMenu items={items} selected={value == null ? NONE : String(value)} onSelect={(id) => onChange(id === NONE ? null : Number(id))} placeholder="Set estimate…" />;
}

export function TeamMenu({ value, onChange }: { value: string | null; onChange: (teamId: string) => void }) {
  const teams = useTeams();
  const items: MenuItem[] = teams.map((t) => ({ id: t.id, label: t.name, icon: <TeamIcon team={t} size={16} />, hint: t.key }));
  return <SelectMenu items={items} selected={value} onSelect={onChange} placeholder="Move to team…" />;
}

export function DueDateMenu({ value, onChange }: { value: string | null; onChange: (d: string | null) => void }) {
  const today = localToday();
  const dow = new Date().getDay();
  const presets = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDaysISO(today, 1) },
    { label: "End of this week", date: addDaysISO(today, (5 - dow + 7) % 7 || 7) },
    { label: "In one week", date: addDaysISO(today, 7) },
    { label: "In two weeks", date: addDaysISO(today, 14) },
  ];
  return (
    <div className="w-[260px]">
      <div className="p-1">
        {presets.map((p) => (
          <button key={p.label} onClick={() => onChange(p.date)} className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[13px] text-ink hover:bg-wash">
            {p.label}<span className="text-xxs text-faint">{formatDate(p.date)}</span>
          </button>
        ))}
        {value && (
          <button onClick={() => onChange(null)} className="flex h-8 w-full items-center rounded-md px-2 text-[13px] text-danger hover:bg-wash">Remove due date</button>
        )}
      </div>
      <div className="border-t border-line p-2"><DatePicker value={value} onChange={onChange} /></div>
    </div>
  );
}

export function ParentMenu({ issue, onChange }: { issue: Pick<Issue, "id" | "parent_id" | "team_id">; onChange: (parentId: string | null) => void }) {
  const issues = useSync((s) => s.issues);
  const teams = useSync((s) => s.teams);
  const states = useSync((s) => s.workflow_states);
  const items: MenuItem[] = useMemo(() => {
    // exclude self and descendants
    const blocked = new Set<string>([issue.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of Object.values(issues)) if (i.parent_id && blocked.has(i.parent_id) && !blocked.has(i.id)) { blocked.add(i.id); grew = true; }
    }
    return [
      { id: NONE, label: "No parent issue", icon: <Circle size={13} className="text-faint" /> },
      ...Object.values(issues).filter((i) => !blocked.has(i.id) && !i.archived_at)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 400)
        .map((i) => ({ id: i.id, label: `${issueKey(i, teams)} ${i.title}`, icon: <StateGlyph stateId={i.state_id} />, keywords: [states[i.state_id]?.name ?? ""] })),
    ];
  }, [issues, teams, states, issue.id]);
  return <SelectMenu items={items} selected={issue.parent_id ?? NONE} onSelect={(id) => onChange(id === NONE ? null : id)} placeholder="Set parent issue…" digitShortcuts={false} />;
}

/* ═══ bulk / keyboard picker bound to issue ids ═══ */

export function IssuePicker({ kind, issueIds, onDone }: { kind: PickerKind; issueIds: string[]; onDone: () => void }) {
  const issues = useSync((s) => s.issues);
  const list = issueIds.map((id) => issues[id]).filter(Boolean) as Issue[];
  if (!list.length) return null;
  const first = list[0];
  const same = <K extends keyof Issue>(k: K): Issue[K] | null => (list.every((i) => JSON.stringify(i[k]) === JSON.stringify(first[k])) ? first[k] : null);
  const ids = list.map((i) => i.id);
  const singleTeam = list.every((i) => i.team_id === first.team_id);
  const done = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); onDone(); };

  switch (kind) {
    case "status":
      return <StatusMenu teamId={first.team_id} value={singleTeam ? same("state_id") : null} onChange={done((sid: string) => setIssuesState(ids, sid))} />;
    case "priority":
      return <PriorityMenu value={same("priority")} onChange={done((p: Priority) => updateIssues(ids, { priority: p }))} />;
    case "assignee":
      return <AssigneeMenu value={same("assignee_id")} onChange={done((u: string | null) => updateIssues(ids, { assignee_id: u }))} />;
    case "labels": {
      const common = first.label_ids.filter((l) => list.every((i) => i.label_ids.includes(l)));
      return <LabelsMenu teamId={singleTeam ? first.team_id : null} value={common} onToggle={(l) => toggleIssueLabel(ids, l)} />;
    }
    case "project":
      return <ProjectMenu value={same("project_id")} onChange={done((p: string | null) => updateIssues(ids, { project_id: p, milestone_id: null }))} />;
    case "milestone":
      return first.project_id
        ? <MilestoneMenu projectId={first.project_id} value={same("milestone_id")} onChange={done((m: string | null) => updateIssues(ids, { milestone_id: m }))} />
        : <div className="p-4 text-[13px] text-faint">Add the issue to a project first.</div>;
    case "cycle":
      return singleTeam
        ? <CycleMenu teamId={first.team_id} value={same("cycle_id")} onChange={done((c: string | null) => updateIssues(ids, { cycle_id: c }))} />
        : <div className="p-4 text-[13px] text-faint">Selected issues belong to different teams.</div>;
    case "estimate":
      return <EstimateMenu value={same("estimate")} onChange={done((e: number | null) => updateIssues(ids, { estimate: e }))} />;
    case "team":
      return <TeamMenu value={singleTeam ? first.team_id : null} onChange={done((t: string) => { for (const id of ids) if (issues[id].team_id !== t) updateIssue(id, { team_id: t, cycle_id: null }); })} />;
    case "due":
      return <DueDateMenu value={same("due_date")} onChange={done((d: string | null) => updateIssues(ids, { due_date: d }))} />;
    case "parent":
      return <ParentMenu issue={first} onChange={done((p: string | null) => updateIssues(ids, { parent_id: p }))} />;
  }
}

export const PICKER_TITLE: Record<PickerKind, string> = {
  status: "Change status", priority: "Set priority", assignee: "Assign to", labels: "Change labels",
  project: "Add to project", milestone: "Set milestone", cycle: "Add to cycle", estimate: "Set estimate",
  team: "Move to team", due: "Set due date", parent: "Set parent issue",
};

/* ═══ anchored property chip bound to one issue ═══ */

const chipCls =
  "focus-ring inline-flex h-8 max-w-full items-center gap-1.5 rounded-md px-2 text-[12.5px] text-ink transition-colors hover:bg-wash sm:h-7";

/**
 * A clickable property value that opens its picker in a popover.
 * `variant="sidebar"` renders full-width rows (issue page), `"chip"` bordered pills (create modal), `"icon"` icon-only (list rows).
 */
export function PropertyChip({
  issue, kind, variant = "sidebar", emptyLabel,
}: { issue: Issue; kind: PickerKind; variant?: "sidebar" | "chip" | "icon"; emptyLabel?: string }) {
  const workflow_states = useSync((x) => x.workflow_states);
  const profiles = useSync((x) => x.profiles);
  const projects = useSync((x) => x.projects);
  const project_milestones = useSync((x) => x.project_milestones);
  const cycles = useSync((x) => x.cycles);
  const teams = useSync((x) => x.teams);
  const parent = useSync((x) => (kind === "parent" && issue.parent_id ? x.issues[issue.parent_id] : undefined));
  const s = { workflow_states, profiles, projects, project_milestones, cycles, teams };
  const content = useMemo((): { icon: ReactNode; label: string; empty: boolean } => {
    switch (kind) {
      case "status": {
        const st = s.workflow_states[issue.state_id];
        return { icon: <StateGlyph stateId={issue.state_id} />, label: st?.name ?? "Status", empty: false };
      }
      case "priority":
        return { icon: <PriorityIcon priority={issue.priority} className="text-dim" />, label: PRIORITY_LABEL[issue.priority], empty: issue.priority === 0 };
      case "assignee": {
        const p = issue.assignee_id ? s.profiles[issue.assignee_id] : undefined;
        return { icon: <Avatar profile={p ?? null} size={16} />, label: p ? displayName(p) : "Assign", empty: !p };
      }
      case "project": {
        const p = issue.project_id ? s.projects[issue.project_id] : undefined;
        return { icon: p ? <ProjectIcon icon={p.icon} color={p.color} /> : <Hexagon size={14} className="text-faint" />, label: p?.name ?? "Add to project", empty: !p };
      }
      case "milestone": {
        const m = issue.milestone_id ? s.project_milestones[issue.milestone_id] : undefined;
        return { icon: <Triangle size={13} className={m ? "text-dim" : "text-faint"} />, label: m?.name ?? "Add milestone", empty: !m };
      }
      case "cycle": {
        const c = issue.cycle_id ? s.cycles[issue.cycle_id] : undefined;
        return { icon: <RefreshCw size={13} className={c ? "text-dim" : "text-faint"} />, label: c ? cycleName(c) : "Add to cycle", empty: !c };
      }
      case "estimate":
        return { icon: <Triangle size={13} className={issue.estimate != null ? "text-dim" : "text-faint"} />, label: issue.estimate != null ? `${issue.estimate} point${issue.estimate === 1 ? "" : "s"}` : "Set estimate", empty: issue.estimate == null };
      case "due": {
        const d = dueInfo(issue.due_date);
        return {
          icon: <CalendarDays size={13} className={d?.tone === "overdue" ? "text-danger" : d ? "text-dim" : "text-faint"} />,
          label: d ? (d.tone === "overdue" ? `Overdue · ${d.label}` : d.label) : "Set due date",
          empty: !d,
        };
      }
      case "team": {
        const t = s.teams[issue.team_id];
        return { icon: <TeamIcon team={t} size={16} />, label: t?.name ?? "Team", empty: false };
      }
      case "parent": {
        const p = parent;
        return { icon: <StateGlyph stateId={p?.state_id} />, label: p ? `${issueKey(p, s.teams)} ${p.title}` : "Set parent", empty: !p };
      }
      case "labels": {
        return { icon: <Tag size={13} className="text-faint" />, label: issue.label_ids.length ? `${issue.label_ids.length} labels` : "Add label", empty: !issue.label_ids.length };
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, issue, workflow_states, profiles, projects, project_milestones, cycles, teams, parent]);

  return (
    <Dropdown
      width={kind === "due" ? 260 : 280}
      trigger={(p) => (
        <button
          ref={p.ref}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          className={
            variant === "icon"
              ? "focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] hover:bg-wash sm:h-6 sm:w-6"
              : variant === "chip"
                ? `${chipCls} border border-line-strong ${content.empty ? "text-dim" : ""}`
                : `${chipCls} w-full justify-start ${content.empty ? "text-faint" : ""}`
          }
          title={PICKER_TITLE[kind]}
        >
          {content.icon}
          {variant !== "icon" && <span className="truncate">{content.empty && emptyLabel ? emptyLabel : content.label}</span>}
        </button>
      )}
    >
      {(close) => <IssuePicker kind={kind} issueIds={[issue.id]} onDone={close} />}
    </Dropdown>
  );
}

/** Label pills with an "add" affordance (issue sidebar / rows). */
export function LabelPills({ issue, editable = true, max }: { issue: Issue; editable?: boolean; max?: number }) {
  const labels = useSync((s) => s.labels);
  const shown = issue.label_ids.map((id) => labels[id]).filter(Boolean);
  const visible = max ? shown.slice(0, max) : shown;
  const pills = (
    <span className="inline-flex flex-wrap items-center gap-1">
      {visible.map((l) => (
        <span key={l.id} className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2 text-xxs font-medium text-dim">
          <LabelDot color={l.color} size={7} />{l.name}
        </span>
      ))}
      {max && shown.length > max && <span className="text-xxs text-faint">+{shown.length - max}</span>}
    </span>
  );
  if (!editable) return pills;
  return (
    <Dropdown
      width={280}
      trigger={(p) => (
        <button ref={p.ref} onClick={p.onClick} className="focus-ring flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md px-2 py-1 text-left hover:bg-wash">
          {shown.length ? pills : <span className="flex items-center gap-1.5 text-[12.5px] text-faint"><Tag size={13} /> Add label</span>}
        </button>
      )}
    >
      {() => <IssuePicker kind="labels" issueIds={[issue.id]} onDone={() => {}} />}
    </Dropdown>
  );
}

