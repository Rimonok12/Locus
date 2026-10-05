"use client";
/* ─── Locus · create issue modal (C) ─────────────────────────────────────────
   Title + rich description + property chips. The draft persists to localStorage
   while typing and comes back the next time the modal opens — wherever it is
   opened from, with that place's context (team, status, project, cycle…) applied
   on top. Openers that create something specific (a sub-issue, a prefilled
   title) start fresh and never overwrite a saved draft. "Create more" keeps the
   modal open with the same properties.
   ──────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Hexagon, ListTree, RefreshCw, Tag, Triangle, UserRound, X } from "lucide-react";
import { ui, useUI } from "@/lib/ui";
import { useSync } from "@/lib/sync/store";
import { navigate } from "@/lib/router";
import { cycleName, defaultStateFor, displayName, issueKey, PRIORITY_LABEL, useMyTeams, useTeams } from "@/lib/model";
import { createIssue } from "@/lib/sync/actions";
import { dueInfo } from "@/lib/format";
import { Dropdown, Modal } from "@/components/primitives/overlay";
import { Button, IconButton, Kbd, Switch } from "@/components/primitives/controls";
import { Avatar } from "@/components/primitives/Avatar";
import { LabelDot, PriorityIcon, ProjectIcon, TeamIcon } from "@/components/primitives/icons";
import {
  AssigneeMenu, CycleMenu, DueDateMenu, EstimateMenu, LabelsMenu, MilestoneMenu, ParentMenu, PriorityMenu, ProjectMenu,
  StateGlyph, StatusMenu, TeamMenu,
} from "@/components/pickers";
import Editor, { isEmptyHtml } from "@/components/editor/Editor";
import { keys } from "./commands";
import { useRestoreFocus } from "./useRestoreFocus";
import type { Issue, Priority } from "@/lib/types";

/* ═══ draft storage ═══ */

const DRAFT_KEY = "locus:issue-draft";
const CREATE_MORE_KEY = "locus:create-more";

interface Props {
  state_id: string | null;
  priority: Priority;
  assignee_id: string | null;
  label_ids: string[];
  project_id: string | null;
  milestone_id: string | null;
  cycle_id: string | null;
  estimate: number | null;
  due_date: string | null;
  parent_id: string | null;
}

interface Draft { team_id: string | null; title: string; description: string; props: Props }

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function propsFrom(src: Partial<Record<keyof Props, unknown>>): Props {
  const p = src.priority;
  return {
    state_id: str(src.state_id),
    priority: p === 0 || p === 1 || p === 2 || p === 3 || p === 4 ? p : 0,
    assignee_id: str(src.assignee_id),
    label_ids: Array.isArray(src.label_ids) ? src.label_ids.filter((x): x is string => typeof x === "string") : [],
    project_id: str(src.project_id),
    milestone_id: str(src.milestone_id),
    cycle_id: str(src.cycle_id),
    estimate: typeof src.estimate === "number" && Number.isFinite(src.estimate) ? src.estimate : null,
    due_date: typeof src.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(src.due_date) ? src.due_date : null,
    parent_id: str(src.parent_id),
  };
}

function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft> | null;
    if (!d || typeof d !== "object") return null;
    return {
      team_id: str(d.team_id),
      title: typeof d.title === "string" ? d.title : "",
      description: typeof d.description === "string" ? d.description : "",
      props: propsFrom((d.props ?? {}) as Partial<Record<keyof Props, unknown>>),
    };
  } catch {
    return null;
  }
}
function writeDraft(d: Draft) {
  try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
}
function clearDraft() {
  try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
}
const draftHasContent = (d: Pick<Draft, "title" | "description">) => Boolean(d.title.trim()) || !isEmptyHtml(d.description);

function readCreateMore(): boolean {
  try { return window.localStorage.getItem(CREATE_MORE_KEY) === "1"; } catch { return false; }
}

/* ═══ modal ═══ */

export default function CreateIssueModal() {
  const req = useUI((s) => s.createIssue);
  return (
    <Modal open={Boolean(req)} onClose={ui.closeCreateIssue} position="top" width={720} label="New issue">
      {req && <Composer key={JSON.stringify(req.defaults)} defaults={req.defaults} />}
    </Modal>
  );
}

const PROP_KEYS: (keyof Props)[] = [
  "state_id", "priority", "assignee_id", "label_ids", "project_id", "milestone_id", "cycle_id", "estimate", "due_date", "parent_id",
];

interface Init {
  /** the stored draft was restored into this composer */
  restored: boolean;
  /** this composer may write the draft slot (false when it would clobber someone else's saved draft) */
  persist: boolean;
  teamId: string | null;
  title: string;
  description: string;
  props: Props;
}

/** A fresh composer for these defaults (no draft involved). */
function freshState(defaults: Partial<Issue>): Pick<Init, "teamId" | "title" | "description" | "props"> {
  return {
    teamId: defaults.team_id ?? null,
    title: defaults.title ?? "",
    description: defaults.description ?? "",
    props: propsFrom(defaults),
  };
}

function initialState(defaults: Partial<Issue>): Init {
  // defaults that say *what* is being created (vs. where): the draft must not replace them
  const specific = Boolean(defaults.title || defaults.description || defaults.parent_id);
  const stored = readDraft();
  const draft = stored && draftHasContent(stored) ? stored : null;
  if (!draft) return { restored: false, persist: true, ...freshState(defaults) };
  if (specific) return { restored: false, persist: false, ...freshState(defaults) };
  // continue the draft here: the opener's context (team, status, project, cycle, assignee…) wins
  const context: Partial<Record<keyof Props, unknown>> = {};
  for (const k of PROP_KEYS) if (defaults[k] !== undefined) context[k] = defaults[k];
  return {
    restored: true,
    persist: true,
    teamId: defaults.team_id ?? draft.team_id,
    title: draft.title,
    description: draft.description,
    props: propsFrom({ ...draft.props, ...context }),
  };
}

function Composer({ defaults }: { defaults: Partial<Issue> }) {
  const [init] = useState(() => initialState(defaults));
  const [teamId, setTeamId] = useState<string | null>(init.teamId);
  const [title, setTitle] = useState(init.title);
  const [description, setDescription] = useState(init.description);
  const [props, setProps] = useState<Props>(init.props);
  const [editorKey, setEditorKey] = useState(0);
  const [createMore, setCreateMore] = useState(readCreateMore);
  const [restored, setRestored] = useState(init.restored);

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  /** this composer currently owns the stored draft (restored it or wrote it) */
  const ownsDraft = useRef(init.restored);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const leaving = useRef(false);
  useRestoreFocus(() => leaving.current);

  /* store reads */
  const teams = useSync((s) => s.teams);
  const states = useSync((s) => s.workflow_states);
  const labels = useSync((s) => s.labels);
  const projects = useSync((s) => s.projects);
  const milestones = useSync((s) => s.project_milestones);
  const cycles = useSync((s) => s.cycles);
  const parent = useSync((s) => (props.parent_id ? s.issues[props.parent_id] : undefined));
  const assignee = useSync((s) => (props.assignee_id ? s.profiles[props.assignee_id] : undefined));
  const myTeams = useMyTeams();
  const allTeams = useTeams();

  /* effective values (tolerate stale ids, ids from other teams, data still loading) */
  const chosen = teamId ? teams[teamId] : undefined;
  const team = (chosen && !chosen.archived_at ? chosen : undefined) ?? myTeams[0] ?? allTeams[0];
  const stateId = team
    ? (props.state_id && states[props.state_id]?.team_id === team.id ? props.state_id : defaultStateFor(team.id, states)?.id ?? null)
    : null;
  const state = stateId ? states[stateId] : undefined;
  const labelIds = props.label_ids.filter((id) => labels[id] && (!labels[id].team_id || labels[id].team_id === team?.id));
  const project = props.project_id ? projects[props.project_id] : undefined;
  const milestone = project && props.milestone_id && milestones[props.milestone_id]?.project_id === project.id ? milestones[props.milestone_id] : undefined;
  const cycle = team?.cycles_enabled && props.cycle_id && cycles[props.cycle_id]?.team_id === team.id ? cycles[props.cycle_id] : undefined;
  const due = dueInfo(props.due_date);

  /* persist the draft while the user works */
  useEffect(() => {
    if (!dirty.current || !init.persist) return;
    const d: Draft = { team_id: teamId, title, description, props };
    if (!draftHasContent(d)) {
      if (ownsDraft.current) { clearDraft(); ownsDraft.current = false; }
      return;
    }
    writeDraft(d);
    ownsDraft.current = true;
  }, [init.persist, teamId, title, description, props]);

  /* focus the title with the caret at the end */
  useEffect(() => {
    mounted.current = true;
    const el = titleRef.current;
    if (el) {
      el.focus();
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch { /* not a text input */ }
    }
    return () => { mounted.current = false; };
  }, []);

  const patch = (p: Partial<Props>) => { dirty.current = true; setProps((cur) => ({ ...cur, ...p })); };
  const onTitle = (v: string) => { dirty.current = true; setTitle(v); };
  const onDescription = useCallback((html: string) => { dirty.current = true; setDescription(html); }, []);

  const changeTeam = (id: string) => {
    if (id === team?.id) return;
    dirty.current = true;
    setTeamId(id);
    const all = useSync.getState().labels;
    setProps((cur) => ({
      ...cur,
      state_id: null,
      cycle_id: null,
      label_ids: cur.label_ids.filter((l) => all[l] && (!all[l].team_id || all[l].team_id === id)),
    }));
  };

  const toggleLabel = (id: string) => {
    dirty.current = true;
    setProps((cur) => ({ ...cur, label_ids: cur.label_ids.includes(id) ? cur.label_ids.filter((l) => l !== id) : [...cur.label_ids, id] }));
  };

  const toggleCreateMore = (v: boolean) => {
    setCreateMore(v);
    try { window.localStorage.setItem(CREATE_MORE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  };

  /** throw the restored draft away and start over from this opener's defaults */
  const discardDraft = () => {
    if (ownsDraft.current) clearDraft();
    ownsDraft.current = false;
    dirty.current = false;
    const fresh = freshState(defaults);
    setTeamId(fresh.teamId);
    setTitle(fresh.title);
    setDescription(fresh.description);
    setProps(fresh.props);
    setEditorKey((k) => k + 1);
    setRestored(false);
    titleRef.current?.focus();
  };

  const focusDescription = () => {
    const el = descRef.current?.querySelector<HTMLElement>("[contenteditable='true'], textarea");
    el?.focus();
  };

  const submit = () => {
    const t = title.trim();
    if (!t || !team) { titleRef.current?.focus(); return; }
    if (submitting.current) return;
    submitting.current = true;
    setTimeout(() => { submitting.current = false; }, 0);

    const snapshot: Draft = { team_id: team.id, title, description, props };
    const payload = {
      team_id: team.id,
      title: t,
      ...(isEmptyHtml(description) ? {} : { description }),
      ...(stateId ? { state_id: stateId } : {}),
      priority: props.priority,
      assignee_id: assignee ? props.assignee_id : null,
      label_ids: labelIds,
      project_id: project ? project.id : null,
      milestone_id: milestone ? milestone.id : null,
      cycle_id: cycle ? cycle.id : null,
      estimate: props.estimate,
      due_date: props.due_date,
      parent_id: parent ? parent.id : null,
    };

    if (createMore) {
      dirty.current = true;
      setTitle("");
      setDescription("");
      setEditorKey((k) => k + 1);
      requestAnimationFrame(() => titleRef.current?.focus());
    } else {
      if (ownsDraft.current) clearDraft();
      ownsDraft.current = false;
      ui.closeCreateIssue();
    }

    createIssue(payload).then((issue) => {
      if (issue) {
        const stored = readDraft();
        if (init.persist && stored && stored.title === snapshot.title && stored.description === snapshot.description) clearDraft();
        return;
      }
      // failed (already toasted): give the text back so nothing is lost
      if (mounted.current && !titleRef.current?.value) {
        dirty.current = true;
        setTitle(snapshot.title);
        setDescription(snapshot.description);
        setEditorKey((k) => k + 1);
      } else if (!readDraft()) {
        writeDraft(snapshot);
      }
    });
  };

  /* the editor may keep the first callback it receives — always route to the latest submit */
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const onEditorSubmit = useCallback(() => submitRef.current(), []);

  if (!team) {
    return (
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Create a team first</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-dim">Issues belong to a team. Create or join one to start tracking work.</p>
          </div>
          <IconButton label="Close" size={32} onClick={ui.closeCreateIssue}><X size={15} /></IconButton>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={ui.closeCreateIssue}>Cancel</Button>
          <Button variant="primary" autoFocus onClick={() => { leaving.current = true; ui.closeCreateIssue(); navigate({ kind: "settings", section: "teams" }); }}>Go to teams</Button>
        </div>
      </div>
    );
  }

  const mod = keys.mod();
  const showDiscard = restored && draftHasContent({ title, description });

  return (
    <div
      className="flex max-h-[min(760px,82dvh)] flex-col"
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.defaultPrevented) return;
        if (descRef.current?.contains(e.target as Node)) return; // the editor submits itself
        e.preventDefault();
        submit();
      }}
    >
      {/* top bar */}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-3 sm:px-4">
        <Dropdown
          width={260}
          trigger={(p) => (
            <button
              type="button"
              ref={p.ref}
              onClick={p.onClick}
              aria-expanded={p["aria-expanded"]}
              aria-label="Team"
              className={`focus-ring inline-flex h-8 max-w-[200px] items-center gap-1.5 rounded-md border border-line-strong px-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-wash sm:h-7 ${p.open ? "bg-wash" : ""}`}
            >
              <TeamIcon team={team} size={16} />
              <span className="truncate">{team.key}</span>
              <ChevronDown size={12} className="shrink-0 text-faint" />
            </button>
          )}
        >
          {(close) => <TeamMenu value={team.id} onChange={(id) => { changeTeam(id); close(); }} />}
        </Dropdown>
        <ChevronRight size={13} className="shrink-0 text-faint" />
        <span className="min-w-0 truncate text-[13px] text-dim">{parent ? <>New sub-issue of <span className="text-ink">{issueKey(parent, teams)}</span></> : "New issue"}</span>
        {showDiscard && (
          <button
            type="button"
            onClick={discardDraft}
            title="Discard the saved draft and start over"
            className="focus-ring ml-auto h-8 shrink-0 rounded-md px-2 text-[12px] text-faint transition-colors hover:bg-wash hover:text-ink sm:h-7"
          >
            Discard draft
          </button>
        )}
        <IconButton label="Close" className={showDiscard ? "" : "ml-auto"} size={32} onClick={ui.closeCreateIssue}><X size={15} /></IconButton>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-3 sm:px-5">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (e.metaKey || e.ctrlKey) submit();
            else focusDescription();
          }}
          placeholder="Issue title"
          aria-label="Issue title"
          className="w-full bg-transparent text-[18px] font-medium leading-7 text-ink outline-none placeholder:text-faint"
        />
        <div ref={descRef} className="mt-2">
          <Editor
            key={editorKey}
            value={description}
            onChange={onDescription}
            onSubmit={onEditorSubmit}
            placeholder="Add description…"
            minHeight={96}
          />
        </div>
      </div>

      {/* properties */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-3 pt-1 sm:px-4">
        <Chip title="Change status" icon={<StateGlyph stateId={stateId} />} label={state?.name ?? "Status"} empty={!state}>
          {(close) => <StatusMenu teamId={team.id} value={stateId} onChange={(id) => { patch({ state_id: id }); close(); }} />}
        </Chip>
        <Chip
          title="Set priority"
          icon={<PriorityIcon priority={props.priority} className={props.priority ? "text-dim" : "text-faint"} />}
          label={props.priority ? PRIORITY_LABEL[props.priority] : "Priority"}
          empty={!props.priority}
        >
          {(close) => <PriorityMenu value={props.priority} onChange={(p) => { patch({ priority: p }); close(); }} />}
        </Chip>
        <Chip
          title="Assign to"
          icon={assignee ? <Avatar profile={assignee} size={16} /> : <UserRound size={14} />}
          label={assignee ? displayName(assignee) : "Assignee"}
          empty={!assignee}
        >
          {(close) => <AssigneeMenu value={assignee ? assignee.id : null} onChange={(u) => { patch({ assignee_id: u }); close(); }} />}
        </Chip>
        <Chip
          title="Change labels"
          icon={labelIds.length ? null : <Tag size={13} />}
          label={labelIds.length ? <LabelPills ids={labelIds} /> : "Labels"}
          empty={!labelIds.length}
          wide
        >
          {() => <LabelsMenu teamId={team.id} value={labelIds} onToggle={toggleLabel} />}
        </Chip>
        <Chip
          title="Add to project"
          icon={project ? <ProjectIcon icon={project.icon} color={project.color} /> : <Hexagon size={14} />}
          label={project?.name ?? "Project"}
          empty={!project}
        >
          {(close) => (
            <ProjectMenu
              value={project ? project.id : null}
              onChange={(id) => { patch({ project_id: id, ...(id !== props.project_id ? { milestone_id: null } : {}) }); close(); }}
            />
          )}
        </Chip>
        {project && (
          <Chip title="Set milestone" icon={<Triangle size={13} />} label={milestone?.name ?? "Milestone"} empty={!milestone}>
            {(close) => <MilestoneMenu projectId={project.id} value={milestone ? milestone.id : null} onChange={(id) => { patch({ milestone_id: id }); close(); }} />}
          </Chip>
        )}
        {team.cycles_enabled && (
          <Chip title="Add to cycle" icon={<RefreshCw size={13} />} label={cycle ? cycleName(cycle) : "Cycle"} empty={!cycle}>
            {(close) => <CycleMenu teamId={team.id} value={cycle ? cycle.id : null} onChange={(id) => { patch({ cycle_id: id }); close(); }} />}
          </Chip>
        )}
        <Chip
          title="Set estimate"
          icon={<Triangle size={13} />}
          label={props.estimate != null ? `${props.estimate} point${props.estimate === 1 ? "" : "s"}` : "Estimate"}
          empty={props.estimate == null}
        >
          {(close) => <EstimateMenu value={props.estimate} onChange={(v) => { patch({ estimate: v }); close(); }} />}
        </Chip>
        <Chip
          title="Set due date"
          icon={<CalendarDays size={13} className={due?.tone === "overdue" ? "text-danger" : undefined} />}
          label={due ? due.label : "Due date"}
          empty={!due}
          width={260}
        >
          {(close) => <DueDateMenu value={props.due_date} onChange={(d) => { patch({ due_date: d }); close(); }} />}
        </Chip>
        <Chip
          title="Set parent issue"
          icon={parent ? <StateGlyph stateId={parent.state_id} /> : <ListTree size={14} />}
          label={parent ? issueKey(parent, teams) : "Parent"}
          empty={!parent}
          width={340}
        >
          {(close) => (
            <ParentMenu
              issue={{ id: "", parent_id: parent ? parent.id : null, team_id: team.id }}
              onChange={(id) => { patch({ parent_id: id }); close(); }}
            />
          )}
        </Chip>
      </div>

      {/* footer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5 sm:px-4">
        <label className="flex cursor-pointer select-none items-center gap-2 py-1 text-[12.5px] text-dim">
          <Switch checked={createMore} onChange={toggleCreateMore} label="Create more" />
          Create more
        </label>
        <span className="ml-auto hidden items-center gap-1 text-xxs text-faint md:flex">
          <Kbd>{mod}</Kbd><Kbd>{keys.enter}</Kbd><span className="ml-0.5">to create</span>
        </span>
        <Button variant="ghost" className="ml-auto h-8 md:ml-2 md:h-7" onClick={ui.closeCreateIssue}>Cancel</Button>
        <Button variant="primary" className="h-8 md:h-7" disabled={!title.trim()} onClick={submit}>Create issue</Button>
      </div>
    </div>
  );
}

/* ═══ property chip ═══ */

function Chip({
  title, icon, label, empty, width = 280, wide, children,
}: {
  title: string;
  icon: ReactNode;
  label: ReactNode;
  empty?: boolean;
  width?: number;
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <Dropdown
      width={width}
      trigger={(p) => (
        <button
          type="button"
          ref={p.ref}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-label={title}
          title={title}
          className={`focus-ring inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-line-strong px-2 text-[12.5px] transition-colors hover:bg-wash sm:h-7 ${
            wide ? "max-w-full" : "max-w-[200px]"
          } ${empty ? "text-faint" : "text-ink"} ${p.open ? "bg-wash" : ""}`}
        >
          {icon && <span className="flex shrink-0 items-center">{icon}</span>}
          {typeof label === "string" ? <span className="truncate">{label}</span> : label}
        </button>
      )}
    >
      {children}
    </Dropdown>
  );
}

function LabelPills({ ids }: { ids: string[] }) {
  const labels = useSync((s) => s.labels);
  const shown = ids.slice(0, 3).map((id) => labels[id]).filter(Boolean);
  return (
    <span className="flex min-w-0 items-center gap-1">
      {shown.map((l) => (
        <span key={l.id} className="inline-flex h-5 min-w-0 max-w-[120px] items-center gap-1 rounded-full bg-wash px-1.5 text-xxs font-medium text-dim">
          <LabelDot color={l.color} size={7} />
          <span className="truncate">{l.name}</span>
        </span>
      ))}
      {ids.length > 3 && <span className="shrink-0 text-xxs text-faint">+{ids.length - 3}</span>}
    </span>
  );
}
