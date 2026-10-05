"use client";
/* ─── Locus · shared UI atoms: icons, avatar, popover menu ─── */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Circle, CircleDashed, CircleDot, Eye, CheckCircle2, XCircle,
  SignalHigh, SignalMedium, SignalLow, AlertTriangle, Minus,
} from "lucide-react";
import type { Priority, StatusId } from "@/lib/data";

/* status icon — categorical colors kept consistent across the app */
export function StatusIcon({ status, size = 14 }: { status: StatusId; size?: number }) {
  const common = { size, strokeWidth: 2 } as const;
  switch (status) {
    case "backlog": return <CircleDashed {...common} className="text-faint" />;
    case "todo": return <Circle {...common} className="text-dim" />;
    case "in_progress": return <CircleDot {...common} style={{ color: "#f0a000" }} />;
    case "in_review": return <Eye {...common} style={{ color: "#8b5cf6" }} />;
    case "done": return <CheckCircle2 {...common} style={{ color: "#30a46c" }} />;
    case "canceled": return <XCircle {...common} className="text-faint" />;
  }
}

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const common = { size, strokeWidth: 2.2 } as const;
  switch (priority) {
    case 1: return <AlertTriangle {...common} style={{ color: "#e5484d" }} />;
    case 2: return <SignalHigh {...common} className="text-ink" />;
    case 3: return <SignalMedium {...common} className="text-dim" />;
    case 4: return <SignalLow {...common} className="text-faint" />;
    default: return <Minus {...common} className="text-faint" />;
  }
}

export function Avatar({ name, initials, hue, size = 18 }: { name?: string; initials: string; hue: number; size?: number }) {
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size, height: size, fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${hue} 55% 52%), hsl(${hue + 24} 60% 40%))`,
      }}
    >
      {initials}
    </span>
  );
}

export function LabelDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export function Chip({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`focus-ring inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xxs font-medium transition-colors ${
        active ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-dim hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/* ─── generic popover menu ─── */
export function Menu<T>({
  button, items, onPick, render, width = 220, align = "left",
}: {
  button: ReactNode;
  items: T[];
  onPick: (item: T) => void;
  render: (item: T) => ReactNode;
  width?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <span onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>{button}</span>
      {open && (
        <div
          className="pop absolute z-50 mt-1 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop"
          style={{ width, [align]: 0 } as React.CSSProperties}
        >
          {items.map((item, i) => (
            <button
              key={i}
              className="row-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink"
              onClick={(e) => { e.stopPropagation(); onPick(item); setOpen(false); }}
            >
              {render(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const timeAgo = (t: number) => {
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
};
