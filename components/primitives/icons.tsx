"use client";
/* ─── Locus · domain icons (Linear-style status / priority glyphs) ─── */

import type { Health, Priority, ProjectStatus, StateType, Team } from "@/lib/types";
import { HEALTH_COLOR } from "@/lib/model";

/** Workflow state glyph. `fraction` fills "started" states (0..1). */
export function StateIcon({
  type, color, size = 14, fraction = 0.5, className,
}: { type: StateType; color: string; size?: number; fraction?: number; className?: string }) {
  const r = 6;
  const c = 7;
  const common = { width: size, height: size, viewBox: "0 0 14 14", className, "aria-hidden": true } as const;
  switch (type) {
    case "backlog":
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="1.4 1.74" />
        </svg>
      );
    case "unstarted":
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="1.5" />
        </svg>
      );
    case "started": {
      const f = Math.min(0.95, Math.max(0.1, fraction));
      const pr = 2.6;
      const circ = 2 * Math.PI * pr;
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="1.5" />
          <circle
            cx={c} cy={c} r={pr} fill="none" stroke={color} strokeWidth={pr * 2}
            strokeDasharray={`${circ * f} ${circ}`} transform={`rotate(-90 ${c} ${c})`}
          />
        </svg>
      );
    }
    case "completed":
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r + 0.5} fill={color} />
          <path d="M4.3 7.2l1.9 1.9 3.6-3.9" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "canceled":
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r + 0.5} fill={color} />
          <path d="M4.9 4.9l4.2 4.2M9.1 4.9l-4.2 4.2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export function PriorityIcon({ priority, size = 14, className }: { priority: Priority; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", className, "aria-hidden": true } as const;
  if (priority === 1) {
    return (
      <svg {...common}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#f2994a" />
        <path d="M8 4.5v4.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="1.05" fill="#fff" />
      </svg>
    );
  }
  if (priority === 0) {
    return (
      <svg {...common}>
        {[2.5, 7, 11.5].map((x) => <rect key={x} x={x} y="7.25" width="2.6" height="1.5" rx="0.6" fill="currentColor" opacity="0.55" />)}
      </svg>
    );
  }
  const filled = priority === 2 ? 3 : priority === 3 ? 2 : 1;
  return (
    <svg {...common}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i} x={2 + i * 4.5} y={10 - i * 3.5} width="3" height={4 + i * 3.5} rx="1"
          fill="currentColor" opacity={i < filled ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}

const PROJECT_STATE: Record<ProjectStatus, { type: StateType; color: string; fraction?: number }> = {
  backlog: { type: "backlog", color: "#bec2c8" },
  planned: { type: "unstarted", color: "#a3a7b0" },
  started: { type: "started", color: "#f2c94c", fraction: 0.5 },
  paused: { type: "started", color: "#95a2b3", fraction: 0.25 },
  completed: { type: "completed", color: "#5e6ad2" },
  canceled: { type: "canceled", color: "#95a2b3" },
};

export function ProjectStatusIcon({ status, size = 14 }: { status: ProjectStatus; size?: number }) {
  const m = PROJECT_STATE[status];
  return <StateIcon type={m.type} color={m.color} fraction={m.fraction} size={size} />;
}

export function HealthDot({ health, size = 8 }: { health: Health | null; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: health ? HEALTH_COLOR[health] : "var(--line-strong)" }}
    />
  );
}

export function LabelDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />;
}

export function TeamIcon({ team, size = 18 }: { team: Pick<Team, "key" | "color" | "icon"> | undefined; size?: number }) {
  if (!team) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white"
      style={{ width: size, height: size, fontSize: team.icon ? size * 0.62 : size * 0.48, background: team.icon ? "transparent" : team.color }}
    >
      {team.icon || team.key.slice(0, 1)}
    </span>
  );
}

/** Project glyph: emoji icon, or a colored rounded square. */
export function ProjectIcon({ icon, color, size = 14 }: { icon: string | null; color: string; size?: number }) {
  if (icon) return <span className="inline-flex shrink-0 items-center justify-center leading-none" style={{ width: size, height: size, fontSize: size * 0.9 }}>{icon}</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <rect x="1.5" y="1.5" width="11" height="11" rx="3" fill="none" stroke={color} strokeWidth="1.6" />
      <rect x="4.3" y="4.3" width="5.4" height="5.4" rx="1.4" fill={color} />
    </svg>
  );
}

/** Small circular progress ring (cycles, projects). */
export function ProgressRing({ value, size = 14, color = "var(--accent)" }: { value: number; size?: number; color?: string }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth="1.8" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="1.8" strokeDasharray={`${c * Math.min(1, Math.max(0, value))} ${c}`} strokeLinecap="round" />
    </svg>
  );
}

export function LocusMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <circle cx="12" cy="12" r="6.2" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.2" fill="#fff" />
    </svg>
  );
}
