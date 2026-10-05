"use client";
/* ─── Locus · "cycles are off" empty state + enable action ─── */

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast } from "@/lib/ui";
import { cyclePhase, todayISO } from "@/lib/model";
import { createCycle, createNextCycle, updateTeam } from "@/lib/sync/actions";
import { Button, EmptyState } from "@/components/primitives/controls";
import type { Team } from "@/lib/types";

/** Turn cycles on and make sure the team has a current and an upcoming cycle. */
export async function enableCycles(team: Team): Promise<boolean> {
  const ok = await updateTeam(team.id, { cycles_enabled: true });
  if (!ok) return false;
  const today = todayISO();
  const own = Object.values(useSync.getState().cycles).filter((c) => c.team_id === team.id);
  const hasCurrent = own.some((c) => cyclePhase(c, today) === "current");
  const firstUpcoming = own.filter((c) => cyclePhase(c, today) === "upcoming").sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];

  if (!hasCurrent && !firstUpcoming) {
    // nothing planned: this cycle (starting today) and the one after it
    const first = await createNextCycle(team.id);
    if (first) await createNextCycle(team.id);
  } else if (!hasCurrent && firstUpcoming) {
    // only future cycles: fill the gap from today up to the first of them
    if (firstUpcoming.starts_at > today) await createCycle(team.id, today, firstUpcoming.starts_at);
  } else if (!firstUpcoming) {
    await createNextCycle(team.id);
  }
  toast.success(`Cycles enabled for ${team.name}`);
  return true;
}

export function EnableCyclesButton({ team, size = "md" }: { team: Team; size?: "sm" | "md" }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      size={size}
      loading={busy}
      icon={<RefreshCw size={13} />}
      onClick={async () => {
        setBusy(true);
        try { await enableCycles(team); } finally { setBusy(false); }
      }}
    >
      Enable cycles
    </Button>
  );
}

export function CyclesDisabled({ team }: { team: Team }) {
  const weeks = team.cycle_duration_weeks || 2;
  return (
    <EmptyState
      icon={<RefreshCw size={28} strokeWidth={1.5} />}
      title={`Cycles are turned off for ${team.name}`}
      body={
        <>
          Cycles are focused, repeating {weeks}-week periods of work. Plan what fits, track progress on a burn-up chart,
          and carry unfinished work over when a cycle wraps up.
        </>
      }
      action={<EnableCyclesButton team={team} />}
    />
  );
}
