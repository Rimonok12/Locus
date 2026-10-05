"use client";
/* ─── Locus · Inbox, Projects, Cycles views ─── */

import { CheckCheck, Dot } from "lucide-react";
import { CYCLES, PROJECTS, TEAMS } from "@/lib/data";
import { teamById, useLocus, userById } from "@/lib/store";
import { Avatar, StatusIcon, timeAgo } from "./ui";

/* ── Inbox ── */
export function InboxView() {
  const { notifications, markNotification, markAllRead, issues, select, setView } = useLocus();
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-xxs text-faint">{notifications.filter((n) => !n.read).length} unread</span>
        <button onClick={markAllRead} className="focus-ring flex items-center gap-1.5 rounded-md px-2 py-1 text-xxs font-medium text-dim hover:bg-wash hover:text-ink">
          <CheckCheck size={13} /> Mark all read
        </button>
      </div>
      {notifications.map((n) => {
        const issue = issues.find((i) => i.id === n.issueId);
        return (
          <button
            key={n.id}
            onClick={() => {
              markNotification(n.id, true);
              if (issue) { setView("issues", issue.teamId); select(issue.id); }
            }}
            className="row-hover flex w-full items-start gap-2 border-b border-line/60 px-4 py-3 text-left"
          >
            <Dot size={22} className={n.read ? "invisible" : "text-accent"} strokeWidth={6} />
            <div className="min-w-0 flex-1">
              <p className={`text-[12.5px] leading-snug ${n.read ? "text-dim" : "font-medium text-ink"}`}>{n.text}</p>
              {issue && <p className="mt-0.5 flex items-center gap-1.5 text-xxs text-faint"><StatusIcon status={issue.status} size={11} /> {issue.title}</p>}
            </div>
            <span className="shrink-0 text-xxs text-faint">{timeAgo(n.at)}</span>
          </button>
        );
      })}
      {notifications.length === 0 && <p className="p-8 text-center text-[12.5px] text-faint">Inbox zero. Nice.</p>}
    </div>
  );
}

/* ── Projects ── */
const HEALTH: Record<string, { label: string; color: string }> = {
  on_track: { label: "On track", color: "#30a46c" },
  at_risk: { label: "At risk", color: "#f0a000" },
  off_track: { label: "Off track", color: "#e5484d" },
};
const PSTATUS: Record<string, string> = { planned: "Planned", in_progress: "In Progress", paused: "Paused", completed: "Completed" };

export function ProjectsView() {
  const { issues } = useLocus();
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PROJECTS.map((p) => {
          const scoped = issues.filter((i) => i.projectId === p.id);
          const done = scoped.filter((i) => i.status === "done").length;
          const pct = scoped.length ? Math.round((done / scoped.length) * 100) : 0;
          const lead = userById(p.leadId)!;
          const h = HEALTH[p.health];
          return (
            <article key={p.id} className="pop rounded-xl border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-pop">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px]" style={{ background: p.color + "22", color: p.color }}>{p.glyph}</span>
                <div className="min-w-0">
                  <h3 className="truncate text-[13.5px] font-semibold text-ink">{p.name}</h3>
                  <p className="text-xxs text-faint">{PSTATUS[p.status]} · target {p.targetDate}</p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xxs font-medium" style={{ color: h.color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.color }} /> {h.label}
                </span>
              </div>
              <p className="mb-3 line-clamp-2 min-h-[32px] text-[12px] leading-snug text-dim">{p.summary}</p>
              <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-wash">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: p.color }} />
              </div>
              <div className="flex items-center text-xxs text-faint">
                <span>{done}/{scoped.length} issues · {pct}%</span>
                <span className="ml-auto flex items-center gap-1.5">Lead <Avatar initials={lead.initials} hue={lead.hue} size={16} name={lead.name} /></span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ── Cycles ── */
export function CyclesView() {
  const { issues } = useLocus();
  const today = Date.now();
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-3">
        {CYCLES.map((c) => {
          const team = teamById(c.teamId);
          const scoped = issues.filter((i) => i.cycleId === c.id);
          const done = scoped.filter((i) => i.status === "done").length;
          const started = scoped.filter((i) => i.status === "in_progress" || i.status === "in_review").length;
          const pct = scoped.length ? Math.round((done / scoped.length) * 100) : 0;
          const start = new Date(c.start + "T00:00:00").getTime();
          const end = new Date(c.end + "T23:59:59").getTime();
          const active = today >= start && today <= end;
          const points = scoped.reduce((a, i) => a + (i.estimate ?? 0), 0);
          return (
            <article key={c.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold text-white" style={{ background: `hsl(${team.hue} 48% 48%)` }}>{team.key[0]}</span>
                <h3 className="text-[13.5px] font-semibold">{team.name} · Cycle {c.number}</h3>
                {active && <span className="rounded-full bg-accent px-2 py-0.5 text-xxs font-semibold text-accent-ink">Active</span>}
                <span className="ml-auto text-xxs text-faint">{c.start} → {c.end} · {points} pts</span>
              </div>
              <div className="mb-1.5 flex h-2 overflow-hidden rounded-full bg-wash">
                <div style={{ width: `${pct}%`, background: "#30a46c" }} />
                <div style={{ width: `${scoped.length ? (started / scoped.length) * 100 : 0}%`, background: "#f0a000" }} />
              </div>
              <p className="text-xxs text-faint">{done} done · {started} started · {scoped.length - done - started} open — {pct}% complete</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
