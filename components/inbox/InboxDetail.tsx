"use client";
/* ─── Locus · inbox right pane: the selected notification's issue or project ─── */

import { useMemo } from "react";
import { ArrowUpRight, CalendarDays, Hexagon } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { HEALTH_LABEL, PROJECT_STATUS_LABEL, displayName, issueKey, progressOf } from "@/lib/model";
import { formatDate, timeAgo } from "@/lib/format";
import { linkProps } from "@/lib/router";
import IssueView from "@/components/issue/IssueView";
import { RichText } from "@/components/editor/Editor";
import { Avatar } from "@/components/primitives/Avatar";
import { EmptyState, ProgressBar } from "@/components/primitives/controls";
import { HealthDot, ProjectIcon, ProjectStatusIcon } from "@/components/primitives/icons";
import type { Notification } from "@/lib/types";

export default function InboxDetail({ n }: { n: Notification }) {
  const issue = useSync((s) => (n.issue_id ? s.issues[n.issue_id] : undefined));
  const teams = useSync((s) => s.teams);

  if (issue) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <IssueView key={issue.id} identifier={issueKey(issue, teams)} />
      </div>
    );
  }
  if (n.project_id) return <ProjectCard projectId={n.project_id} />;
  return (
    <EmptyState
      icon={<Hexagon size={28} strokeWidth={1.5} />}
      title="This item is no longer available"
      body="It was deleted, or you no longer have access to it. You can archive this notification."
    />
  );
}

function ProjectCard({ projectId }: { projectId: string }) {
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

  if (!project) {
    return (
      <EmptyState
        icon={<Hexagon size={28} strokeWidth={1.5} />}
        title="This project is no longer available"
        body="It was deleted, or you no longer have access to it."
      />
    );
  }

  const open = linkProps({ kind: "project", id: project.id, tab: "overview" });
  const pct = Math.round(progress.ratio * 100);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <ProjectIcon icon={project.icon} color={project.color} size={15} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{project.name}</span>
        <a {...open} className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink shadow-card hover:bg-wash">
          Open project <ArrowUpRight size={13} className="text-faint" />
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

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-line bg-surface p-4 text-[12.5px] shadow-card lg:grid-cols-4">
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
            <div className="col-span-2 lg:col-span-4">
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
