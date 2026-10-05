"use client";
/* ─── Locus · inbox right pane: the selected notification's issue or project ──
   Issues render as the embedded issue page (its own compact bar, no page
   chrome, no Escape → back / J·K / URL following — the inbox owns those keys).
   Project notifications get a summary card under a bar of the same shape.
   ──────────────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import { Archive, ArrowUpRight, CalendarDays, Hexagon } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { HEALTH_LABEL, PROJECT_STATUS_LABEL, displayName, issueKey, progressOf } from "@/lib/model";
import { formatDate, timeAgo } from "@/lib/format";
import { linkProps, type Route } from "@/lib/router";
import IssueView from "@/components/issue/IssueView";
import { RichText } from "@/components/editor/Editor";
import { Avatar } from "@/components/primitives/Avatar";
import { Button, EmptyState, ProgressBar } from "@/components/primitives/controls";
import { HealthDot, ProjectIcon, ProjectStatusIcon } from "@/components/primitives/icons";
import type { Notification } from "@/lib/types";

export interface InboxDetailProps {
  n: Notification;
  /** archive this notification (offered when what it points at is gone) */
  onArchive: (id: string) => void;
}

export default function InboxDetail({ n, onArchive }: InboxDetailProps) {
  const issue = useSync((s) => (n.issue_id ? s.issues[n.issue_id] : undefined));
  const teams = useSync((s) => s.teams);

  if (issue) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <IssueView key={issue.id} identifier={issueKey(issue, teams)} embedded />
      </div>
    );
  }
  if (n.project_id) return <ProjectPane n={n} projectId={n.project_id} onArchive={onArchive} />;
  return <Unavailable what="item" onArchive={() => onArchive(n.id)} />;
}

function Unavailable({ what, onArchive }: { what: "item" | "project"; onArchive: () => void }) {
  return (
    <EmptyState
      icon={<Hexagon size={28} strokeWidth={1.5} />}
      title={`This ${what} is no longer available`}
      body="It was deleted, or you no longer have access to it."
      action={<Button variant="secondary" size="md" icon={<Archive size={14} />} onClick={onArchive}>Archive notification</Button>}
    />
  );
}

/* ─── project notifications ─── */

function ProjectPane({ n, projectId, onArchive }: InboxDetailProps & { projectId: string }) {
  const project = useSync((s) => s.projects[projectId]);
  const updates = useSync((s) => s.project_updates);
  const issues = useSync((s) => s.issues);
  const states = useSync((s) => s.workflow_states);
  const lead = useSync((s) => (project?.lead_id ? s.profiles[project.lead_id] : undefined));

  const latest = useMemo(
    () => Object.values(updates).filter((u) => u.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
    [updates, projectId],
  );
  const author = useSync((s) => (latest?.user_id ? s.profiles[latest.user_id] : undefined));
  const progress = useMemo(
    () => progressOf(Object.values(issues).filter((i) => i.project_id === projectId && !i.archived_at), states),
    [issues, states, projectId],
  );

  if (!project) return <Unavailable what="project" onArchive={() => onArchive(n.id)} />;

  const to: Route = { kind: "project", id: project.id, tab: n.type === "project_update" ? "updates" : "overview" };
  const open = linkProps(to);
  const pct = Math.round(progress.ratio * 100);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* same shape as the embedded issue page's bar, so switching notifications doesn't shift the pane */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-canvas pl-4 pr-2">
        <a
          {...open}
          title="Open project"
          className="focus-ring -ml-1 flex h-7 min-w-0 items-center gap-1.5 rounded px-1 text-[13px] transition-colors hover:bg-wash"
        >
          <ProjectIcon icon={project.icon} color={project.color} size={14} />
          <span className="min-w-0 truncate font-medium text-ink">{project.name}</span>
        </a>
        <a
          {...open}
          aria-label="Open project"
          title="Open project"
          className="focus-ring ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] font-medium text-ink shadow-card transition-colors hover:bg-wash"
        >
          <span className="hidden xl:inline">Open</span>
          <ArrowUpRight size={14} className="text-faint" />
        </a>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-6 py-8">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface shadow-card">
              <ProjectIcon icon={project.icon} color={project.color} size={20} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[18px] font-semibold text-ink">{project.name}</h2>
              {project.summary && <p className="mt-0.5 text-[13px] text-dim">{project.summary}</p>}
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-line bg-surface p-4 text-[12.5px] shadow-card xl:grid-cols-4">
            <div>
              <dt className="text-xxs font-medium text-faint">Status</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-ink"><ProjectStatusIcon status={project.status} />{PROJECT_STATUS_LABEL[project.status]}</dd>
            </div>
            <div>
              <dt className="text-xxs font-medium text-faint">Health</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-ink"><HealthDot health={project.health} />{project.health ? HEALTH_LABEL[project.health] : "No updates"}</dd>
            </div>
            <div>
              <dt className="text-xxs font-medium text-faint">Lead</dt>
              <dd className="mt-1 flex min-w-0 items-center gap-1.5 text-ink"><Avatar profile={lead ?? null} size={16} /><span className="truncate">{lead ? displayName(lead) : "No lead"}</span></dd>
            </div>
            <div>
              <dt className="text-xxs font-medium text-faint">Target date</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-ink"><CalendarDays size={13} className="text-faint" />{project.target_date ? formatDate(project.target_date) : "Not set"}</dd>
            </div>
            <div className="col-span-2 xl:col-span-4">
              <dt className="flex items-center justify-between text-xxs font-medium text-faint">
                <span>Progress</span>
                <span className="tabular-nums">{progress.done} / {progress.total} issues · {pct}%</span>
              </dt>
              <dd className="mt-2"><ProgressBar value={progress.ratio} /></dd>
            </div>
          </dl>

          <h3 className="mt-8 text-[12.5px] font-medium text-dim">Latest update</h3>
          {latest ? (
            <article className="mt-2 rounded-lg border border-line bg-surface p-4 shadow-card">
              <header className="flex items-center gap-2 text-[12.5px]">
                <Avatar profile={author ?? null} size={20} />
                <span className="font-medium text-ink">{author ? displayName(author) : "Someone"}</span>
                <span className="text-faint">{timeAgo(latest.created_at)}</span>
                <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full border border-line-strong px-2 text-xxs font-medium text-ink">
                  <HealthDot health={latest.health} size={7} />{HEALTH_LABEL[latest.health]}
                </span>
              </header>
              <div className="mt-3"><RichText html={latest.body} compact /></div>
            </article>
          ) : (
            <p className="mt-2 text-[13px] text-faint">No updates have been posted yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
