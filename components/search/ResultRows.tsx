"use client";
/* ─── Locus · search result rows ─── */

import { memo } from "react";
import { useSync } from "@/lib/sync/store";
import { PROJECT_STATUS_LABEL } from "@/lib/model";
import { timeAgo } from "@/lib/format";
import { linkProps } from "@/lib/router";
import { Avatar } from "@/components/primitives/Avatar";
import { ProjectIcon, ProjectStatusIcon, TeamIcon } from "@/components/primitives/icons";
import { StateGlyph } from "@/components/pickers";
import { Highlight } from "./Highlight";
import type { IssueHit, ProjectHit } from "./useSearch";

interface RowProps { index: number; active: boolean; query: string; onHover: (index: number) => void }

export const IssueResultRow = memo(function IssueResultRow({ hit, index, active, query, onHover, showUpdated }: RowProps & { hit: IssueHit; showUpdated?: boolean }) {
  const team = useSync((s) => s.teams[hit.issue.team_id]);
  const { issue, key, snippet } = hit;
  return (
    <a
      {...linkProps({ kind: "issue", identifier: key })}
      id={`search-result-${index}`}
      data-idx={index}
      role="option"
      aria-selected={active}
      onMouseMove={() => onHover(index)}
      className={`flex min-h-[40px] items-center gap-3 border-b border-line px-4 py-1.5 transition-colors md:px-6 ${active ? "bg-wash" : ""}`}
    >
      <StateGlyph stateId={issue.state_id} />
      <span className="hidden w-[72px] shrink-0 truncate text-[12.5px] tabular-nums text-faint sm:block">
        <Highlight text={key} query={query} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink"><Highlight text={issue.title} query={query} /></span>
        <span className={`block truncate text-[12px] text-faint ${snippet ? "" : "sm:hidden"}`}>
          <span className="tabular-nums sm:hidden">{key}{snippet ? " · " : ""}</span>
          {snippet && <Highlight text={snippet} query={query} />}
        </span>
      </span>
      {showUpdated && <span className="hidden shrink-0 text-xxs tabular-nums text-faint md:inline">{timeAgo(issue.updated_at)}</span>}
      {team && (
        <span className="hidden shrink-0 items-center gap-1 text-[12px] text-faint sm:flex" title={team.name}>
          <TeamIcon team={team} size={14} />{team.key}
        </span>
      )}
      <Avatar userId={issue.assignee_id} size={18} />
    </a>
  );
});

export const ProjectResultRow = memo(function ProjectResultRow({ hit, index, active, query, onHover }: RowProps & { hit: ProjectHit }) {
  const { project } = hit;
  return (
    <a
      {...linkProps({ kind: "project", id: project.id, tab: "overview" })}
      id={`search-result-${index}`}
      data-idx={index}
      role="option"
      aria-selected={active}
      onMouseMove={() => onHover(index)}
      className={`flex min-h-[40px] items-center gap-3 border-b border-line px-4 py-1.5 transition-colors md:px-6 ${active ? "bg-wash" : ""}`}
    >
      <ProjectIcon icon={project.icon} color={project.color} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink"><Highlight text={project.name} query={query} /></span>
        {project.summary && <span className="block truncate text-[12px] text-faint"><Highlight text={project.summary} query={query} /></span>}
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 text-[12px] text-dim sm:flex">
        <ProjectStatusIcon status={project.status} size={13} />{PROJECT_STATUS_LABEL[project.status]}
      </span>
      <Avatar userId={project.lead_id} size={18} />
    </a>
  );
});
