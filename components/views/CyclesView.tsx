"use client";
/* ─── Locus · a team's cycles: current / upcoming / past ─── */

import { useMemo, useState } from "react";
import { ChevronDown, Plus, RefreshCw } from "lucide-react";
import { toast } from "@/lib/ui";
import { cyclePhase, useTeamCycles } from "@/lib/model";
import { createNextCycle } from "@/lib/sync/actions";
import { ViewHeader } from "@/components/app/Header";
import NotFound from "@/components/app/NotFound";
import { useRoutedTeam } from "@/components/issues/shared";
import { Button, EmptyState, Tooltip } from "@/components/primitives/controls";
import { TeamIcon } from "@/components/primitives/icons";
import CycleRow from "@/components/cycles/CycleRow";
import { CyclesDisabled } from "@/components/cycles/EnableCycles";
import { EMPTY_ISSUES, cycleTitle, useIssuesByCycle } from "@/components/cycles/util";
import { useNow } from "@/components/inbox/hooks";
import type { Cycle, Issue, Team } from "@/lib/types";

export default function CyclesView({ teamKey }: { teamKey: string }) {
  // pinned by id: a key rename while open swaps the URL instead of flipping to "not found"
  const team = useRoutedTeam(teamKey, (key) => ({ kind: "team-cycles", key }));
  if (!team) return <NotFound what="team" />;
  return <TeamCycles team={team} />;
}

function TeamCycles({ team }: { team: Team }) {
  const cycles = useTeamCycles(team.id);
  const byCycle = useIssuesByCycle(team.id);
  const now = useNow(5 * 60_000);
  const [creating, setCreating] = useState(false);

  const sections = useMemo(() => {
    const current: Cycle[] = [];
    const upcoming: Cycle[] = [];
    const past: Cycle[] = [];
    for (const c of cycles) {
      const phase = cyclePhase(c);
      (phase === "current" ? current : phase === "upcoming" ? upcoming : past).push(c);
    }
    current.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    upcoming.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    past.sort((a, b) => b.ends_at.localeCompare(a.ends_at) || (b.number ?? 0) - (a.number ?? 0));
    return [
      { id: "current", label: "Current", cycles: current },
      { id: "upcoming", label: "Upcoming", cycles: upcoming },
      { id: "past", label: "Past", cycles: past },
    ].filter((s) => s.cycles.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycles, now]);

  const create = async () => {
    setCreating(true);
    try {
      const c = await createNextCycle(team.id);
      if (c) toast.success(`Created ${cycleTitle(c)}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <ViewHeader
        crumbs={[{
          label: <span className="hidden sm:inline">{team.name}</span>,
          icon: <TeamIcon team={team} size={16} />,
          to: { kind: "team", key: team.key, tab: "all" },
        }]}
        title="Cycles"
        actions={
          team.cycles_enabled ? (
            <Tooltip label={`Adds a ${team.cycle_duration_weeks || 2}-week cycle after the latest one`}>
              <Button variant="secondary" size="sm" icon={<Plus size={14} />} loading={creating} onClick={create} className="max-md:h-8">
                New cycle
              </Button>
            </Tooltip>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!team.cycles_enabled ? (
          <CyclesDisabled team={team} />
        ) : !sections.length ? (
          <EmptyState
            icon={<RefreshCw size={28} strokeWidth={1.5} />}
            title="No cycles yet"
            body={`Create the first ${team.cycle_duration_weeks || 2}-week cycle for ${team.name} and start planning what fits in it.`}
            action={<Button variant="primary" size="md" icon={<Plus size={14} />} loading={creating} onClick={create}>Create cycle</Button>}
          />
        ) : (
          sections.map((s) => <Section key={s.id} label={s.label} cycles={s.cycles} team={team} byCycle={byCycle} tick={now} collapsible={s.id === "past"} />)
        )}
      </div>
    </>
  );
}

function Section({
  label, cycles, team, byCycle, tick, collapsible,
}: { label: string; cycles: Cycle[]; team: Team; byCycle: Map<string, Issue[]>; tick: number; collapsible: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <h2 className="sticky top-0 z-[2] flex h-9 items-center border-b border-line bg-raised px-4 md:px-6">
        <button
          type="button"
          disabled={!collapsible}
          onClick={() => setOpen(!open)}
          className="-ml-1 flex h-7 items-center gap-1.5 rounded px-1 text-[12.5px] font-medium text-ink enabled:hover:bg-wash"
        >
          {collapsible && <ChevronDown size={13} className={`text-faint transition-transform ${open ? "" : "-rotate-90"}`} />}
          {label}
          <span className="tabular-nums text-faint">{cycles.length}</span>
        </button>
        <span className="ml-auto hidden items-center gap-3 text-xxs text-faint sm:flex">
          <span className="flex gap-4 md:gap-6">
            <span className="w-[44px] text-right">Progress</span>
            <span className="w-[72px] text-right">Issues</span>
            <span className="hidden w-[56px] text-right md:block">Scope</span>
          </span>
          <span className="w-[30px]" />
        </span>
      </h2>
      {open && cycles.map((c) => <CycleRow key={c.id} cycle={c} team={team} issues={byCycle.get(c.id) ?? EMPTY_ISSUES} tick={tick} />)}
    </section>
  );
}
