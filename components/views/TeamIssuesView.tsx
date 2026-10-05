"use client";
/* ─── Locus · team issues view (All issues · Active · Backlog) ─── */

import { useCallback, useMemo } from "react";
import { Archive, CircleDot, Plus, Star, Timer } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { ui } from "@/lib/ui";
import { useIssueQuery, useTeamByKey, useTeamStates } from "@/lib/model";
import { toggleFavorite } from "@/lib/sync/actions";
import type { TeamTab } from "@/lib/router";
import { HeaderTab, ViewHeader } from "@/components/app/Header";
import NotFound from "@/components/app/NotFound";
import { Button, EmptyState } from "@/components/primitives/controls";
import { TeamIcon } from "@/components/primitives/icons";
import IssuesSurface, { DisplayMenu, FilterBar, FilterButton } from "@/components/issues/IssuesSurface";
import { TEAM_TAB_FILTERS } from "@/components/issues/filters";
import { ToolbarButton } from "@/components/issues/shared";
import type { Issue, Team } from "@/lib/types";

const TABS: { tab: TeamTab; label: string }[] = [
  { tab: "all", label: "All issues" },
  { tab: "active", label: "Active" },
  { tab: "backlog", label: "Backlog" },
];

export default function TeamIssuesView({ teamKey, tab }: { teamKey: string; tab: "all" | "active" | "backlog" }) {
  const team = useTeamByKey(teamKey);
  if (!team) return <NotFound what="team" />;
  return <TeamIssues team={team} tab={tab} />;
}

function TeamIssues({ team, tab }: { team: Team; tab: TeamTab }) {
  const viewKey = `team:${team.id}:${tab}`;
  const scope = useCallback((i: Issue) => i.team_id === team.id, [team.id]);
  // the Active / Backlog scopes are base filters (not hidden in the scope predicate) so the board
  // drops status columns that can never fill; "Save view" re-derives them from the view key.
  // Base filters never show in the filter bar.
  const query = useIssueQuery({ viewKey, scope, teamId: team.id, baseFilters: TEAM_TAB_FILTERS[tab], deps: [team.id] });

  const favorite = useSync((s) => {
    for (const f of Object.values(s.favorites)) if (f.kind === "team" && f.target_id === team.id && f.user_id === s.userId) return true;
    return false;
  });
  const states = useTeamStates(team.id);
  const backlogState = states.find((s) => s.type === "backlog")?.id;
  // issues created from the Backlog tab start in Backlog, so they land in the view they were created from
  const createDefaults = useMemo(
    (): Partial<Issue> => (tab === "backlog" && backlogState ? { team_id: team.id, state_id: backlogState } : { team_id: team.id }),
    [team.id, tab, backlogState],
  );

  const empty = (
    <EmptyState
      icon={tab === "backlog" ? <Archive size={30} strokeWidth={1.5} /> : tab === "active" ? <Timer size={30} strokeWidth={1.5} /> : <CircleDot size={30} strokeWidth={1.5} />}
      title={tab === "all" ? "No issues yet" : tab === "active" ? "No active issues" : "Backlog is empty"}
      body={
        tab === "all"
          ? `Track ${team.name}’s work — bugs, tasks and ideas — as issues.`
          : tab === "active"
            ? "Issues that are Todo or In Progress show up here."
            : "Unplanned work and ideas for this team land here."
      }
      action={
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => ui.openCreateIssue(createDefaults)}
        >
          Create issue
        </Button>
      }
    />
  );

  return (
    <>
      <ViewHeader
        icon={<TeamIcon team={team} size={18} />}
        title={team.name}
        tabs={TABS.map((t) => (
          <HeaderTab key={t.tab} to={{ kind: "team", key: team.key, tab: t.tab }} active={tab === t.tab}>
            {t.label}
          </HeaderTab>
        ))}
        actions={
          <>
            <FilterButton viewKey={viewKey} teamId={team.id} />
            <DisplayMenu viewKey={viewKey} query={query} />
            <ToolbarButton
              iconOnly
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={favorite}
              icon={<Star size={14} className={favorite ? "fill-current text-warning" : ""} />}
              onClick={() => toggleFavorite("team", team.id)}
            />
            <button
              type="button"
              aria-label="New issue"
              title="New issue (C)"
              onClick={() => ui.openCreateIssue(createDefaults)}
              className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent text-[12.5px] font-medium text-accent-ink shadow-card transition-colors hover:bg-accent-hover sm:h-7 sm:w-auto sm:px-2.5"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">New issue</span>
            </button>
          </>
        }
        sub={<FilterBar viewKey={viewKey} query={query} />}
      />
      <IssuesSurface key={viewKey} query={query} viewKey={viewKey} createDefaults={createDefaults} empty={empty} />
    </>
  );
}
