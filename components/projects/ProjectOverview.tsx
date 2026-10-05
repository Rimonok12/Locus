"use client";
/* ─── Locus · project overview tab ───────────────────────────────────────────
   Identity (icon · name · summary), property chips, progress + latest update
   cards, autosaving description, milestones.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import { ArrowRight, PenLine } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { STATE_TYPES, STATE_TYPE_COLOR, STATE_TYPE_LABEL, displayName } from "@/lib/model";
import { updateProject } from "@/lib/sync/actions";
import { linkProps, navigate } from "@/lib/router";
import { daysBetween, formatDate, formatDateTime, localToday, timeAgo } from "@/lib/format";
import { ui, useUI } from "@/lib/ui";
import { Dropdown } from "@/components/primitives/overlay";
import { Button, ProgressBar } from "@/components/primitives/controls";
import { Avatar } from "@/components/primitives/Avatar";
import { ProjectIcon, StateIcon } from "@/components/primitives/icons";
import Editor, { RichText, isEmptyHtml } from "@/components/editor/Editor";
import ProjectHeader from "./ProjectHeader";
import Milestones from "./Milestones";
import { IconColorPicker, ProjectPropertyChips } from "./menus";
import {
  HealthBadge, InlineInput, SectionTitle, isClosed, pct, useDebouncedSave, useProjectBreakdown, useProjectUpdates,
} from "./shared";
import type { Project, ProjectUpdate, StateType } from "@/lib/types";

export default function ProjectOverview({ project }: { project: Project }) {
  const id = project.id;
  const breakdown = useProjectBreakdown(id);
  const updates = useProjectUpdates(id);
  const latest = updates[0];

  return (
    <>
      <ProjectHeader project={project} tab="overview" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-4 pb-24 pt-6 sm:px-8 sm:pt-10">
          {/* identity */}
          <Dropdown
            width={300}
            trigger={(p) => (
              <button
                ref={p.ref}
                type="button"
                onClick={p.onClick}
                aria-expanded={p["aria-expanded"]}
                aria-label="Change icon and color"
                title="Change icon and color"
                className={`focus-ring flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-raised transition-colors hover:bg-wash ${p.open ? "bg-wash" : ""}`}
              >
                <ProjectIcon icon={project.icon} color={project.color} size={26} />
              </button>
            )}
          >
            {(close) => (
              <IconColorPicker
                icon={project.icon}
                color={project.color}
                onChange={(patch) => {
                  void updateProject(id, patch);
                  if (patch.icon !== undefined) close();
                }}
              />
            )}
          </Dropdown>

          <InlineInput
            value={project.name}
            onSave={(name) => { void updateProject(id, { name }); }}
            required
            aria-label="Project name"
            placeholder="Project name"
            className="mt-4 w-full text-[22px] font-semibold leading-tight text-ink sm:text-[24px]"
          />
          <InlineInput
            value={project.summary}
            onSave={(summary) => { void updateProject(id, { summary }); }}
            maxLength={255}
            aria-label="Summary"
            placeholder="Add a short summary…"
            className="mt-1.5 w-full text-[16px] text-dim sm:text-[15px]"
          />

          <div className="mt-5">
            <ProjectPropertyChips
              value={project}
              onChange={(patch) => { void updateProject(id, patch); }}
              health={{ value: project.health }}
              latestUpdate={latest}
            />
          </div>

          {/* progress + latest update */}
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <ProgressCard project={project} breakdown={breakdown} />
            <LatestUpdateCard project={project} update={latest} />
          </div>

          {/* description */}
          <section className="mt-10" aria-label="Description">
            <SectionTitle>Description</SectionTitle>
            <DescriptionEditor project={project} />
          </section>

          {/* milestones */}
          <div className="mt-10">
            <Milestones project={project} byMilestone={breakdown.byMilestone} states={breakdown.states} />
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══ progress ═══ */

function ProgressCard({ project, breakdown }: { project: Project; breakdown: ReturnType<typeof useProjectBreakdown> }) {
  const { progress, byType, hasEstimates } = breakdown;
  const ratio = progress.ratio;
  const target = project.target_date;
  const days = target ? daysBetween(localToday(), target) : null;
  const closed = isClosed(project);

  // clicking a state bucket opens the Issues tab filtered to that state type (other filters are kept)
  const showType = (t: StateType) => {
    const key = `project:${project.id}`;
    const rest = (useUI.getState().filters[key] ?? []).filter((f) => f.field !== "state_type");
    ui.setFilters(key, [...rest, { id: `state-type-${t}`, field: "state_type", op: "is", values: [t] }]);
    navigate({ kind: "project", id: project.id, tab: "issues" });
  };

  const stats = [
    { label: "Scope", value: hasEstimates ? progress.scope : progress.total },
    { label: "Started", value: hasEstimates ? byType.started.points : byType.started.count },
    { label: "Completed", value: hasEstimates ? progress.completedScope : progress.done },
  ];

  return (
    <div className="flex flex-col rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-dim">Progress</span>
        <span className="text-[13px] font-medium tabular-nums text-ink">{pct(ratio)}%</span>
      </div>
      <ProgressBar value={ratio} color={project.color} className="mt-3" />
      <p className="mt-2 text-[12.5px] text-dim">
        {progress.total ? (
          <>{progress.done} of {progress.total} issue{progress.total === 1 ? "" : "s"} · {pct(ratio)}%</>
        ) : (
          <>No issues yet — <a {...linkProps({ kind: "project", id: project.id, tab: "issues" })} className="text-accent hover:underline">add some</a>.</>
        )}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md bg-raised px-2.5 py-2">
            <div className="text-xxs text-faint">{s.label}</div>
            <div className="mt-0.5 text-[14px] font-medium tabular-nums text-ink">
              {s.value}
              <span className="ml-1 text-xxs font-normal text-faint">{hasEstimates ? "pts" : s.value === 1 ? "issue" : "issues"}</span>
            </div>
          </div>
        ))}
      </div>

      {breakdown.list.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {STATE_TYPES.filter((t) => byType[t].count > 0).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => showType(t)}
              title={`Show ${STATE_TYPE_LABEL[t].toLowerCase()} issues`}
              className="focus-ring flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-dim transition-colors hover:bg-wash hover:text-ink"
            >
              <StateIcon type={t} color={STATE_TYPE_COLOR[t]} size={12} />
              {STATE_TYPE_LABEL[t]}
              <span className="tabular-nums text-faint">{byType[t].count}</span>
            </button>
          ))}
        </div>
      )}

      {target && (
        <div className="mt-auto pt-3 text-[12px] text-faint">
          Target {formatDate(target, true)}
          {!closed && days != null && (
            <span className={days < 0 ? "text-danger" : days <= 7 ? "text-warning" : ""}>
              {" · "}
              {days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue` : days === 0 ? "due today" : `${days} day${days === 1 ? "" : "s"} left`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══ latest update ═══ */

function LatestUpdateCard({ project, update }: { project: Project; update?: ProjectUpdate }) {
  const author = useSync((s) => (update?.user_id ? s.profiles[update.user_id] : undefined));
  const updatesRoute = { kind: "project", id: project.id, tab: "updates" } as const;

  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-dim">Latest update</span>
        <a {...linkProps(updatesRoute)} className="focus-ring flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-dim transition-colors hover:bg-wash hover:text-ink">
          <PenLine size={13} /> Write update
        </a>
      </div>
      {update ? (
        <>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <HealthBadge health={update.health} />
            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-dim">
              <Avatar profile={author ?? null} size={16} />
              <span className="truncate">{displayName(author)}</span>
            </span>
            <span className="text-[12px] text-faint" title={formatDateTime(update.created_at)}>{timeAgo(update.created_at)}</span>
          </div>
          <ClampedBody html={update.body} />
          <a {...linkProps(updatesRoute)} className="mt-auto flex items-center gap-1 pt-2 text-[12px] font-medium text-accent hover:underline">
            View all updates <ArrowRight size={12} />
          </a>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-start justify-center py-4">
          <p className="text-[13px] text-ink">No updates yet</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
            Share progress, risks and decisions. Posting an update sets the project’s health and notifies its lead and members.
          </p>
          <Button size="sm" variant="secondary" icon={<PenLine size={13} />} onClick={() => navigate(updatesRoute)} className="mt-3 h-8 sm:h-7">
            Write first update
          </Button>
        </div>
      )}
    </div>
  );
}

/** Update body capped in height, with a fade only when it actually overflows. */
function ClampedBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [html]);
  return (
    <div ref={ref} className="relative mt-2.5 max-h-[140px] overflow-hidden">
      {isEmptyHtml(html) ? <p className="text-[13px] text-faint">No details were added.</p> : <RichText html={html} compact />}
      {overflow && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--surface)] to-transparent" />}
    </div>
  );
}

/* ═══ description (debounced autosave: 700ms + blur) ═══ */

function DescriptionEditor({ project }: { project: Project }) {
  const id = project.id;
  // only user edits are persisted — focusing and leaving must never write back a stale copy
  const dirty = useRef(false);
  const { schedule, flush } = useDebouncedSave<string>((html) => {
    const v = isEmptyHtml(html) ? "" : html;
    const current = useSync.getState().projects[id];
    if (current && current.description !== v) void updateProject(id, { description: v });
  }, 700);

  return (
    <div className="-mx-1 rounded-md px-1">
      <Editor
        value={project.description}
        onChange={(html) => { dirty.current = true; schedule(html); }}
        onBlur={(html) => {
          if (!dirty.current) return;
          dirty.current = false;
          schedule(html);
          flush();
        }}
        placeholder="Add a description, a project brief, or collect ideas…"
        minHeight={140}
      />
    </div>
  );
}
