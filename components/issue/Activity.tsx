"use client";
/* ─── Locus · issue activity: history + comment threads, chronological, with composer ─── */

import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bell, BellOff, ChevronsUpDown } from "lucide-react";
import { loadIssueDetails, useSync } from "@/lib/sync/store";
import { addComment, subscribe, unsubscribe } from "@/lib/sync/actions";
import type { Comment, HistoryEntry, Issue } from "@/lib/types";
import { HistoryLine, useHistoryCtx } from "./HistoryLine";
import { CommentThread } from "./CommentThread";
import { Composer } from "./Composer";
import { useIsSubscribed } from "./shared";

const NO_REPLIES: Comment[] = [];

export type FeedItem =
  | { kind: "history"; id: string; at: string; entry: HistoryEntry }
  | { kind: "comment"; id: string; at: string; comment: Comment };

/** history + top-level comments in chronological order, replies grouped by parent */
export function useActivityFeed(issueId: string) {
  const history = useSync((s) => s.issue_history);
  const comments = useSync((s) => s.comments);
  return useMemo(() => {
    const items: FeedItem[] = [];
    const replies = new Map<string, Comment[]>();
    for (const h of Object.values(history)) {
      if (h.issue_id === issueId) items.push({ kind: "history", id: h.id, at: h.created_at, entry: h });
    }
    const ids = new Set<string>();
    for (const c of Object.values(comments)) if (c.issue_id === issueId) ids.add(c.id);
    for (const c of Object.values(comments)) {
      if (c.issue_id !== issueId) continue;
      if (c.parent_id) {
        if (!ids.has(c.parent_id)) continue; // parent deleted (cascade pending)
        const list = replies.get(c.parent_id) ?? [];
        list.push(c);
        replies.set(c.parent_id, list);
      } else {
        items.push({ kind: "comment", id: c.id, at: c.created_at, comment: c });
      }
    }
    // "created" always first; history before a comment posted in the same instant
    const rank = (i: FeedItem) => (i.kind === "history" && i.entry.field === "created" ? 0 : 1);
    items.sort((a, b) => rank(a) - rank(b) || a.at.localeCompare(b.at) || (a.kind === b.kind ? 0 : a.kind === "history" ? -1 : 1));
    for (const list of replies.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { items, replies };
  }, [history, comments, issueId]);
}

export function ActivitySkeleton({ rows = 4 }: { rows?: number }) {
  const widths = [62, 44, 78, 52, 68, 40];
  return (
    <div className="space-y-3 py-1" aria-busy="true" aria-label="Loading activity">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 pl-[9px]">
          <div className="skeleton h-4 w-4 shrink-0 rounded-full" />
          <div className="skeleton h-3 rounded" style={{ width: `${widths[i % widths.length]}%` }} />
        </div>
      ))}
      <div className="skeleton h-[72px] rounded-lg" />
    </div>
  );
}

/** skeleton that turns into a retry prompt if loading stalls (offline, failed request) */
function ActivityLoading({ issueId, rows }: { issueId: string; rows?: number }) {
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    setSlow(false);
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [issueId, retrying]);
  if (!slow) return <ActivitySkeleton rows={rows} />;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-[12.5px] text-dim">
      <span className="flex-1">Activity is taking longer than usual to load.</span>
      <button
        onClick={() => { setRetrying((r) => !r); void loadIssueDetails(issueId); }}
        className="focus-ring h-8 rounded-md px-2.5 font-medium text-ink transition-colors hover:bg-wash"
      >
        Retry
      </button>
    </div>
  );
}

type Row = FeedItem | { kind: "more"; id: string; count: number };

/** collapse long runs of history between comments (Linear-style "show more") */
function collapse(items: FeedItem[], expanded: boolean): Row[] {
  if (expanded) return items;
  const out: Row[] = [];
  let run: FeedItem[] = [];
  const flush = () => {
    if (run.length > 6) {
      out.push(run[0], { kind: "more", id: `more-${run[1].id}`, count: run.length - 3 }, ...run.slice(-2));
    } else out.push(...run);
    run = [];
  };
  for (const it of items) {
    if (it.kind === "history") run.push(it);
    else { flush(); out.push(it); }
  }
  flush();
  return out;
}

function useCommentHighlight(issueId: string, ready: boolean) {
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const m = window.location.hash.match(/^#comment-([0-9a-fA-F-]{36})$/);
    if (!m) return;
    const el = document.getElementById(`comment-${m[1]}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlight(m[1]);
    const t = setTimeout(() => setHighlight(null), 2600);
    return () => clearTimeout(t);
  }, [issueId, ready]);
  return highlight;
}

/** Full activity section of the issue page. */
export function Activity({ issue }: { issue: Issue }) {
  const loaded = useSync((s) => Boolean(s.loadedIssues[issue.id]));
  const { items, replies } = useActivityFeed(issue.id);
  const ctx = useHistoryCtx();
  const subscribed = useIsSubscribed(issue.id);
  const [expanded, setExpanded] = useState(false);
  const highlight = useCommentHighlight(issue.id, loaded);
  const rows = useMemo(() => collapse(items, expanded), [items, expanded]);

  useEffect(() => setExpanded(false), [issue.id]);

  return (
    <section className="mt-10 border-t border-line pt-6">
      <div className="mb-3 flex h-8 items-center gap-2">
        <h2 className="text-[13px] font-medium text-ink">Activity</h2>
        <button
          onClick={() => (subscribed ? unsubscribe(issue.id) : subscribe(issue.id))}
          className="focus-ring ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-dim transition-colors hover:bg-wash hover:text-ink"
          title={subscribed ? "Stop receiving notifications for this issue" : "Get notified about changes and comments"}
        >
          {subscribed ? <BellOff size={14} /> : <Bell size={14} />}
          {subscribed ? "Unsubscribe" : "Subscribe"}
        </button>
      </div>

      {!loaded ? (
        <ActivityLoading issueId={issue.id} />
      ) : (
        <div className="space-y-0.5">
          {rows.length === 0 && <p className="py-2 pl-[9px] text-[12.5px] text-faint">No activity yet.</p>}
          {rows.map((row) => {
            if (row.kind === "more") {
              return (
                <button
                  key={row.id}
                  onClick={() => setExpanded(true)}
                  className="focus-ring my-0.5 flex h-8 items-center gap-2 rounded-md pl-[9px] pr-2 text-[12.5px] text-dim transition-colors hover:bg-wash hover:text-ink"
                >
                  <ChevronsUpDown size={14} className="text-faint" />
                  Show {row.count} more {row.count === 1 ? "event" : "events"}
                </button>
              );
            }
            if (row.kind === "history") return <HistoryLine key={row.id} entry={row.entry} ctx={ctx} />;
            return (
              <div key={row.id} className="py-2">
                <CommentThread issueId={issue.id} comment={row.comment} replies={replies.get(row.comment.id) ?? NO_REPLIES} highlightId={highlight} />
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <Composer
          key={issue.id}
          placeholder="Leave a comment…"
          submitLabel="Comment"
          draftKey={`comment:${issue.id}`}
          send={(body) => addComment(issue.id, body)}
        />
      </div>
    </section>
  );
}

/** Last few activity items (peek panel). */
export function RecentActivity({ issue, limit = 5, onOpenAll }: { issue: Issue; limit?: number; onOpenAll: () => void }) {
  const loaded = useSync((s) => Boolean(s.loadedIssues[issue.id]));
  const { items, replies } = useActivityFeed(issue.id);
  const ctx = useHistoryCtx();
  const recent = items.slice(-limit);
  const hidden = items.length - recent.length;

  return (
    <section className="mt-8 border-t border-line pt-5">
      <div className="mb-2 flex h-8 items-center gap-2">
        <h2 className="text-[13px] font-medium text-ink">Recent activity</h2>
        <button
          onClick={onOpenAll}
          className="focus-ring ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] text-dim transition-colors hover:bg-wash hover:text-ink"
        >
          {hidden > 0 ? `View all ${items.length}` : "Open issue"}
          <ArrowUpRight size={13} />
        </button>
      </div>
      {!loaded ? (
        <ActivityLoading issueId={issue.id} rows={3} />
      ) : recent.length === 0 ? (
        <p className="py-2 pl-[9px] text-[12.5px] text-faint">No activity yet.</p>
      ) : (
        <div className="space-y-0.5">
          {recent.map((it) => (
            <Fragment key={it.id}>
              {it.kind === "history" ? (
                <HistoryLine entry={it.entry} ctx={ctx} />
              ) : (
                <div className="py-1.5">
                  <CommentThread issueId={issue.id} comment={it.comment} replies={replies.get(it.comment.id) ?? NO_REPLIES} readOnly />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
