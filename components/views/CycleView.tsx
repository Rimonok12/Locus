"use client";
/* ─── Locus · one cycle: summary + burn-up + its issues ─── */

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowRight, CircleCheck, Link2, MoreHorizontal, Pencil, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { cyclePhase, useIssueQuery, useTeamByKey, useTeamCycles } from "@/lib/model";
import { copyText, createNextCycle, toggleFavorite } from "@/lib/sync/actions";
import { hrefFor, linkProps, navigate } from "@/lib/router";
import { ViewHeader } from "@/components/app/Header";
import NotFound from "@/components/app/NotFound";
import IssuesSurface, { DisplayMenu, FilterBar, FilterButton } from "@/components/issues/IssuesSurface";
import { Button, EmptyState, IconButton } from "@/components/primitives/controls";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import { TeamIcon } from "@/components/primitives/icons";
import { ui } from "@/lib/ui";
import CycleSummary from "@/components/cycles/CycleSummary";
import CycleEditPopover from "@/components/cycles/CycleEditPopover";
import CompleteCycleModal from "@/components/cycles/CompleteCycleModal";
import { EnableCyclesButton } from "@/components/cycles/EnableCycles";
import { EMPTY_ISSUES, confirmDeleteCycle, cycleRange, cycleTiming, cycleTitle, useIssuesByCycle } from "@/components/cycles/util";
import type { Crumb } from "@/components/app/Header";
import type { Cycle, Issue, Team } from "@/lib/types";

export default function CycleView({ teamKey, number }: { teamKey: string; number: number | "current" }) {
  const team = useTeamByKey(teamKey);
  const cycles = useTeamCycles(team?.id);
  if (!team) return <NotFound what="team" />;
  const cycle = number === "current"
    ? cycles.filter((c) => cyclePhase(c) === "current").sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
    : cycles.find((c) => c.number === number);
  if (!cycle) return <NoCycle team={team} number={number} cycles={cycles} />;
  return <CycleDetail key={cycle.id} team={team} cycle={cycle} />;
}

function crumbsFor(team: Team): Crumb[] {
  return [
    { label: <span className="hidden sm:inline">{team.name}</span>, icon: <TeamIcon team={team} size={16} />, to: { kind: "team", key: team.key, tab: "all" } },
    { label: "Cycles", to: { kind: "team-cycles", key: team.key } },
  ];
}

/* ═══ missing cycle ═══ */

function NoCycle({ team, number, cycles }: { team: Team; number: number | "current"; cycles: Cycle[] }) {
  const [busy, setBusy] = useState(false);
  const upcoming = cycles.filter((c) => cyclePhase(c) === "upcoming").sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];

  const create = async () => {
    setBusy(true);
    try {
      const c = await createNextCycle(team.id);
      if (c?.number) navigate({ kind: "cycle", key: team.key, number: c.number }, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  let body: JSX.Element;
  if (!team.cycles_enabled) {
    body = (
      <EmptyState
        icon={<RefreshCw size={28} strokeWidth={1.5} />}
        title={`Cycles are turned off for ${team.name}`}
        body="Turn on cycles to plan work in focused, repeating periods."
        action={<EnableCyclesButton team={team} />}
      />
    );
  } else if (number === "current") {
    body = (
      <EmptyState
        icon={<RefreshCw size={28} strokeWidth={1.5} />}
        title="No active cycle"
        body={upcoming
          ? `${cycleTitle(upcoming)} ${cycleTiming(upcoming).toLowerCase()} (${cycleRange(upcoming)}).`
          : `${team.name} has no cycle running right now. Start one to plan the next ${team.cycle_duration_weeks || 2} weeks.`}
        action={upcoming ? (
          <a {...linkProps({ kind: "cycle", key: team.key, number: upcoming.number })} className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink shadow-card hover:bg-accent-hover">
            View upcoming cycle <ArrowRight size={14} />
          </a>
        ) : (
          <Button variant="primary" size="md" icon={<Plus size={14} />} loading={busy} onClick={create}>Create cycle</Button>
        )}
      />
    );
  } else {
    body = (
      <EmptyState
        icon={<RefreshCw size={28} strokeWidth={1.5} />}
        title={`Cycle ${number} doesn’t exist`}
        body="It may have been deleted. You can look through the team’s cycles or start a new one."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <a {...linkProps({ kind: "team-cycles", key: team.key })} className="focus-ring inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink shadow-card hover:bg-wash">
              All cycles
            </a>
            <Button variant="primary" size="md" icon={<Plus size={14} />} loading={busy} onClick={create}>Create cycle</Button>
          </div>
        }
      />
    );
  }

  return (
    <>
      <ViewHeader crumbs={crumbsFor(team)} title={number === "current" ? "Current cycle" : `Cycle ${number}`} />
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </>
  );
}

/* ═══ cycle detail ═══ */

function CycleDetail({ team, cycle }: { team: Team; cycle: Cycle }) {
  const viewKey = `cycle:${cycle.id}`;
  const byCycle = useIssuesByCycle(team.id);
  const cycleIssues = byCycle.get(cycle.id) ?? EMPTY_ISSUES;
  const favorite = useSync((s) => Object.values(s.favorites).some((f) => f.kind === "cycle" && f.target_id === cycle.id && f.user_id === s.userId));
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);

  const scope = useCallback((i: Issue) => i.cycle_id === cycle.id, [cycle.id]);
  const query = useIssueQuery({ viewKey, scope, teamId: team.id, deps: [cycle.id] });
  const createDefaults = useMemo<Partial<Issue>>(() => ({ team_id: team.id, cycle_id: cycle.id }), [team.id, cycle.id]);
  const title = cycleTitle(cycle);

  const menu = (close: () => void) => (
    <ActionMenu
      onDone={close}
      items={[
        { id: "edit", label: "Edit name & dates", icon: <Pencil size={14} />, onSelect: () => setEditing(true) },
        ...(!cycle.completed_at
          ? [{ id: "complete", label: "Complete cycle", icon: <CircleCheck size={14} />, onSelect: () => setCompleting(true) }]
          : []),
        { id: "fav", label: favorite ? "Remove from favorites" : "Add to favorites", icon: <Star size={14} />, onSelect: () => toggleFavorite("cycle", cycle.id) },
        { id: "link", label: "Copy link", icon: <Link2 size={14} />, onSelect: () => copyText(`${window.location.origin}${hrefFor({ kind: "cycle", key: team.key, number: cycle.number })}`, "Link copied") },
        {
          id: "delete", label: "Delete cycle", icon: <Trash2 size={14} />, danger: true, divider: true,
          onSelect: () => confirmDeleteCycle(cycle, cycleIssues.length, () => navigate({ kind: "team-cycles", key: team.key })),
        },
      ]}
    />
  );

  return (
    <>
      <ViewHeader
        crumbs={crumbsFor(team)}
        title={title}
        actions={
          <>
            <span className="hidden sm:inline-flex">
              <IconButton label={favorite ? "Remove from favorites" : "Add to favorites"} active={favorite} onClick={() => toggleFavorite("cycle", cycle.id)}>
                <Star size={15} className={favorite ? "fill-current text-warning" : ""} />
              </IconButton>
            </span>
            <FilterButton viewKey={viewKey} teamId={team.id} />
            <DisplayMenu viewKey={viewKey} query={query} />
            {/* the edit popover anchors here once the menu that opened it has closed */}
            <span ref={moreRef} className="inline-flex">
              <Dropdown
                align="end"
                width={220}
                trigger={(p) => (
                  <IconButton
                    ref={p.ref}
                    onClick={p.onClick}
                    aria-expanded={p["aria-expanded"]}
                    active={p.open || editing}
                    size={30}
                    label="Cycle actions"
                    className="max-md:!h-8 max-md:!w-8"
                  >
                    <MoreHorizontal size={15} />
                  </IconButton>
                )}
              >
                {menu}
              </Dropdown>
            </span>
          </>
        }
        sub={<FilterBar viewKey={viewKey} query={query} />}
      />

      <CycleSummary cycle={cycle} issues={cycleIssues} />

      <div className="flex min-h-0 flex-1 flex-col">
        <IssuesSurface
          query={query}
          viewKey={viewKey}
          createDefaults={createDefaults}
          empty={
            <EmptyState
              icon={<RefreshCw size={28} strokeWidth={1.5} />}
              title={cycleIssues.length ? "No issues to show" : "This cycle has no issues yet"}
              body={cycleIssues.length
                ? "This cycle’s issues are hidden by the current display options — check Completed issues and Show sub-issues under Display."
                : "Add issues to the cycle from any issue’s Cycle property, or create one here."}
              action={!cycleIssues.length && !cycle.completed_at ? (
                <Button variant="primary" size="md" icon={<Plus size={14} />} onClick={() => ui.openCreateIssue(createDefaults)}>Create issue</Button>
              ) : undefined}
            />
          }
        />
      </div>

      <CycleEditPopover cycle={cycle} open={editing} anchor={moreRef.current} onClose={() => setEditing(false)} />
      <CompleteCycleModal cycle={cycle} team={team} issues={cycleIssues} open={completing} onClose={() => setCompleting(false)} />
    </>
  );
}
