"use client";
/* ─── Locus · filters: Filter button (field → values), active filter bar, save as view ─── */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookmarkPlus, CalendarDays, ChevronLeft, CircleDashed, CircleSlash, Hexagon, ListFilter, RefreshCw, SignalHigh, Tag,
  Triangle, UserRound, UserRoundPen, Users, X,
} from "lucide-react";
import { useSync, uuid } from "@/lib/sync/store";
import { ui, useUI } from "@/lib/ui";
import {
  ESTIMATES, PRIORITY_LABEL, STATE_TYPES, STATE_TYPE_COLOR, STATE_TYPE_LABEL, cycleName, cyclePhase, displayName, sortStates,
  todayISO, useLabels, useMeId, useMembers, useProjects, useTeams, type IssueQuery,
} from "@/lib/model";
import { createView } from "@/lib/sync/actions";
import { navigate } from "@/lib/router";
import { formatDate } from "@/lib/format";
import { Popover, anyOverlayOpen } from "@/components/primitives/overlay";
import { SelectMenu, type MenuItem } from "@/components/primitives/SelectMenu";
import { Button, Input } from "@/components/primitives/controls";
import { Avatar } from "@/components/primitives/Avatar";
import { LabelDot, PriorityIcon, ProjectIcon, StateIcon, TeamIcon } from "@/components/primitives/icons";
import { StateGlyph } from "@/components/pickers";
import { ToolbarButton, isTypingTarget, usePopoverFix } from "./shared";
import type { Filter, FilterField, Priority } from "@/lib/types";

/* ═══ field metadata ═══ */

const FIELD_META: Record<FilterField, { label: string; plural: string; icon: ReactNode }> = {
  status: { label: "Status", plural: "statuses", icon: <CircleDashed size={14} /> },
  state_type: { label: "Status", plural: "statuses", icon: <CircleDashed size={14} /> },
  assignee: { label: "Assignee", plural: "assignees", icon: <UserRound size={14} /> },
  creator: { label: "Creator", plural: "creators", icon: <UserRoundPen size={14} /> },
  priority: { label: "Priority", plural: "priorities", icon: <SignalHigh size={14} /> },
  label: { label: "Labels", plural: "labels", icon: <Tag size={14} /> },
  project: { label: "Project", plural: "projects", icon: <Hexagon size={14} /> },
  cycle: { label: "Cycle", plural: "cycles", icon: <RefreshCw size={13} /> },
  team: { label: "Team", plural: "teams", icon: <Users size={14} /> },
  estimate: { label: "Estimate", plural: "estimates", icon: <Triangle size={13} /> },
  due: { label: "Due date", plural: "due dates", icon: <CalendarDays size={14} /> },
};

/** the single team a view key belongs to: "team:<id>:<tab>", "cycle:<id>", "view:<id>" (team views) */
function useViewTeamId(viewKey: string): string | undefined {
  return useSync((s) => {
    const [kind, id] = viewKey.split(":");
    if (!id) return undefined;
    if (kind === "team") return id;
    if (kind === "cycle") return s.cycles[id]?.team_id;
    if (kind === "view") return s.views[id]?.team_id ?? undefined;
    return undefined;
  });
}

/* ═══ filter state helpers (ui.filters[viewKey]) ═══ */

const filtersOf = (viewKey: string) => useUI.getState().filters[viewKey] ?? [];

function toggleFilterValue(viewKey: string, field: FilterField, value: string, filterId?: string) {
  const list = filtersOf(viewKey);
  const existing = (filterId && list.find((f) => f.id === filterId)) || list.find((f) => f.field === field);
  if (!existing) {
    ui.setFilters(viewKey, [...list, { id: uuid(), field, op: "is", values: [value] }]);
    return;
  }
  const values = existing.values.includes(value) ? existing.values.filter((v) => v !== value) : [...existing.values, value];
  ui.setFilters(viewKey, values.length
    ? list.map((f) => (f.id === existing.id ? { ...f, values } : f))
    : list.filter((f) => f.id !== existing.id));
}

function patchFilter(viewKey: string, id: string, patch: Partial<Filter>) {
  ui.setFilters(viewKey, filtersOf(viewKey).map((f) => (f.id === id ? { ...f, ...patch } : f)));
}

function removeFilter(viewKey: string, id: string) {
  ui.setFilters(viewKey, filtersOf(viewKey).filter((f) => f.id !== id));
}

/* ═══ value options per field ═══ */

export function useFilterOptions(field: FilterField, teamId?: string): MenuItem[] {
  const statesMap = useSync((s) => s.workflow_states);
  const teamsMap = useSync((s) => s.teams);
  const cyclesMap = useSync((s) => s.cycles);
  const members = useMembers();
  const me = useMeId();
  const labels = useLabels(teamId);
  const projects = useProjects();
  const teams = useTeams();

  return useMemo((): MenuItem[] => {
    switch (field) {
      case "status": {
        const states = sortStates(Object.values(statesMap).filter((s) => !teamId || s.team_id === teamId));
        const multiTeam = !teamId && new Set(states.map((s) => s.team_id)).size > 1;
        const ordered = multiTeam
          ? [...states].sort((a, b) => (teamsMap[a.team_id]?.name ?? "").localeCompare(teamsMap[b.team_id]?.name ?? ""))
          : states;
        return ordered.map((s) => ({
          id: s.id, label: s.name, icon: <StateGlyph stateId={s.id} />, keywords: [s.type, STATE_TYPE_LABEL[s.type]],
          group: multiTeam ? teamsMap[s.team_id]?.name : undefined,
        }));
      }
      case "state_type":
        return STATE_TYPES.map((t) => ({ id: t, label: STATE_TYPE_LABEL[t], icon: <StateIcon type={t} color={STATE_TYPE_COLOR[t]} />, keywords: [t] }));
      case "assignee":
      case "creator": {
        const people: MenuItem[] = members.filter((p) => p.id !== me).map((p) => ({
          id: p.id, label: displayName(p), icon: <Avatar profile={p} size={16} />, keywords: [p.email, p.display_name],
        }));
        return [
          { id: "me", label: "Me", icon: <Avatar userId={me} size={16} />, keywords: ["myself", "mine"] },
          ...(field === "assignee" ? [{ id: "none", label: "No assignee", icon: <UserRound size={14} className="text-faint" />, keywords: ["unassigned"] }] : []),
          ...people,
        ];
      }
      case "priority":
        return ([1, 2, 3, 4, 0] as Priority[]).map((p) => ({ id: String(p), label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} className="text-dim" /> }));
      case "label":
        return [
          { id: "none", label: "No labels", icon: <Tag size={13} className="text-faint" /> },
          ...labels.map((l) => ({ id: l.id, label: l.name, icon: <LabelDot color={l.color} /> })),
        ];
      case "project":
        return [
          { id: "none", label: "No project", icon: <Hexagon size={14} className="text-faint" /> },
          ...projects.map((p) => ({ id: p.id, label: p.name, icon: <ProjectIcon icon={p.icon} color={p.color} /> })),
        ];
      case "cycle": {
        const today = todayISO();
        const cycles = Object.values(cyclesMap)
          .filter((c) => !teamId || c.team_id === teamId)
          .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
        return [
          { id: "current", label: "Current cycle", icon: <RefreshCw size={13} className="text-accent" />, keywords: ["active"] },
          { id: "none", label: "No cycle", icon: <CircleSlash size={14} className="text-faint" /> },
          ...cycles.map((c) => ({
            id: c.id,
            label: teamId ? cycleName(c) : `${teamsMap[c.team_id]?.key ?? ""} · ${cycleName(c)}`,
            icon: <RefreshCw size={13} className="text-dim" />,
            hint: cyclePhase(c, today) === "current" ? "Current" : formatDate(c.starts_at),
          })),
        ];
      }
      case "team":
        return teams.map((t) => ({ id: t.id, label: t.name, icon: <TeamIcon team={t} size={16} />, hint: t.key, keywords: [t.key] }));
      case "estimate":
        return [
          { id: "none", label: "No estimate", icon: <Triangle size={13} className="text-faint" /> },
          ...ESTIMATES.map((e) => ({ id: String(e), label: `${e} point${e === 1 ? "" : "s"}`, icon: <Triangle size={13} className="text-dim" /> })),
        ];
      case "due":
        return [
          { id: "overdue", label: "Overdue", icon: <CalendarDays size={14} className="text-danger" /> },
          { id: "today", label: "Due today", icon: <CalendarDays size={14} className="text-warning" /> },
          { id: "week", label: "Due within a week", icon: <CalendarDays size={14} className="text-dim" /> },
          { id: "none", label: "No due date", icon: <CalendarDays size={14} className="text-faint" /> },
        ];
    }
  }, [field, teamId, statesMap, teamsMap, cyclesMap, members, me, labels, projects, teams]);
}

/* ═══ Filter button ═══ */

export function FilterButton({ viewKey, teamId }: { viewKey: string; teamId?: string }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<FilterField | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const filters = useUI((u) => u.filters[viewKey]);
  const cyclesOn = useSync((s) => (teamId ? Boolean(s.teams[teamId]?.cycles_enabled) : true));
  usePopoverFix(open, menuRef, true);

  const close = useCallback(() => { setOpen(false); setField(null); }, []);

  // F opens the filter menu while this view is mounted
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "f" && e.key !== "F") return;
      if (isTypingTarget(e.target) || anyOverlayOpen()) return;
      e.preventDefault();
      setField(null);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fieldItems = useMemo((): MenuItem[] => {
    const fields: FilterField[] = [
      teamId ? "status" : "state_type", "assignee", "creator", "priority", "label", "project",
      ...(cyclesOn ? (["cycle"] as const) : []),
      ...(teamId ? [] : (["team"] as const)),
      "estimate", "due",
    ];
    return fields.map((f) => {
      const n = filters?.find((x) => x.field === f)?.values.length ?? 0;
      return { id: f, label: FIELD_META[f].label, icon: <span className="text-dim">{FIELD_META[f].icon}</span>, hint: n ? `${n} selected` : undefined };
    });
  }, [teamId, cyclesOn, filters]);

  const count = filters?.length ?? 0;
  return (
    <>
      <ToolbarButton
        ref={setAnchor}
        icon={<ListFilter size={14} />}
        label={count ? `Filter · ${count}` : "Filter"}
        active={open || count > 0}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Filter (F)"
        onClick={() => { setField(null); setOpen((o) => !o); }}
      />
      <Popover open={open} onClose={close} anchor={anchor} align="end" width={field ? 280 : 248}>
        <div ref={menuRef}>
          {field ? (
            <FieldValues viewKey={viewKey} field={field} teamId={teamId} onBack={() => setField(null)} />
          ) : (
            <SelectMenu items={fieldItems} onSelect={(f) => setField(f as FilterField)} placeholder="Filter by…" />
          )}
        </div>
      </Popover>
    </>
  );
}

function FieldValues({ viewKey, field, teamId, onBack }: { viewKey: string; field: FilterField; teamId?: string; onBack: () => void }) {
  const items = useFilterOptions(field, teamId);
  const filters = useUI((u) => u.filters[viewKey]);
  const current = filters?.find((f) => f.field === field);
  const meta = FIELD_META[field];
  return (
    <div
      onKeyDown={(e) => {
        const t = e.target as HTMLInputElement;
        if (e.key === "Backspace" && t.tagName === "INPUT" && !t.value) { e.preventDefault(); onBack(); }
      }}
    >
      <button
        type="button"
        onClick={onBack}
        className="flex h-8 w-full items-center gap-1 border-b border-line px-2 text-xxs font-medium text-faint transition-colors hover:bg-wash hover:text-ink"
      >
        <ChevronLeft size={13} />
        {meta.label}
        {current?.op === "is_not" && <span className="ml-auto rounded bg-wash px-1.5 py-0.5 text-[10.5px]">is not</span>}
      </button>
      <SelectMenu
        multi
        items={items}
        selected={current?.values ?? []}
        onSelect={(v) => toggleFilterValue(viewKey, field, v, current?.id)}
        placeholder={`Filter by ${meta.label.toLowerCase()}…`}
        digitShortcuts={false}
      />
    </div>
  );
}

/* ═══ active filter bar ═══ */

export function FilterBar({ viewKey, query }: { viewKey: string; query: IssueQuery }) {
  const filters = useUI((u) => u.filters[viewKey]);
  const teamId = useViewTeamId(viewKey);
  if (!filters?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2 md:px-4">
      {filters.map((f) => <FilterChip key={f.id} viewKey={viewKey} filter={f} teamId={teamId} />)}
      <button
        type="button"
        onClick={() => ui.setFilters(viewKey, [])}
        className="focus-ring h-8 rounded-md px-2 text-[12.5px] text-faint transition-colors hover:bg-wash hover:text-ink sm:h-7"
      >
        Clear
      </button>
      {!viewKey.startsWith("view:") && viewScope(viewKey) && (
        <>
          <span className="flex-1" />
          <SaveViewButton viewKey={viewKey} query={query} />
        </>
      )}
    </div>
  );
}

function summarize(filter: Filter, items: MenuItem[]): { text: string; icons: ReactNode[] } {
  const known = filter.values.map((v) => items.find((i) => i.id === v)).filter((x): x is MenuItem => Boolean(x));
  const icons = known.slice(0, 3).map((i) => i.icon);
  const all = known.length === filter.values.length;
  if (all && known.length === 1) return { text: known[0].label, icons };
  if (all && known.length === 2 && known[0].label.length + known[1].label.length <= 24) {
    return { text: `${known[0].label}, ${known[1].label}`, icons };
  }
  return { text: `${filter.values.length} ${FIELD_META[filter.field].plural}`, icons };
}

function FilterChip({ viewKey, filter, teamId }: { viewKey: string; filter: Filter; teamId?: string }) {
  // status filters outside a team view take their options from the team of the chosen states
  const statusTeam = useSync((s) => (filter.field === "status" && filter.values[0] ? s.workflow_states[filter.values[0]]?.team_id : undefined));
  const items = useFilterOptions(filter.field, teamId ?? statusTeam);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  usePopoverFix(open, menuRef, true);
  const close = useCallback(() => setOpen(false), []);

  const meta = FIELD_META[filter.field];
  const { text, icons } = summarize(filter, items);
  const many = filter.values.length > 1;
  const op = filter.op === "is" ? (many ? "is any of" : "is") : many ? "is none of" : "is not";
  const seg = "focus-ring flex items-center border-l border-line transition-colors hover:bg-wash";

  return (
    <div className="inline-flex h-8 max-w-full items-stretch overflow-hidden rounded-md border border-line-strong bg-surface text-[12.5px] shadow-card sm:h-7">
      <span className="flex shrink-0 items-center gap-1.5 pl-2 pr-2 text-dim">
        <span className="text-faint">{meta.icon}</span>
        {meta.label}
      </span>
      <button
        type="button"
        onClick={() => patchFilter(viewKey, filter.id, { op: filter.op === "is" ? "is_not" : "is" })}
        title={filter.op === "is" ? "Switch to “is not”" : "Switch to “is”"}
        className={`${seg} shrink-0 px-2 text-faint hover:text-ink`}
      >
        {op}
      </button>
      <button
        ref={setAnchor}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={`${seg} min-w-0 gap-1.5 px-2 font-medium text-ink`}
      >
        {icons.length > 0 && (
          <span className="flex shrink-0 items-center -space-x-1">
            {icons.map((icon, i) => <span key={i} className="flex rounded-full bg-surface">{icon}</span>)}
          </span>
        )}
        <span className="truncate">{text}</span>
      </button>
      <button
        type="button"
        onClick={() => removeFilter(viewKey, filter.id)}
        aria-label={`Remove ${meta.label} filter`}
        className={`${seg} w-8 shrink-0 justify-center text-faint hover:text-ink sm:w-7`}
      >
        <X size={13} />
      </button>
      <Popover open={open} onClose={close} anchor={anchor} width={280}>
        <div ref={menuRef}>
          <SelectMenu
            multi
            items={items}
            selected={filter.values}
            onSelect={(v) => toggleFilterValue(viewKey, filter.field, v, filter.id)}
            placeholder={`Filter by ${meta.label.toLowerCase()}…`}
            digitShortcuts={false}
          />
        </div>
      </Popover>
    </div>
  );
}

/* ═══ save the current filters + display as a view ═══ */

/**
 * Filters that reproduce a view's scope inside a saved view (the team tabs' Active/Backlog
 * scopes already travel as base filters in query.filters). null = the scope can't be
 * expressed as filters (e.g. "Subscribed"), so saving would silently broaden the view.
 */
function viewScope(viewKey: string): Filter[] | null {
  const [kind, id] = viewKey.split(":");
  switch (kind) {
    case "project": return id ? [{ id: "scope", field: "project", op: "is", values: [id] }] : [];
    case "cycle": return id ? [{ id: "scope", field: "cycle", op: "is", values: [id] }] : [];
    case "my":
      if (id === "assigned") return [{ id: "scope", field: "assignee", op: "is", values: ["me"] }];
      if (id === "created") return [{ id: "scope", field: "creator", op: "is", values: ["me"] }];
      return null;
    default: return [];
  }
}

function SaveViewButton({ viewKey, query }: { viewKey: string; query: IssueQuery }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const teamId = useViewTeamId(viewKey);
  const teamName = useSync((s) => (teamId ? s.teams[teamId]?.name : undefined));
  usePopoverFix(open, inputRef, true);
  const close = useCallback(() => { setOpen(false); setName(""); }, []);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const view = await createView({
      name: trimmed,
      // fresh ids: base filters carry fixed ids that must not collide inside the saved view
      filters: [...(viewScope(viewKey) ?? []), ...query.filters].map((f) => ({ ...f, id: uuid() })),
      display: query.display,
      team_id: teamId ?? null,
    });
    setBusy(false);
    if (!view) return; // failure already toasted
    close();
    ui.setFilters(viewKey, []);
    navigate({ kind: "view", id: view.id });
  };

  return (
    <>
      <ToolbarButton ref={setAnchor} icon={<BookmarkPlus size={14} />} label="Save view" active={open} onClick={() => setOpen((o) => !o)} aria-expanded={open} />
      <Popover open={open} onClose={close} anchor={anchor} align="end" width={300}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="p-3">
          <div className="text-[13px] font-medium text-ink">Save as view</div>
          <p className="mb-2.5 mt-0.5 text-xxs text-faint">
            Keeps these filters and display options{teamName ? ` for ${teamName}` : ""}.
          </p>
          <Input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="View name" maxLength={80} aria-label="View name" />
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!name.trim()}>Save view</Button>
          </div>
        </form>
      </Popover>
    </>
  );
}
