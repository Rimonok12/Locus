"use client";
/* ─── Locus · cycle burn-up chart (pure responsive SVG) ──────────────────────
   x = each day from starts_at to ends_at · y = estimate points (1 per
   unestimated issue). Scope grows as issues are created; Started and
   Completed accumulate from started_at / completed_at. Canceled issues are
   excluded. Lines stop at today; a dashed marker shows today.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSync } from "@/lib/sync/store";
import { STATE_TYPE_COLOR } from "@/lib/model";
import { addDaysISO, daysBetween, formatDate, localToday } from "@/lib/format";
import { useElementWidth } from "@/components/inbox/hooks";
import type { Cycle, Issue } from "@/lib/types";

const H = 168;
const PAD = { l: 30, r: 12, t: 14, b: 22 };
const MAX_DAYS = 366;

const SCOPE = "var(--faint)";
const STARTED = STATE_TYPE_COLOR.started;
const DONE = "var(--accent)";

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  if (v <= 6) return 6;
  if (v <= 8) return 8;
  if (v <= 10) return 10;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 4, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

export default function BurnupChart({ cycle, issues }: { cycle: Cycle; issues: Issue[] }) {
  const states = useSync((s) => s.workflow_states);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // touch: pointerleave fires right after the tap, so keep the readout up for a moment instead
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (touchTimer.current) clearTimeout(touchTimer.current); }, []);

  const data = useMemo(() => {
    const n = Math.min(MAX_DAYS, Math.max(1, daysBetween(cycle.starts_at, cycle.ends_at)));
    const days = Array.from({ length: n + 1 }, (_, i) => addDaysISO(cycle.starts_at, i));
    const scopeAdd = new Array<number>(n + 1).fill(0);
    const startAdd = new Array<number>(n + 1).fill(0);
    const doneAdd = new Array<number>(n + 1).fill(0);
    const at = (iso: string) => Math.min(n, Math.max(0, daysBetween(cycle.starts_at, localDay(iso))));

    for (const i of issues) {
      const type = states[i.state_id]?.type;
      if (!type || type === "canceled") continue;
      const pts = i.estimate ?? 1;
      scopeAdd[at(i.created_at)] += pts;
      if (type === "completed") {
        const doneAt = i.completed_at ?? i.updated_at;
        doneAdd[at(doneAt)] += pts;
        startAdd[at(i.started_at ?? doneAt)] += pts;
      } else if (type === "started") {
        startAdd[at(i.started_at ?? i.updated_at)] += pts;
      }
    }
    const cum = (arr: number[]) => { let t = 0; return arr.map((v) => (t += v)); };
    const scope = cum(scopeAdd);
    const started = cum(startAdd);
    const done = cum(doneAdd);

    const today = localToday();
    const todayIdx = daysBetween(cycle.starts_at, today);
    const endIdx = cycle.completed_at ? Math.min(n, Math.max(0, daysBetween(cycle.starts_at, localDay(cycle.completed_at)))) : Math.min(n, todayIdx);
    return { n, days, scope, started, done, todayIdx, last: endIdx, maxY: niceMax(Math.max(1, ...scope)) };
  }, [cycle.starts_at, cycle.ends_at, cycle.completed_at, issues, states]);

  const iw = Math.max(1, width - PAD.l - PAD.r);
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / data.n) * iw;
  const y = (v: number) => PAD.t + ih - (v / data.maxY) * ih;

  const path = (arr: number[]) => {
    if (data.last < 0) return "";
    let d = "";
    for (let i = 0; i <= data.last; i++) d += `${i ? "L" : "M"}${x(i).toFixed(1)},${y(arr[i]).toFixed(1)}`;
    // a single point still deserves a visible stub
    if (data.last === 0) d += `L${(x(0) + 2).toFixed(1)},${y(arr[0]).toFixed(1)}`;
    return d;
  };
  const doneArea = data.last >= 0 ? `${path(data.done)}L${x(data.last).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z` : "";

  const labelEvery = Math.max(1, Math.ceil(data.n / Math.max(2, Math.floor(iw / 64))));
  const xLabels: number[] = [];
  for (let i = 0; i <= data.n; i += labelEvery) xLabels.push(i);
  if (xLabels[xLabels.length - 1] !== data.n) {
    if (data.n - xLabels[xLabels.length - 1] < labelEvery / 2 && xLabels.length > 1) xLabels.pop();
    xLabels.push(data.n);
  }
  const showToday = !cycle.completed_at && data.todayIdx >= 0 && data.todayIdx <= data.n;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (touchTimer.current) { clearTimeout(touchTimer.current); touchTimer.current = null; }
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - PAD.l) / iw) * data.n);
    setHover(Math.min(data.n, Math.max(0, i)));
  };

  const hv = hover != null && hover <= data.last ? hover : null;
  const tipLeft = hover != null ? Math.min(Math.max(x(hover) - 70, 0), Math.max(0, width - 140)) : 0;

  return (
    <div className="min-w-0">
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            className="block touch-pan-y select-none"
            role="img"
            aria-label={`Burn-up chart: ${data.done[Math.max(0, data.last)] ?? 0} of ${data.scope[Math.max(0, data.last)] ?? 0} points completed`}
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") { setHover(null); return; }
              if (touchTimer.current) clearTimeout(touchTimer.current);
              touchTimer.current = setTimeout(() => { touchTimer.current = null; setHover(null); }, 2500);
            }}
          >
            {/* grid */}
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y(data.maxY * f)} y2={y(data.maxY * f)} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.l - 6} y={y(data.maxY * f) + 3.5} textAnchor="end" fontSize={10} fill="var(--faint)" className="tabular-nums">
                  {Math.round(data.maxY * f)}
                </text>
              </g>
            ))}
            {xLabels.map((i, k) => (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                fontSize={10}
                fill="var(--faint)"
                textAnchor={k === 0 ? "start" : i === data.n ? "end" : "middle"}
              >
                {formatDate(data.days[i])}
              </text>
            ))}

            {/* today */}
            {showToday && (
              <g>
                <line x1={x(data.todayIdx)} x2={x(data.todayIdx)} y1={PAD.t - 4} y2={PAD.t + ih} stroke="var(--line-strong)" strokeDasharray="3 3" />
                <text x={x(data.todayIdx) + (data.todayIdx > data.n * 0.85 ? -4 : 4)} y={PAD.t + 2} fontSize={10} fill="var(--dim)" textAnchor={data.todayIdx > data.n * 0.85 ? "end" : "start"}>
                  Today
                </text>
              </g>
            )}

            {data.last >= 0 ? (
              <>
                <path d={doneArea} fill="var(--accent-soft)" stroke="none" />
                <path d={path(data.scope)} fill="none" stroke={SCOPE} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                <path d={path(data.started)} fill="none" stroke={STARTED} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                <path d={path(data.done)} fill="none" stroke={DONE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </>
            ) : (
              <text x={PAD.l + iw / 2} y={PAD.t + ih / 2} textAnchor="middle" fontSize={11.5} fill="var(--faint)">
                Starts {formatDate(cycle.starts_at)}
              </text>
            )}

            {/* hover guide */}
            {hover != null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--line-strong)" />
                {hv != null && (
                  <>
                    <circle cx={x(hv)} cy={y(data.scope[hv])} r={3} fill="var(--surface)" stroke={SCOPE} strokeWidth={1.5} />
                    <circle cx={x(hv)} cy={y(data.started[hv])} r={3} fill="var(--surface)" stroke={STARTED} strokeWidth={1.5} />
                    <circle cx={x(hv)} cy={y(data.done[hv])} r={3.5} fill="var(--surface)" stroke={DONE} strokeWidth={2} />
                  </>
                )}
              </g>
            )}
          </svg>
        )}

        {hover != null && width > 0 && (
          <div
            className="anim-fade pointer-events-none absolute top-0 z-[1] w-[140px] rounded-md bg-surface px-2.5 py-2 text-xxs shadow-pop"
            style={{ left: tipLeft }}
          >
            <div className="mb-1 font-medium text-ink">{formatDate(data.days[hover], true)}</div>
            {hv != null ? (
              <div className="space-y-0.5 tabular-nums">
                <Row color={SCOPE} label="Scope" value={data.scope[hv]} />
                <Row color={STARTED} label="Started" value={data.started[hv]} />
                <Row color={DONE} label="Completed" value={data.done[hv]} />
              </div>
            ) : (
              <div className="text-faint">{data.last < 0 ? "The cycle hasn’t started yet" : "Still ahead"}</div>
            )}
          </div>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pl-[30px] text-xxs text-dim">
        <Legend color={SCOPE} label="Scope" />
        <Legend color={STARTED} label="Started" />
        <Legend color={DONE} label="Completed" />
      </div>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5 text-dim">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex-1">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-[3px] w-3 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
