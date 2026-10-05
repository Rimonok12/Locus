"use client";
/* ─── Locus · project issues tab (shared issue list / board surface) ─── */

import { useMemo } from "react";
import { CircleDot, Plus } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { useIssueQuery, useMyTeams } from "@/lib/model";
import { ui } from "@/lib/ui";
import { Button, EmptyState, IconButton } from "@/components/primitives/controls";
import IssuesSurface, { DisplayMenu, FilterBar, FilterButton } from "@/components/issues/IssuesSurface";
import ProjectHeader from "./ProjectHeader";
import type { Grouping, Issue, Project } from "@/lib/types";

/* every grouping except "project" (all issues here share it) */
const GROUPINGS: Grouping[] = ["status", "assignee", "priority", "cycle", "label", "team", "none"];

export default function ProjectIssues({ project }: { project: Project }) {
  const id = project.id;
  const viewKey = `project:${id}`;
  const teamsMap = useSync((s) => s.teams);
  const myTeams = useMyTeams();

  const query = useIssueQuery({
    viewKey,
    scope: (i) => i.project_id === id,
    defaults: { grouping: "status" },
    deps: [id],
  });

  const projectTeams = useMemo(
    () => project.team_ids.filter((t) => teamsMap[t] && !teamsMap[t].archived_at),
    [project.team_ids, teamsMap],
  );
  const teamId = projectTeams[0] ?? myTeams[0]?.id;
  const createDefaults = useMemo<Partial<Issue>>(
    () => (teamId ? { project_id: id, team_id: teamId } : { project_id: id }),
    [id, teamId],
  );
  const newIssue = () => ui.openCreateIssue(createDefaults);

  return (
    <>
      <ProjectHeader
        project={project}
        tab="issues"
        actions={
          <>
            <FilterButton viewKey={viewKey} teamId={projectTeams.length === 1 ? projectTeams[0] : undefined} />
            <DisplayMenu viewKey={viewKey} query={query} groupings={GROUPINGS} />
            <IconButton label="New issue in project" onClick={newIssue} size={32}>
              <Plus size={16} />
            </IconButton>
          </>
        }
        sub={<FilterBar viewKey={viewKey} query={query} />}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <IssuesSurface
          query={query}
          viewKey={viewKey}
          createDefaults={createDefaults}
          empty={
            <EmptyState
              icon={<CircleDot size={28} strokeWidth={1.5} />}
              title="No issues in this project yet"
              body="Create an issue here, or add existing issues to the project from their Project property."
              action={<Button variant="primary" icon={<Plus size={14} />} onClick={newIssue}>Create issue</Button>}
            />
          }
        />
      </div>
    </>
  );
}
