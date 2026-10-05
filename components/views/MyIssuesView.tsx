"use client";
/* ─── Locus · My issues: assigned / created / subscribed lists + recent activity ─── */

import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Activity, Bell, Plus, Target } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { ui, useUI } from "@/lib/ui";
import { linkProps, navigate, type MyIssuesTab } from "@/lib/router";
import { issueKey, todayISO, useIssueQuery, useMeId, useMyTeams } from "@/lib/model";
import { daysBetween, timeAgo } from "@/lib/format";
import { HeaderTab, ViewHeader } from "@/components/app/Header";
import IssuesSurface, { DisplayMenu, FilterBar, FilterButton } from "@/components/issues/IssuesSurface";
import { Button, EmptyState } from "@/components/primitives/controls";
import { Avatar } from "@/components/primitives/Avatar";
import { TeamIcon } from "@/components/primitives/icons";
import { StateGlyph } from "@/components/pickers";
import { isActivatable, isTypingTarget, overlayOpen, useNow } from "@/components/inbox/hooks";
import type { Issue } from "@/lib/types";

const TABS: { value: MyIssuesTab; label: string }[] = [
  { value: "assigned", label: "Assigned" },
  { value: "created", label: "Created" },
  { value: "subscribed", label: "Subscribed" },
  { value: "activity", label: "Activity" },
];

export default function MyIssuesView({ tab }: { tab: "assigned" | "created" | "subscribed" | "activity" }) {
  if (tab === "activity") return <MyActivity />;
  return <MyIssueList key={tab} tab={tab} />;
}

function MyHeader({ tab, actions, sub }: { tab: MyIssuesTab; actions?: ReactNode; sub?: ReactNode }) {
  return (
    <ViewHeader
      title="My issues"
      icon={<Target size={15} className="text-dim" />}
      tabs={TABS.map((t) => (
        <HeaderTab key={t.value} to={{ kind: "my-issues", tab: t.value }} active={t.value === tab}>{t.label}</HeaderTab>
      ))}
      actions={actions}
      sub={sub}
    />
  );
}

/* ═══ assigned / created / subscribed ═══ */

function MyIssueList({ tab }: { tab: Exclude<MyIssuesTab, "activity"> }) {
  const me = useMeId();
  // only the Subscribed tab depends on subscriptions — the others shouldn't re-query when they change
  const subs = useSync((s) => (tab === "subscribed" ? s.issue_subscribers : null));
  const issues = useSync((s) => s.issues);
  const myTeams = useMyTeams();
  const viewKey = `my:${tab}`;

  const scope = useCallback(
    (i: Issue) =>
      tab === "assigned" ? i.assignee_id === me
        : tab === "created" ? i.creator_id === me
          : Boolean(subs?.[`${i.id}:${me}`]),
    [tab, me, subs],
  );

  /** a single team in scope → group by that team's workflow states; mixed → by state type */
  const teamId = useMemo(() => {
    let only: string | undefined;
    for (const i of Object.values(issues)) {
      if (i.archived_at || !scope(i)) continue;
      if (only === undefined) only = i.team_id;
      else if (only !== i.team_id) return undefined;
    }
    return only;
  }, [issues, scope]);

  const query = useIssueQuery({ viewKey, scope, defaults: { grouping: "status" }, teamId, deps: [scope] });

  const firstTeam = myTeams[0]?.id;
  const createDefaults = useMemo<Partial<Issue>>(
    () => ({ ...(firstTeam ? { team_id: firstTeam } : {}), ...(tab === "assigned" ? { assignee_id: me } : {}) }),
    [firstTeam, tab, me],
  );

  return (
    <>
      <MyHeader
        tab={tab}
        actions={
          <>
            <FilterButton viewKey={viewKey} teamId={teamId} />
            <DisplayMenu viewKey={viewKey} query={query} />
          </>
        }
        sub={<FilterBar viewKey={viewKey} query={query} />}
      />
      <IssuesSurface query={query} viewKey={viewKey} createDefaults={createDefaults} empty={<ListEmpty tab={tab} createDefaults={createDefaults} />} />
    </>
  );
}

function ListEmpty({ tab, createDefaults }: { tab: Exclude<MyIssuesTab, "activity">; createDefaults: Partial<Issue> }) {
  const create = (
    <Button variant="primary" size="md" icon={<Plus size={14} />} onClick={() => ui.openCreateIssue(createDefaults)}>
      Create issue <kbd className="ml-1 border-white/30 bg-white/15 text-accent-ink">C</kbd>
    </Button>
  );
  switch (tab) {
    case "assigned":
      return (
        <EmptyState
          icon={<Target size={28} strokeWidth={1.5} />}
          title="No issues assigned to you"
          body="When someone assigns you an issue — or you take one yourself — it shows up here."
          action={create}
        />
      );
    case "created":
      return (
        <EmptyState
          icon={<Target size={28} strokeWidth={1.5} />}
          title="You haven’t created any issues"
          body="Issues you create in any team are collected here."
          action={create}
        />
      );
    case "subscribed":
      return (
        <EmptyState
          icon={<Bell size={28} strokeWidth={1.5} />}
          title="No subscribed issues"
          body="You’re subscribed automatically to issues you create, are assigned, comment on or are mentioned in. Subscribe to any issue to follow its updates."
        />
      );
  }
}

/* ═══ activity: issues I'm involved in, most recently changed first ═══ */

const BUCKETS = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"] as const;

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function bucketOf(iso: string, today: string): (typeof BUCKETS)[number] {
  const diff = daysBetween(localDay(iso), today);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff <= 7) return "Previous 7 days";
  if (diff <= 30) return "Previous 30 days";
  return "Older";
}

function MyActivity() {
  const me = useMeId();
  const issues = useSync((s) => s.issues);
  const focusedId = useUI((u) => u.focusedId);
  const now = useNow(60_000);
  const listRef = useRef<HTMLDivElement>(null);

  const list = useMemo(
    () => Object.values(issues)
      .filter((i) => !i.archived_at && (i.assignee_id === me || i.creator_id === me))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 100),
    [issues, me],
  );

  const groups = useMemo(() => {
    const today = todayISO();
    const out: { label: string; issues: Issue[] }[] = [];
    for (const i of list) {
      const label = bucketOf(i.updated_at, today);
      const last = out[out.length - 1];
      if (last?.label === label) last.issues.push(i);
      else out.push({ label, issues: [i] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, now]);

  // register rows for list keyboard navigation (J/K, Enter, property shortcuts)
  const ids = useMemo(() => list.map((i) => i.id).join(","), [list]);
  useEffect(() => {
    ui.setVisibleIds(ids ? ids.split(",") : []);
  }, [ids]);
  useEffect(() => () => ui.setVisibleIds([]), []);

  // J/K (or arrows) move the focused row, Enter opens it
  const listLive = useRef(list);
  listLive.current = list;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || overlayOpen()) return;
      const l = listLive.current;
      if (!l.length) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const cur = useUI.getState().focusedId;
      const idx = cur ? l.findIndex((i) => i.id === cur) : -1;
      if (key === "j" || key === "ArrowDown" || key === "k" || key === "ArrowUp") {
        e.preventDefault();
        const down = key === "j" || key === "ArrowDown";
        const next = idx < 0 ? 0 : Math.min(l.length - 1, Math.max(0, idx + (down ? 1 : -1)));
        ui.setFocused(l[next].id);
      } else if (key === "Enter" && idx >= 0 && !isActivatable(e.target)) {
        e.preventDefault();
        navigate({ kind: "issue", identifier: issueKey(l[idx]) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!focusedId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-issue-id="${focusedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusedId]);

  return (
    <>
      <MyHeader tab="activity" />
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {list.length ? (
          groups.map((g) => (
            <section key={g.label}>
              <h2 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-line bg-raised px-4 text-[12.5px] font-medium text-dim md:px-6">
                {g.label}
                <span className="tabular-nums text-faint">{g.issues.length}</span>
              </h2>
              {g.issues.map((i) => <ActivityRow key={i.id} issue={i} me={me} focused={focusedId === i.id} tick={now} />)}
            </section>
          ))
        ) : (
          <EmptyState
            icon={<Activity size={28} strokeWidth={1.5} />}
            title="No recent activity"
            body="Issues you create or are assigned to appear here, most recently updated first."
            action={
              <Button variant="primary" size="md" icon={<Plus size={14} />} onClick={() => ui.openCreateIssue()}>Create issue</Button>
            }
          />
        )}
      </div>
    </>
  );
}

const ActivityRow = memo(function ActivityRow({ issue, me, focused }: { issue: Issue; me: string; focused: boolean; /** re-render for relative time */ tick: number }) {
  const teams = useSync((s) => s.teams);
  const team = teams[issue.team_id];
  const key = issueKey(issue, teams);
  const role = issue.assignee_id === me ? (issue.creator_id === me ? "Created · Assigned" : "Assigned") : "Created";
  return (
    <a
      {...linkProps({ kind: "issue", identifier: key })}
      data-issue-id={issue.id}
      onMouseEnter={() => ui.setFocused(issue.id)}
      className={`group flex h-10 items-center gap-3 border-b border-line px-4 text-[13px] transition-colors md:px-6 ${focused ? "bg-wash" : "hover:bg-wash"}`}
    >
      <StateGlyph stateId={issue.state_id} />
      <span className="hidden w-[68px] shrink-0 truncate tabular-nums text-[12.5px] text-faint sm:block">{key}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{issue.title}</span>
      <span className="hidden shrink-0 text-xxs text-faint lg:inline">{role}</span>
      {team && (
        <span className="hidden shrink-0 items-center gap-1.5 text-[12px] text-dim md:flex">
          <TeamIcon team={team} size={14} />
          <span className="max-w-[120px] truncate">{team.name}</span>
        </span>
      )}
      <Avatar userId={issue.assignee_id} size={18} />
      <span className="w-[56px] shrink-0 text-right text-xxs tabular-nums text-faint sm:w-[88px]">
        <span className="hidden sm:inline">updated </span>{timeAgo(issue.updated_at)}
      </span>
    </a>
  );
});
