"use client";
/* ─── Locus · one issue_history row as a compact activity sentence ─── */

import { Fragment, memo, useMemo, type ReactNode } from "react";
import { useSync } from "@/lib/sync/store";
import { PRIORITY_LABEL, cycleName, displayName, issueKey } from "@/lib/model";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { linkProps } from "@/lib/router";
import { StateGlyph } from "@/components/pickers";
import { Avatar } from "@/components/primitives/Avatar";
import { LabelDot, PriorityIcon, ProjectIcon, TeamIcon } from "@/components/primitives/icons";
import type { HistoryEntry, Priority } from "@/lib/types";

export function useHistoryCtx() {
  const states = useSync((s) => s.workflow_states);
  const profiles = useSync((s) => s.profiles);
  const labels = useSync((s) => s.labels);
  const projects = useSync((s) => s.projects);
  const cycles = useSync((s) => s.cycles);
  const teams = useSync((s) => s.teams);
  // deliberately not the issues map: it changes on every issue write (parent refs subscribe on their own)
  return useMemo(() => ({ states, profiles, labels, projects, cycles, teams }), [states, profiles, labels, projects, cycles, teams]);
}
export type HistoryCtx = ReturnType<typeof useHistoryCtx>;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const bool = (v: unknown) => v === true || v === "true";

function B({ children }: { children: ReactNode }) {
  return <span className="font-medium text-ink">{children}</span>;
}
function Inline({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-bottom">
      {icon}
      <span className="truncate font-medium text-ink">{children}</span>
    </span>
  );
}

function list(nodes: ReactNode[]): ReactNode {
  return nodes.map((n, i) => (
    <Fragment key={i}>
      {i > 0 && (i === nodes.length - 1 ? " and " : ", ")}
      {n}
    </Fragment>
  ));
}

const points = (n: number) => `${n} point${n === 1 ? "" : "s"}`;

/** Link to another issue (parent changes), subscribed to just that issue. */
function IssueRef({ id, teams }: { id: string; teams: HistoryCtx["teams"] }) {
  const i = useSync((s) => s.issues[id]);
  if (!i) return <B>a deleted issue</B>;
  const key = issueKey(i, teams);
  return (
    <a {...linkProps({ kind: "issue", identifier: key })} className="inline-flex max-w-full items-center gap-1 align-bottom font-medium text-ink hover:underline">
      <StateGlyph stateId={i.state_id} size={12} />
      <span className="shrink-0">{key}</span>
      <span className="truncate font-normal text-dim">{i.title}</span>
    </a>
  );
}

/** Sentence (without actor) describing one history entry. */
function describe(h: HistoryEntry, ctx: HistoryCtx): ReactNode {
  const from = h.from_value;
  const to = h.to_value;
  switch (h.field) {
    case "created":
      return "created the issue";
    case "title": {
      const f = str(from);
      const t = str(to);
      return f ? <>changed the title from <span className="text-faint line-through">{f}</span> to <B>{t ?? ""}</B></> : <>set the title to <B>{t ?? ""}</B></>;
    }
    case "state": {
      const f = str(from);
      const t = str(to);
      const name = (id: string | null) => (id ? ctx.states[id]?.name ?? "a deleted status" : "none");
      return f
        ? <>changed status from <Inline icon={<StateGlyph stateId={f} size={12} />}>{name(f)}</Inline> to <Inline icon={<StateGlyph stateId={t} size={12} />}>{name(t)}</Inline></>
        : <>set status to <Inline icon={<StateGlyph stateId={t} size={12} />}>{name(t)}</Inline></>;
    }
    case "assignee": {
      const f = str(from);
      const t = str(to);
      const person = (id: string) => <Inline icon={<Avatar profile={ctx.profiles[id]} size={14} />}>{displayName(ctx.profiles[id])}</Inline>;
      if (!t) return f ? <>unassigned {person(f)}</> : "removed the assignee";
      if (t === h.actor_id) return f ? <>took over the issue from {person(f)}</> : "self-assigned the issue";
      return f ? <>reassigned the issue from {person(f)} to {person(t)}</> : <>assigned the issue to {person(t)}</>;
    }
    case "priority": {
      const f = (num(from) ?? 0) as Priority;
      const t = (num(to) ?? 0) as Priority;
      const p = (v: Priority) => <Inline icon={<PriorityIcon priority={v} size={12} className="text-dim" />}>{PRIORITY_LABEL[v] ?? "Unknown"}</Inline>;
      if (t === 0) return "removed the priority";
      return f === 0 ? <>set priority to {p(t)}</> : <>changed priority from {p(f)} to {p(t)}</>;
    }
    case "labels": {
      const f = arr(from);
      const t = arr(to);
      const added = t.filter((x) => !f.includes(x));
      const removed = f.filter((x) => !t.includes(x));
      const pill = (id: string) => {
        const l = ctx.labels[id];
        return <Inline key={id} icon={<LabelDot color={l?.color ?? "var(--faint)"} size={7} />}>{l?.name ?? "deleted label"}</Inline>;
      };
      const parts: ReactNode[] = [];
      if (added.length) parts.push(<Fragment key="a">added {added.length === 1 ? "label" : "labels"} {list(added.map(pill))}</Fragment>);
      if (removed.length) parts.push(<Fragment key="r">removed {removed.length === 1 ? "label" : "labels"} {list(removed.map(pill))}</Fragment>);
      return parts.length ? list(parts) : "updated labels";
    }
    case "project": {
      const f = str(from);
      const t = str(to);
      const proj = (id: string) => {
        const p = ctx.projects[id];
        return <Inline icon={p ? <ProjectIcon icon={p.icon} color={p.color} size={12} /> : undefined}>{p?.name ?? "a deleted project"}</Inline>;
      };
      if (f && t) return <>moved the issue from {proj(f)} to {proj(t)}</>;
      if (t) return <>added the issue to project {proj(t)}</>;
      return f ? <>removed the issue from project {proj(f)}</> : "changed the project";
    }
    case "cycle": {
      const f = str(from);
      const t = str(to);
      const cyc = (id: string) => <B>{ctx.cycles[id] ? cycleName(ctx.cycles[id]) : "a deleted cycle"}</B>;
      if (f && t) return <>moved the issue from {cyc(f)} to {cyc(t)}</>;
      if (t) return <>added the issue to {cyc(t)}</>;
      return f ? <>removed the issue from {cyc(f)}</> : "changed the cycle";
    }
    case "estimate": {
      const f = num(from);
      const t = num(to);
      if (t == null) return "removed the estimate";
      return f == null ? <>set the estimate to <B>{points(t)}</B></> : <>changed the estimate from <B>{points(f)}</B> to <B>{points(t)}</B></>;
    }
    case "due_date": {
      const t = str(to);
      const f = str(from);
      if (!t) return "removed the due date";
      return f ? <>changed the due date from <B>{formatDate(f)}</B> to <B>{formatDate(t)}</B></> : <>set the due date to <B>{formatDate(t)}</B></>;
    }
    case "parent": {
      const f = str(from);
      const t = str(to);
      const ref = (id: string) => <IssueRef id={id} teams={ctx.teams} />;
      if (t) return <>{f ? "changed" : "set"} the parent issue to {ref(t)}</>;
      return f ? <>removed the parent issue {ref(f)}</> : "removed the parent issue";
    }
    case "team": {
      const f = str(from);
      const t = str(to);
      const team = (id: string | null) => {
        const tm = id ? ctx.teams[id] : undefined;
        return <Inline icon={tm ? <TeamIcon team={tm} size={13} /> : undefined}>{tm?.key ?? "a deleted team"}</Inline>;
      };
      return <>moved the issue from {team(f)} to {team(t)}</>;
    }
    case "archived":
      return bool(to) ? "archived the issue" : "restored the issue from the archive";
    default:
      return <>updated {h.field.replace(/_/g, " ")}</>;
  }
}

/** Compact single-line history entry: avatar · actor · sentence · time. */
export const HistoryLine = memo(function HistoryLine({ entry, ctx }: { entry: HistoryEntry; ctx: HistoryCtx }) {
  const actor = entry.actor_id ? ctx.profiles[entry.actor_id] : undefined;
  return (
    <div className="flex min-h-[28px] items-start gap-2 py-[5px] pl-[9px] text-[12.5px] leading-[18px] text-dim">
      <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center">
        {actor ? <Avatar profile={actor} size={16} /> : <span className="h-4 w-4 rounded-full bg-wash" />}
      </span>
      <p className="min-w-0 flex-1 break-words">
        <B>{actor ? displayName(actor) : entry.actor_id ? "A former member" : "Someone"}</B>{" "}
        {describe(entry, ctx)}
        <span className="text-faint" title={formatDateTime(entry.created_at)}> · {timeAgo(entry.created_at)}</span>
      </p>
    </div>
  );
});
