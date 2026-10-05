"use client";
/* ─── Locus · projects list (workspace-wide, or one team's projects) ─── */

import { useEffect, useMemo, useState } from "react";
import { Check, Hexagon, Plus, SlidersHorizontal } from "lucide-react";
import { PRIORITY_RANK, useProjects } from "@/lib/model";
import { setQueryParam, useQueryParam, type ProjectsTab } from "@/lib/router";
import { ViewHeader, HeaderTab } from "@/components/app/Header";
import NotFound from "@/components/app/NotFound";
import { Button, EmptyState, IconButton, Switch } from "@/components/primitives/controls";
import { Dropdown } from "@/components/primitives/overlay";
import { TeamIcon } from "@/components/primitives/icons";
import { useRoutedTeam } from "@/components/issues/shared";
import CreateProjectModal from "@/components/projects/CreateProjectModal";
import ProjectsTable from "@/components/projects/ProjectsTable";
import { useProjectStats, type Progress } from "@/components/projects/shared";
import type { Project, ProjectStatus, Team } from "@/lib/types";

const TABS: { value: ProjectsTab; label: string; match: (p: Project) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "started", label: "In progress", match: (p) => p.status === "started" },
  { value: "planned", label: "Planned", match: (p) => p.status === "planned" },
  { value: "backlog", label: "Backlog", match: (p) => p.status === "backlog" },
  { value: "completed", label: "Completed", match: (p) => p.status === "completed" || p.status === "canceled" },
];

type Ordering = "default" | "name" | "status" | "priority" | "target" | "progress" | "created" | "updated";
const ORDERINGS: { value: Ordering; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "name", label: "Name" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "target", label: "Target date" },
  { value: "progress", label: "Progress" },
  { value: "created", label: "Created" },
  { value: "updated", label: "Last updated" },
];
const STATUS_RANK: Record<ProjectStatus, number> = { started: 0, paused: 1, planned: 2, backlog: 3, completed: 4, canceled: 5 };
const PREFS_KEY = "locus:projects-list";

interface Prefs { ordering: Ordering; archived: boolean }

function sortProjects(list: Project[], ordering: Ordering, progress: Record<string, Progress>): Project[] {
  if (ordering === "default") return list;
  const byName = (a: Project, b: Project) => a.name.localeCompare(b.name);
  const cmp: Record<Exclude<Ordering, "default">, (a: Project, b: Project) => number> = {
    name: byName,
    status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byName(a, b),
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byName(a, b),
    target: (a, b) => (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999") || byName(a, b),
    progress: (a, b) => (progress[b.id]?.ratio ?? 0) - (progress[a.id]?.ratio ?? 0) || byName(a, b),
    created: (a, b) => b.created_at.localeCompare(a.created_at),
    updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
  };
  return [...list].sort(cmp[ordering]);
}

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const v = (raw ? JSON.parse(raw) : {}) as Partial<Prefs>;
    return {
      ordering: ORDERINGS.some((o) => o.value === v.ordering) ? (v.ordering as Ordering) : "default",
      archived: Boolean(v.archived),
    };
  } catch {
    return { ordering: "default", archived: false };
  }
}

export default function ProjectsView({ tab, teamKey }: { tab: "all" | "started" | "planned" | "backlog" | "completed"; teamKey?: string }) {
  // pinned by id: a teammate renaming the team key moves the URL along instead of showing "not found"
  const team = useRoutedTeam(teamKey, (key) => ({ kind: "team-projects", key }));
  if (teamKey && !team) return <NotFound what="team" />;
  return <ProjectsList key={team?.id ?? "workspace"} routeTab={tab} team={team} />;
}

function ProjectsList({ routeTab, team }: { routeTab: ProjectsTab; team?: Team }) {
  const [localTab, setLocalTab] = useState<ProjectsTab>("all");
  const tab = team ? localTab : routeTab;
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [createOpen, setCreateOpen] = useState(false);

  // ?create=1 (command palette, deep links) opens the create modal once
  const createParam = useQueryParam("create");
  useEffect(() => {
    if (!createParam) return;
    setCreateOpen(true);
    setQueryParam("create", null);
  }, [createParam]);

  const updatePrefs = (patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const all = useProjects(true);
  const { progress, issueTeams } = useProjectStats();

  const scoped = useMemo(
    () => all.filter((p) =>
      (prefs.archived || !p.archived_at)
      && (!team || p.team_ids.includes(team.id) || Boolean(issueTeams[p.id]?.has(team.id)))),
    [all, prefs.archived, team, issueTeams],
  );
  const counts = useMemo(() => {
    const c = {} as Record<ProjectsTab, number>;
    for (const t of TABS) c[t.value] = scoped.filter(t.match).length;
    return c;
  }, [scoped]);
  const visible = useMemo(() => {
    const match = TABS.find((t) => t.value === tab)?.match ?? (() => true);
    return sortProjects(scoped.filter(match), prefs.ordering, progress);
  }, [scoped, tab, prefs.ordering, progress]);

  const openCreate = () => setCreateOpen(true);
  const tabLabel = TABS.find((t) => t.value === tab)?.label ?? "All";

  return (
    <>
      <ViewHeader
        crumbs={team ? [{ label: team.name, icon: <TeamIcon team={team} size={16} />, to: { kind: "team", key: team.key, tab: "all" } }] : undefined}
        icon={team ? undefined : <Hexagon size={15} className="text-dim" />}
        title="Projects"
        tabs={TABS.map((t) => (
          <HeaderTab
            key={t.value}
            active={tab === t.value}
            to={team ? undefined : { kind: "projects", tab: t.value }}
            onClick={team ? () => setLocalTab(t.value) : undefined}
          >
            {t.label}
            {counts[t.value] > 0 && <span className="text-xxs tabular-nums text-faint">{counts[t.value]}</span>}
          </HeaderTab>
        ))}
        actions={
          <>
            <Dropdown
              width={240}
              align="end"
              trigger={(p) => (
                <IconButton ref={p.ref} onClick={p.onClick} aria-expanded={p["aria-expanded"]} active={p.open} label="Display options" size={32}>
                  <SlidersHorizontal size={15} />
                </IconButton>
              )}
            >
              {() => (
                <div className="p-1">
                  <div className="px-2 pb-1 pt-1.5 text-xxs font-medium text-faint">Ordering</div>
                  {ORDERINGS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => updatePrefs({ ordering: o.value })}
                      className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[13px] text-ink hover:bg-wash"
                    >
                      {o.label}
                      {prefs.ordering === o.value && <Check size={14} className="text-dim" />}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-line" />
                  <div
                    onClick={() => updatePrefs({ archived: !prefs.archived })}
                    className="flex h-9 cursor-pointer select-none items-center justify-between rounded-md px-2 text-[13px] text-ink hover:bg-wash"
                  >
                    Show archived
                    <Switch checked={prefs.archived} onChange={(v) => updatePrefs({ archived: v })} label="Show archived projects" />
                  </div>
                </div>
              )}
            </Dropdown>
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate} aria-label="New project" className="h-8 sm:h-7">
              <span className="hidden sm:inline">New project</span>
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length ? (
          <ProjectsTable projects={visible} progress={progress} />
        ) : scoped.length ? (
          <EmptyState
            icon={<Hexagon size={28} strokeWidth={1.5} />}
            title={tab === "completed" ? "No completed projects" : `No ${tabLabel.toLowerCase()} projects`}
            body={
              tab === "started"
                ? "Projects show up here once their status is In Progress."
                : tab === "completed"
                  ? "Completed and canceled projects are collected here."
                  : `There are no projects with this status${team ? ` in ${team.name}` : ""}.`
            }
            action={<Button variant="secondary" icon={<Plus size={14} />} onClick={openCreate}>Create project</Button>}
          />
        ) : (
          <EmptyState
            icon={<Hexagon size={32} strokeWidth={1.5} />}
            title={team ? `${team.name} has no projects yet` : "No projects yet"}
            body="Projects group issues toward a shared goal, with a lead, a target date and progress that updates in real time."
            action={<Button variant="primary" icon={<Plus size={14} />} onClick={openCreate}>Create project</Button>}
          />
        )}
      </div>

      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} defaultTeamId={team?.id} />
    </>
  );
}
