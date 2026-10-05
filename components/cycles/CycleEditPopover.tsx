"use client";
/* ─── Locus · edit a cycle's name and dates (anchored popover) ─── */

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { updateCycle } from "@/lib/sync/actions";
import { addDaysISO, daysBetween, formatDate } from "@/lib/format";
import { Popover } from "@/components/primitives/overlay";
import { DatePicker } from "@/components/primitives/DatePicker";
import { Button, Input } from "@/components/primitives/controls";
import type { Cycle } from "@/lib/types";
import { cycleTitle } from "./util";
import PopFix from "@/components/inbox/PopFix";

export default function CycleEditPopover({
  cycle, open, anchor, onClose,
}: { cycle: Cycle; open: boolean; anchor: HTMLElement | null; onClose: () => void }) {
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} align="end" width={300}>
      {open && (
        <>
          <PopFix focus />
          <CycleEditForm cycle={cycle} onClose={onClose} />
        </>
      )}
    </Popover>
  );
}

function CycleEditForm({ cycle, onClose }: { cycle: Cycle; onClose: () => void }) {
  const durationWeeks = useSync((s) => s.teams[cycle.team_id]?.cycle_duration_weeks ?? 2);
  const allCycles = useSync((s) => s.cycles);
  const [name, setName] = useState(cycle.name);
  const [start, setStart] = useState(cycle.starts_at);
  const [end, setEnd] = useState(cycle.ends_at);
  const [field, setField] = useState<"start" | "end">("start");
  const [busy, setBusy] = useState(false);

  const invalid = end <= start;
  const overlap = useMemo(
    () => Object.values(allCycles).find((c) => c.team_id === cycle.team_id && c.id !== cycle.id && !c.completed_at && start < c.ends_at && end > c.starts_at),
    [allCycles, cycle.team_id, cycle.id, start, end],
  );
  const days = daysBetween(start, end);
  const dirty = name.trim() !== cycle.name || start !== cycle.starts_at || end !== cycle.ends_at;

  const pick = (d: string) => {
    if (field === "start") {
      setStart(d);
      if (end <= d) setEnd(addDaysISO(d, durationWeeks * 7));
      setField("end");
    } else {
      setEnd(d);
    }
  };

  const save = async () => {
    if (invalid || busy) return;
    if (!dirty) { onClose(); return; }
    setBusy(true);
    const ok = await updateCycle(cycle.id, { name: name.trim(), starts_at: start, ends_at: end });
    setBusy(false);
    if (ok) onClose();
  };

  const seg = (which: "start" | "end", label: string, value: string) => (
    <button
      type="button"
      onClick={() => setField(which)}
      className={`flex h-11 flex-col items-start justify-center rounded-md border px-2.5 text-left transition-colors ${
        field === which ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-wash"
      }`}
    >
      <span className="text-xxs font-medium text-faint">{label}</span>
      <span className="text-[12.5px] font-medium text-ink">{formatDate(value, true)}</span>
    </button>
  );

  return (
    <div className="p-3">
      <label className="block">
        <span className="mb-1.5 block text-xxs font-medium text-faint">Name</span>
        <Input
          autoFocus
          value={name}
          maxLength={80}
          placeholder={cycleTitle({ name: "", number: cycle.number })}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {seg("start", "Starts", start)}
        {seg("end", "Ends", end)}
      </div>

      <div className="mt-2 rounded-md border border-line p-2">
        <DatePicker
          key={field}
          value={field === "start" ? start : end}
          onChange={pick}
          min={field === "end" ? addDaysISO(start, 1) : undefined}
          highlight={invalid ? undefined : { from: start, to: end }}
        />
      </div>

      <div className="mt-2 min-h-[18px] text-xxs">
        {invalid ? (
          <span className="text-danger">The cycle must end after it starts.</span>
        ) : overlap ? (
          <span className="flex items-center gap-1 text-warning"><AlertTriangle size={12} />Overlaps {cycleTitle(overlap)} ({formatDate(overlap.starts_at)} → {formatDate(overlap.ends_at)})</span>
        ) : (
          <span className="text-faint">{days} day{days === 1 ? "" : "s"} · {Math.round((days / 7) * 10) / 10} week{days === 7 ? "" : "s"}</span>
        )}
      </div>

      <div className="mt-2 flex justify-end gap-1.5">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" loading={busy} disabled={invalid} onClick={save}>Save</Button>
      </div>
    </div>
  );
}
