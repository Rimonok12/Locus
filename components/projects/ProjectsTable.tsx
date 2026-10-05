"use client";
/* ─── Locus · projects table ─────────────────────────────────────────────────
   Dense rows (name · health · priority · lead · target · status · progress ·
   teams) with inline editing, a right-click menu and J/K keyboard navigation.
   Each row is a stretched link, so cmd/ctrl-click opens a new tab.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, CalendarDays } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { useUI } from "@/lib/ui";
import { HEALTH_LABEL, PRIORITY_LABEL, PROJECT_STATUS_LABEL, displayName } from "@/lib/model";
import { updateProject } from "@/lib/sync/actions";
import { linkProps, navigate } from "@/lib/router";
import { formatDate, localToday } from "@/lib/format";
import { Dropdown, Popover, anyOverlayOpen } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import { Avatar } from "@/components/primitives/Avatar";
import { HealthDot, PriorityIcon, ProgressRing, ProjectIcon, ProjectStatusIcon, TeamIcon } from "@/components/primitives/icons";
import { PriorityMenu } from "@/components/pickers";
import { DateMenu, LeadMenu, ProjectStatusMenu } from "./menus";
import { projectActionItems } from "./projectActions";
import { isClosed, isTypingTarget, pct, type Progress } from "./shared";
import type { Project } from "@/lib/types";

/* column widths are shared by the header and every row.
   Breakpoints are viewport-based and the 240px sidebar appears at md, so the
   secondary columns come in late enough to always leave the name ≥ ~150px. */
const COL = {
  health: "hidden w-[124px] xl:flex",
  priority: "hidden w-[56px] justify-center lg:flex",
  lead: "hidden w-[52px] justify-center lg:flex",
  target: "hidden w-[96px] sm:flex",
  status: "flex w-9 sm:w-[128px]",
  progress: "flex w-[60px] sm:w-[72px]",
  teams: "hidden w-[76px] xl:flex",
};

/** app-level overlays requested but not yet mounted as a Modal, plus the issue peek panel
 *  (anyOverlayOpen() already covers open popovers, modals and the mobile nav drawer) */
const uiOverlayOpen = () => {
  const u = useUI.getState();
  return Boolean(u.paletteOpen || u.createIssue || u.picker || u.shortcutsOpen || u.confirm || u.peekIssueId);
};

const cellBtn =
  "focus-ring relative z-[1] inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-[12.5px] transition-colors hover:border-line-strong hover:bg-surface";

export default function ProjectsTable({ projects, progress }: { projects: Project[]; progress: Record<string, Progress> }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const favorites = useSync((s) => s.favorites);
  const me = useSync((s) => s.userId);
  const menuProject = useSync((s) => (menu ? s.projects[menu.id] : undefined));
  const updates = useSync((s) => s.project_updates);
  const withUpdates = useMemo(() => new Set(Object.values(updates).map((u) => u.project_id)), [updates]);

  // J/K · ↑/↓ move focus between rows; Enter opens (native link activation)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!["j", "k", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      if (isTypingTarget(e.target) || anyOverlayOpen() || uiOverlayOpen()) return;
      const links = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-project-link]") ?? []);
      if (!links.length) return;
      e.preventDefault();
      // the row holding focus (its link, or one of its inline pickers)
      const row = (document.activeElement as HTMLElement | null)?.closest?.('[role="row"]');
      const i = row ? links.findIndex((l) => row.contains(l)) : -1;
      const down = e.key === "j" || e.key === "ArrowDown";
      const next = i === -1 ? (down ? 0 : links.length - 1) : down ? Math.min(links.length - 1, i + 1) : Math.max(0, i - 1);
      links[next].focus({ preventScroll: true });
      links[next].scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const isFav = (id: string) => Object.values(favorites).some((f) => f.kind === "project" && f.target_id === id && f.user_id === me);

  return (
    <div ref={listRef} role="table" aria-label="Projects" className="min-w-0">
      <div role="row" className="sticky top-0 z-[2] flex h-9 items-center gap-2 border-b border-line bg-canvas px-3 text-xxs font-medium text-faint md:px-5">
        <span role="columnheader" className="min-w-0 flex-1 pl-[26px]">Name</span>
        <span role="columnheader" className={COL.health}>Health</span>
        <span role="columnheader" className={COL.priority}>Priority</span>
        <span role="columnheader" className={COL.lead}>Lead</span>
        <span role="columnheader" className={`${COL.target} pl-1.5`}>Target date</span>
        <span role="columnheader" className={`${COL.status} sm:pl-1.5`}><span className="hidden sm:inline">Status</span></span>
        <span role="columnheader" className={COL.progress}>Progress</span>
        <span role="columnheader" className={COL.teams}>Teams</span>
      </div>
      {projects.map((p) => (
        <ProjectRow
          key={p.id}
          project={p}
          progress={progress[p.id]}
          hasUpdates={withUpdates.has(p.id)}
          menuOpen={menu?.id === p.id}
          onContextMenu={(x, y) => setMenu({ id: p.id, at: { x, y } })}
        />
      ))}
      <Popover open={Boolean(menu && menuProject)} onClose={() => setMenu(null)} anchor={menu?.at ?? null}>
        {menuProject && (
          <ActionMenu
            onDone={() => setMenu(null)}
            items={projectActionItems(menuProject, {
              favorite: isFav(menuProject.id),
              onOpen: () => navigate({ kind: "project", id: menuProject.id, tab: "overview" }),
            })}
          />
        )}
      </Popover>
    </div>
  );
}

function ProjectRow({
  project: p, progress, hasUpdates, menuOpen, onContextMenu,
}: { project: Project; progress?: Progress; hasUpdates: boolean; menuOpen: boolean; onContextMenu: (x: number, y: number) => void }) {
  const lead = useSync((s) => (p.lead_id ? s.profiles[p.lead_id] : undefined));
  const teamsMap = useSync((s) => s.teams);
  const teams = p.team_ids.map((id) => teamsMap[id]).filter((t) => t && !t.archived_at);
  const overdue = Boolean(p.target_date && p.target_date < localToday() && !isClosed(p));
  const ratio = progress?.ratio ?? 0;

  // closing an inline picker returns focus to its trigger (Popover), so J/K continues from this row
  return (
    <div
      role="row"
      onContextMenu={(e) => {
        // events from portaled popovers (inline pickers) bubble through the React tree — ignore them
        if (!e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      className={`group relative flex h-10 items-center gap-2 border-b border-line px-3 transition-colors hover:bg-wash has-[a:focus-visible]:bg-wash has-[a:focus-visible]:shadow-[inset_2px_0_0_var(--accent)] md:px-5 ${
        menuOpen ? "bg-wash" : ""
      } ${p.archived_at ? "opacity-60" : ""}`}
    >
      {/* name (stretched link) */}
      <div role="cell" className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="flex w-4 shrink-0 justify-center"><ProjectIcon icon={p.icon} color={p.color} size={16} /></span>
        <a
          {...linkProps({ kind: "project", id: p.id, tab: "overview" })}
          data-project-link
          className="min-w-0 scroll-mb-2 scroll-mt-12 truncate text-[13px] font-medium text-ink outline-none before:absolute before:inset-0 before:content-['']"
        >
          {p.name}
        </a>
        {p.archived_at && <Archive size={12} className="shrink-0 text-faint" aria-label="Archived" />}
        {p.summary && <span className="hidden min-w-0 flex-1 truncate text-[13px] text-faint md:block">{p.summary}</span>}
      </div>

      {/* health (read-only — set by updates) */}
      <div role="cell" className={`${COL.health} items-center gap-1.5 text-[12.5px]`}>
        <HealthDot health={p.health} />
        <span className={`truncate ${p.health ? "text-dim" : "text-faint"}`}>{p.health ? HEALTH_LABEL[p.health] : hasUpdates ? "No health" : "No updates"}</span>
      </div>

      {/* priority */}
      <div role="cell" className={COL.priority}>
        <Dropdown
          width={220}
          trigger={(t) => (
            <button ref={t.ref} type="button" onClick={t.onClick} aria-expanded={t["aria-expanded"]} title={`Priority: ${PRIORITY_LABEL[p.priority]}`} aria-label="Change priority" className={`${cellBtn} w-8 justify-center px-0 ${t.open ? "border-line-strong bg-surface" : ""}`}>
              <PriorityIcon priority={p.priority} className={p.priority ? "text-dim" : "text-faint"} />
            </button>
          )}
        >
          {(close) => <PriorityMenu value={p.priority} onChange={(v) => { void updateProject(p.id, { priority: v }); close(); }} />}
        </Dropdown>
      </div>

      {/* lead */}
      <div role="cell" className={COL.lead}>
        <Dropdown
          width={260}
          align="end"
          trigger={(t) => (
            <button ref={t.ref} type="button" onClick={t.onClick} aria-expanded={t["aria-expanded"]} title={lead ? `Lead: ${displayName(lead)}` : "Set lead"} aria-label="Change lead" className={`${cellBtn} w-8 justify-center px-0 ${t.open ? "border-line-strong bg-surface" : ""}`}>
              <Avatar profile={lead ?? null} size={20} />
            </button>
          )}
        >
          {(close) => <LeadMenu value={p.lead_id} onChange={(u) => { void updateProject(p.id, { lead_id: u }); close(); }} />}
        </Dropdown>
      </div>

      {/* target date */}
      <div role="cell" className={COL.target}>
        <Dropdown
          width={256}
          align="end"
          trigger={(t) => (
            <button ref={t.ref} type="button" onClick={t.onClick} aria-expanded={t["aria-expanded"]} aria-label="Change target date" title={p.target_date ? `Target: ${formatDate(p.target_date, true)}` : "Set target date"} className={`${cellBtn} ${t.open ? "border-line-strong bg-surface" : ""} ${overdue ? "text-danger" : "text-dim"}`}>
              {p.target_date ? (
                <span className="truncate tabular-nums">{formatDate(p.target_date)}</span>
              ) : (
                <CalendarDays size={13} className={`text-faint transition-opacity ${t.open ? "" : "opacity-0 group-hover:opacity-100"}`} />
              )}
            </button>
          )}
        >
          {(close) => <DateMenu value={p.target_date} min={p.start_date} onChange={(d) => { void updateProject(p.id, { target_date: d }); close(); }} clearLabel="Remove target date" />}
        </Dropdown>
      </div>

      {/* status */}
      <div role="cell" className={COL.status}>
        <Dropdown
          width={240}
          align="end"
          trigger={(t) => (
            <button ref={t.ref} type="button" onClick={t.onClick} aria-expanded={t["aria-expanded"]} aria-label={`Status: ${PROJECT_STATUS_LABEL[p.status]}`} title={PROJECT_STATUS_LABEL[p.status]} className={`${cellBtn} w-8 justify-center px-0 text-dim sm:w-auto sm:max-w-full sm:justify-start sm:px-1.5 ${t.open ? "border-line-strong bg-surface" : ""}`}>
              <ProjectStatusIcon status={p.status} />
              <span className="hidden truncate sm:inline">{PROJECT_STATUS_LABEL[p.status]}</span>
            </button>
          )}
        >
          {(close) => <ProjectStatusMenu value={p.status} onChange={(s) => { void updateProject(p.id, { status: s }); close(); }} />}
        </Dropdown>
      </div>

      {/* progress */}
      <div role="cell" className={`${COL.progress} items-center gap-1.5 text-[12.5px] tabular-nums text-dim`} title={progress ? `${progress.done} of ${progress.total} issues completed` : "No issues"}>
        <ProgressRing value={ratio} size={14} color={p.color} />
        <span>{pct(ratio)}%</span>
      </div>

      {/* teams */}
      <div role="cell" className={`${COL.teams} items-center`} title={teams.map((t) => t.name).join(", ")}>
        {teams.slice(0, 4).map((t, i) => (
          <span key={t.id} className="rounded-[6px] ring-2 ring-[var(--canvas)] group-hover:ring-[var(--wash)]" style={{ marginLeft: i ? -5 : 0 }}>
            <TeamIcon team={t} size={18} />
          </span>
        ))}
        {teams.length > 4 && <span className="ml-1 text-xxs text-faint">+{teams.length - 4}</span>}
      </div>
    </div>
  );
}
