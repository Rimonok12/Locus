"use client";
/* ─── Locus · complete a cycle and decide where unfinished issues go ─── */

import { useMemo, useState, type ReactNode } from "react";
import { CircleCheck, CircleSlash, Plus, RefreshCw } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast } from "@/lib/ui";
import { cyclePhase, progressOf, useTeamCycles } from "@/lib/model";
import { createNextCycle, rolloverCycle, updateCycle } from "@/lib/sync/actions";
import { Modal } from "@/components/primitives/overlay";
import { Button } from "@/components/primitives/controls";
import type { Cycle, Issue, Team } from "@/lib/types";
import { cycleRange, cycleTitle } from "./util";

type Choice = "next" | "new" | "none";

export default function CompleteCycleModal({
  cycle, team, issues, open, onClose,
}: { cycle: Cycle; team: Team; issues: Issue[]; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} width={480} label={`Complete ${cycleTitle(cycle)}`}>
      {open && <CompleteForm cycle={cycle} team={team} issues={issues} onClose={onClose} />}
    </Modal>
  );
}

function CompleteForm({ cycle, team, issues, onClose }: { cycle: Cycle; team: Team; issues: Issue[]; onClose: () => void }) {
  const states = useSync((s) => s.workflow_states);
  const cycles = useTeamCycles(team.id);
  const next = useMemo(
    () => cycles.filter((c) => c.id !== cycle.id && cyclePhase(c) === "upcoming").sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0],
    [cycles, cycle.id],
  );
  /* canceled issues neither count as done nor carry over (same rule as progressOf / rolloverCycle) */
  const { total, done } = useMemo(() => progressOf(issues, states), [issues, states]);
  const unfinished = total - done;
  const [choice, setChoice] = useState<Choice>(next ? "next" : "new");
  const [busy, setBusy] = useState(false);

  const complete = async () => {
    setBusy(true);
    try {
      let target: string | null = null;
      if (unfinished) {
        if (choice === "next" && next) target = next.id;
        else if (choice === "new") {
          const created = await createNextCycle(team.id);
          if (!created) return;
          target = created.id;
        }
      }
      const moved = unfinished ? rolloverCycle(cycle.id, target) : 0;
      const ok = await updateCycle(cycle.id, { completed_at: new Date().toISOString() });
      if (!ok) return;
      const targetName = target ? cycleTitle(useSync.getState().cycles[target] ?? { name: "", number: 0 }) : null;
      toast.success(
        moved
          ? `Completed ${cycleTitle(cycle)} · moved ${moved} issue${moved === 1 ? "" : "s"} ${targetName ? `to ${targetName}` : "out of the cycle"}`
          : `Completed ${cycleTitle(cycle)}`,
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="px-5 pb-1 pt-5">
        <h2 className="text-[15px] font-semibold text-ink">Complete {cycleTitle(cycle)}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
          {cycleRange(cycle)} · {done} of {total} issue{total === 1 ? "" : "s"} completed.{" "}
          {unfinished
            ? <>Choose where the <span className="font-medium text-ink">{unfinished} unfinished issue{unfinished === 1 ? "" : "s"}</span> should go.</>
            : "Every issue in this cycle is finished."}
        </p>
      </div>

      {unfinished > 0 && (
        <div role="radiogroup" aria-label="Unfinished issues" className="space-y-1.5 px-5 pt-3">
          {next ? (
            <Option
              checked={choice === "next"}
              onSelect={() => setChoice("next")}
              icon={<RefreshCw size={14} />}
              title={`Move to ${cycleTitle(next)}`}
              detail={`The next cycle · ${cycleRange(next)}`}
            />
          ) : (
            <Option
              checked={choice === "new"}
              onSelect={() => setChoice("new")}
              icon={<Plus size={14} />}
              title="Move to a new cycle"
              detail={`Creates the next ${team.cycle_duration_weeks || 2}-week cycle and moves them there`}
            />
          )}
          <Option
            checked={choice === "none"}
            onSelect={() => setChoice("none")}
            icon={<CircleSlash size={14} />}
            title="Remove from cycle"
            detail="Unfinished issues keep their status but leave the cycle"
          />
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" autoFocus loading={busy} icon={<CircleCheck size={14} />} onClick={complete}>
          Complete cycle
        </Button>
      </div>
    </div>
  );
}

function Option({ checked, onSelect, icon, title, detail }: { checked: boolean; onSelect: () => void; icon: ReactNode; title: string; detail: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`focus-ring flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        checked ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-wash"
      }`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${checked ? "bg-accent text-accent-ink" : "bg-raised text-dim"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[12px] text-dim">{detail}</span>
      </span>
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${checked ? "border-accent" : "border-line-strong"}`}>
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
    </button>
  );
}
