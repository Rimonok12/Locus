"use client";
/* ─── Locus · issue properties: right sidebar (lg+) and wrapping chip row (mobile / peek) ─── */

import type { ReactNode } from "react";
import { Bell, BellOff, Tag } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { displayName } from "@/lib/model";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { subscribe, unsubscribe } from "@/lib/sync/actions";
import { IssuePicker, LabelPills, PropertyChip } from "@/components/pickers";
import { Dropdown } from "@/components/primitives/overlay";
import { Avatar, AvatarStack } from "@/components/primitives/Avatar";
import type { Issue } from "@/lib/types";
import { useIsSubscribed, useSubscriberIds } from "./shared";

function useVisibility(issue: Issue) {
  const cyclesEnabled = useSync((s) => Boolean(s.teams[issue.team_id]?.cycles_enabled));
  return { milestone: Boolean(issue.project_id), cycle: cyclesEnabled || Boolean(issue.cycle_id) };
}

/* ═══ sidebar ═══ */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-start gap-1">
      <span className="w-[84px] shrink-0 pt-[7px] text-[12px] text-faint">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3 last:border-b-0">
      {title && <h3 className="mb-1.5 text-xxs font-medium text-faint">{title}</h3>}
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function Meta({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex min-h-7 items-center gap-1 text-[12px]" title={title}>
      <span className="w-[84px] shrink-0 text-faint">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-dim">{children}</span>
    </div>
  );
}

export function PropertiesSidebar({ issue }: { issue: Issue }) {
  const show = useVisibility(issue);
  const creator = useSync((s) => (issue.creator_id ? s.profiles[issue.creator_id] : undefined));
  const subscribers = useSubscriberIds(issue.id);
  const subscribed = useIsSubscribed(issue.id);
  const loaded = useSync((s) => Boolean(s.loadedIssues[issue.id]));

  return (
    <div className="pb-6">
      <Group title="Properties">
        <Row label="Status"><PropertyChip issue={issue} kind="status" /></Row>
        <Row label="Priority"><PropertyChip issue={issue} kind="priority" emptyLabel="Set priority" /></Row>
        <Row label="Assignee"><PropertyChip issue={issue} kind="assignee" /></Row>
        <Row label="Labels"><LabelPills issue={issue} /></Row>
        <Row label="Project"><PropertyChip issue={issue} kind="project" /></Row>
        {show.milestone && <Row label="Milestone"><PropertyChip issue={issue} kind="milestone" /></Row>}
        {show.cycle && <Row label="Cycle"><PropertyChip issue={issue} kind="cycle" /></Row>}
        <Row label="Estimate"><PropertyChip issue={issue} kind="estimate" /></Row>
        <Row label="Due date"><PropertyChip issue={issue} kind="due" /></Row>
        <Row label="Parent"><PropertyChip issue={issue} kind="parent" emptyLabel="Set parent" /></Row>
        <Row label="Team"><PropertyChip issue={issue} kind="team" /></Row>
      </Group>
      <Group>
        <Meta label="Created by" title={formatDateTime(issue.created_at)}>
          {creator ? <Avatar profile={creator} size={16} /> : null}
          <span className="truncate text-ink">{creator ? displayName(creator) : "Unknown"}</span>
          <span className="shrink-0 text-faint">· {formatDate(issue.created_at)}</span>
        </Meta>
        <Meta label="Updated" title={formatDateTime(issue.updated_at)}>{timeAgo(issue.updated_at)}</Meta>
        {issue.started_at && <Meta label="Started" title={formatDateTime(issue.started_at)}>{formatDate(issue.started_at)}</Meta>}
        {issue.completed_at && <Meta label="Completed" title={formatDateTime(issue.completed_at)}>{formatDate(issue.completed_at)}</Meta>}
        {issue.canceled_at && <Meta label="Canceled" title={formatDateTime(issue.canceled_at)}>{formatDate(issue.canceled_at)}</Meta>}
        <div className="flex min-h-8 items-center gap-1 text-[12px]">
          <span className="w-[84px] shrink-0 text-faint">Subscribers</span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {subscribers.length ? <AvatarStack userIds={subscribers} size={18} max={5} /> : <span className="text-faint">{loaded ? "None" : "…"}</span>}
            <button
              onClick={() => (subscribed ? unsubscribe(issue.id) : subscribe(issue.id))}
              className="focus-ring ml-auto inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-dim hover:bg-wash hover:text-ink"
              title={subscribed ? "Stop receiving notifications for this issue" : "Get notified about changes and comments"}
            >
              {subscribed ? <BellOff size={13} /> : <Bell size={13} />}
              {subscribed ? "Unsubscribe" : "Subscribe"}
            </button>
          </span>
        </div>
      </Group>
    </div>
  );
}

/* ═══ chip row ═══ */

function LabelsChip({ issue }: { issue: Issue }) {
  const count = issue.label_ids.length;
  return (
    <Dropdown
      width={280}
      trigger={(p) => (
        <button
          ref={p.ref}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          title="Change labels"
          className={`focus-ring inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-line-strong px-2 text-[12.5px] transition-colors hover:bg-wash sm:min-h-7 ${count ? "py-0.5 text-ink" : "text-dim"}`}
        >
          {count ? <LabelPills issue={issue} editable={false} max={3} /> : <><Tag size={13} className="text-faint" /> Labels</>}
        </button>
      )}
    >
      {() => <IssuePicker kind="labels" issueIds={[issue.id]} onDone={() => {}} />}
    </Dropdown>
  );
}

/** Horizontally wrapping property chips (issue page below lg, peek panel). */
export function PropertyChips({ issue, className = "" }: { issue: Issue; className?: string }) {
  const show = useVisibility(issue);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <PropertyChip issue={issue} kind="status" variant="chip" />
      <PropertyChip issue={issue} kind="priority" variant="chip" emptyLabel="Priority" />
      <PropertyChip issue={issue} kind="assignee" variant="chip" emptyLabel="Assignee" />
      <LabelsChip issue={issue} />
      <PropertyChip issue={issue} kind="project" variant="chip" emptyLabel="Project" />
      {show.milestone && <PropertyChip issue={issue} kind="milestone" variant="chip" emptyLabel="Milestone" />}
      {show.cycle && <PropertyChip issue={issue} kind="cycle" variant="chip" emptyLabel="Cycle" />}
      <PropertyChip issue={issue} kind="estimate" variant="chip" emptyLabel="Estimate" />
      <PropertyChip issue={issue} kind="due" variant="chip" emptyLabel="Due date" />
      <span className="inline-flex min-w-0 max-w-[240px]"><PropertyChip issue={issue} kind="parent" variant="chip" emptyLabel="Parent" /></span>
      <PropertyChip issue={issue} kind="team" variant="chip" />
    </div>
  );
}
