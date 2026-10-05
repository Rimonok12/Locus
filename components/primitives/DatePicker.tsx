"use client";
/* ─── Locus · month calendar date picker ─── */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { localToday } from "@/lib/format";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function DatePicker({
  value, onChange, min, highlight,
}: {
  value: string | null;
  onChange: (date: string) => void;
  min?: string;
  /** optional inclusive range to tint (e.g. cycle span) */
  highlight?: { from: string; to: string };
}) {
  const today = localToday();
  const base = value ?? today;
  const [cursor, setCursor] = useState(() => ({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 }));
  const first = new Date(cursor.y, cursor.m, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const shift = (d: number) =>
    setCursor((c) => {
      const m = c.m + d;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[13px] font-medium text-ink">{MONTHS[cursor.m]} {cursor.y}</span>
        <span className="flex gap-0.5">
          <button aria-label="Previous month" onClick={() => shift(-1)} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-wash hover:text-ink"><ChevronLeft size={14} /></button>
          <button aria-label="Next month" onClick={() => shift(1)} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-wash hover:text-ink"><ChevronRight size={14} /></button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w) => <span key={w} className="py-1 text-[10.5px] font-medium text-faint">{w}</span>)}
        {cells.map((d, i) => {
          if (d == null) return <span key={i} />;
          const date = iso(cursor.y, cursor.m, d);
          const selected = date === value;
          const isToday = date === today;
          const disabled = Boolean(min && date < min);
          const inRange = highlight && date >= highlight.from && date <= highlight.to;
          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => onChange(date)}
              className={`h-7 rounded-md text-[12px] transition-colors disabled:opacity-30 ${
                selected ? "bg-accent font-semibold text-accent-ink" : inRange ? "bg-accent-soft text-ink" : "text-ink hover:bg-wash"
              } ${isToday && !selected ? "font-semibold text-accent" : ""}`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
