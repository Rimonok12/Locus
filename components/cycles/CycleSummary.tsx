"use client";
/* ─── Locus · collapsible cycle summary: dates, progress, stats, burn-up ─── */

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { STATE_TYPE_COLOR, progressOf } from "@/lib/model";
import { ProgressBar } from "@/components/primitives/controls";
import { readPref, writePref } from "@/components/inbox/hooks";
import type { Cycle, Issue } from "@/lib/types";
import BurnupChart from "./BurnupChart";
import { cycleRange, cycleStats, cycleTiming, pct } from "./util";

const PREF = "locus:cycle-summary-open";

export default function CycleSummary({ cycle, issues }: { cycle: Cycle; issues: Issue[] }) {
  const states = useSync((s) => s.workflow_states);
  const stats = useMemo(() => cycleStats(issues, states), [issues, states]);
  const progress = useMemo(() => progressOf(issues, states), [issues, states]);
  const [open, setOpen] = useState(() => readPref<boolean>(PREF, typeof window !== "undefined" && window.innerWidth >= 768));
  const toggle = () => setOpen((v) => { writePref(PREF, !v); return !v; });
  const percent = Math.round(progress.ratio * 100);

  return (
    <section className="shrink-0 border-b border-line bg-canvas">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2.5 px-4 text-left transition-colors hover:bg-wash md:min-h-[40px] md:px-6"
      >
        <ChevronRight size={14} className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 truncate text-[12.5px] tabular-nums text-dim">{cycleRange(cycle)}</span>
        <span className="text-faint">·</span>
        <span className="shrink-0 text-[12.5px] text-ink">{cycleTiming(cycle)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          <ProgressBar value={progress.ratio} className="hidden w-28 sm:block md:w-40" />
          <span className="text-[12.5px] tabular-nums text-dim">{percent}%</span>
        </span>
      </button>

      {open && (
        <div className="anim-fade grid gap-4 px-4 pb-4 pt-1 md:grid-cols-[minmax(200px,260px)_minmax(0,1fr)] md:gap-6 md:px-6">
          <div className="grid grid-cols-3 gap-2 md:grid-cols-1">
            <Stat color="var(--faint)" label="Scope" count={stats.count} pts={stats.scope} />
            <Stat color={STATE_TYPE_COLOR.started} label="Started" count={stats.startedCount} pts={stats.startedPts} percent={pct(stats.startedPts, stats.scope)} />
            <Stat color="var(--accent)" label="Completed" count={stats.doneCount} pts={stats.donePts} percent={pct(stats.donePts, stats.scope)} />
          </div>
          <div className="min-w-0 rounded-lg border border-line bg-surface px-3 pb-2.5 pt-3 shadow-card">
            <BurnupChart cycle={cycle} issues={issues} />
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ color, label, count, pts, percent }: { color: string; label: string; count: number; pts: number; percent?: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 shadow-card">
      <div className="flex items-center gap-1.5 text-xxs font-medium text-dim">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate">{label}</span>
        {percent != null && <span className="ml-auto tabular-nums text-faint">{percent}%</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
        <span className="text-[15px] font-semibold text-ink">{count}</span>
        <span className="text-[12px] text-faint">{count === 1 ? "issue" : "issues"}</span>
        <span className="text-[12px] text-faint">· {pts} pts</span>
      </div>
    </div>
  );
}
