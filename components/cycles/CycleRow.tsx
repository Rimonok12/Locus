"use client";
/* ─── Locus · one row in a team's cycle list ─── */

import { memo, useMemo, useRef, useState } from "react";
import { ArrowUpRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { cyclePhase, progressOf } from "@/lib/model";
import { linkProps, navigate, type Route } from "@/lib/router";
import { IconButton } from "@/components/primitives/controls";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import { ProgressRing } from "@/components/primitives/icons";
import type { Cycle, Issue, Team } from "@/lib/types";
import CycleEditPopover from "./CycleEditPopover";
import PopFix from "@/components/inbox/PopFix";
import { confirmDeleteCycle, cycleRange, cycleTiming, cycleTitle } from "./util";

function CycleRowImpl({ cycle, team, issues }: { cycle: Cycle; team: Team; issues: Issue[]; /** clock tick */ tick?: number }) {
  const states = useSync((s) => s.workflow_states);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const phase = cyclePhase(cycle);
  const progress = useMemo(() => progressOf(issues, states), [issues, states]);
  const percent = Math.round(progress.ratio * 100);
  const title = cycleTitle(cycle);
  const to: Route | null = cycle.number ? { kind: "cycle", key: team.key, number: cycle.number } : null;
  const ringColor = phase === "past" ? (cycle.completed_at ? "var(--success)" : "var(--faint)") : "var(--accent)";
  const pinned = editing || menuOpen;

  return (
    <div className="group relative flex min-h-[52px] items-center gap-3 border-b border-line px-4 transition-colors hover:bg-wash md:h-10 md:min-h-0 md:px-6">
      {to && <a {...linkProps(to)} aria-label={title} className="focus-ring absolute inset-0" />}

      <span className="pointer-events-none flex w-4 shrink-0 justify-center">
        <ProgressRing value={phase === "upcoming" ? 0 : progress.ratio} size={15} color={ringColor} />
      </span>

      <div className="pointer-events-none min-w-0 flex-1 md:flex md:items-center md:gap-4">
        <div className="flex min-w-0 items-center gap-2 md:w-[200px] md:shrink-0 lg:w-[240px]">
          <span className={`truncate text-[13px] font-medium ${phase === "past" ? "text-dim" : "text-ink"}`}>{title}</span>
          {phase === "current" && (
            <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold text-accent">Current</span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-faint md:mt-0 md:text-[12.5px]">
          <span className="truncate tabular-nums text-dim">{cycleRange(cycle)}</span>
          <span>·</span>
          <span className={`truncate ${phase === "current" ? "text-ink" : ""}`}>{cycleTiming(cycle)}</span>
        </div>
      </div>

      <div className="pointer-events-none flex shrink-0 items-center gap-4 text-[12.5px] tabular-nums text-dim md:gap-6">
        <span className="w-[38px] text-right sm:w-[44px]" title={`${progress.done} of ${progress.total} issues completed`}>{percent}%</span>
        <span className="hidden w-[72px] text-right sm:block">{progress.total} issue{progress.total === 1 ? "" : "s"}</span>
        <span className="hidden w-[56px] text-right md:block" title="Scope in estimate points (unestimated issues count as 1)">{progress.scope} pts</span>
      </div>

      <div ref={moreRef} className="relative z-[1] shrink-0">
        <Dropdown
          align="end"
          width={200}
          onOpenChange={setMenuOpen}
          trigger={(p) => (
            <IconButton
              ref={p.ref}
              onClick={p.onClick}
              aria-expanded={p["aria-expanded"]}
              active={p.open}
              size={32}
              label="Cycle actions"
              className={pinned ? "" : "md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100 [@media(hover:none)]:opacity-100"}
            >
              <MoreHorizontal size={15} />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <PopFix />
              <ActionMenu
                onDone={close}
                items={[
                  ...(to ? [{ id: "open", label: "Open cycle", icon: <ArrowUpRight size={14} />, onSelect: () => navigate(to) }] : []),
                  { id: "edit", label: "Edit name & dates", icon: <Pencil size={14} />, onSelect: () => setEditing(true) },
                  { id: "delete", label: "Delete cycle", icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => confirmDeleteCycle(cycle, issues.length) },
                ]}
              />
            </>
          )}
        </Dropdown>
      </div>

      <CycleEditPopover cycle={cycle} open={editing} anchor={moreRef.current} onClose={() => setEditing(false)} />
    </div>
  );
}

const CycleRow = memo(CycleRowImpl);
export default CycleRow;
