"use client";
/* ─── Locus · issue detail page ──────────────────────────────────────────────
   default IssueView({ identifier, embedded?, header? })  — route `issue/:KEY-123`
   Main column (title, description, sub-issues, relations, activity, composer)
   plus a 280px property sidebar on lg+; below lg the properties become a
   wrapping chip row above the title. The issue is pinned by id once resolved,
   so moving it to another team (which renumbers it) follows it to its new URL.
   `embedded` renders it inside a parent pane (the inbox): a compact 44px bar
   (identifier, issue actions, open full page) instead of the ViewHeader, and
   none of the URL-driving behaviour (follow-the-key, Escape → back to the
   list, J/K → previous/next). Defaults to "not on the issue route". `header={false}` drops
   the compact bar for a parent that renders its own (IssueHeaderActions with
   context="embedded" gives that bar the same actions).
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowUpRight, ChevronRight, Link2, Plus } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { ui, useUI } from "@/lib/ui";
import { issueKey, useIssueByKey, useSubIssues } from "@/lib/model";
import { linkProps, navigate, useRoute } from "@/lib/router";
import { formatDateTime, timeAgo } from "@/lib/format";
import { archiveIssues } from "@/lib/sync/actions";
import { ViewHeader } from "@/components/app/Header";
import NotFound from "@/components/app/NotFound";
import { StateGlyph } from "@/components/pickers";
import { TeamIcon } from "@/components/primitives/icons";
import { Button, EmptyState } from "@/components/primitives/controls";
import type { Issue, Team } from "@/lib/types";
import { isBareEscape, isTypingTarget, overlayOpen, useIssueDetails } from "./shared";
import { IssueTitle } from "./IssueTitle";
import { IssueDescription } from "./IssueDescription";
import { PropertiesSidebar, PropertyChips } from "./IssueProperties";
import { SubIssues } from "./SubIssues";
import { AddRelationButton, Relations } from "./Relations";
import { Activity } from "./Activity";
import { IssueHeaderActions, stepIssue } from "./IssueActions";

interface Pin { id: string; keys: string[] }

/** How the page is mounted: the routed page, a pane with its compact bar, or a pane under the parent's own bar. */
type Mode = "page" | "embedded" | "bare";

const NO_IDS: string[] = [];

/* Minimal shape of the Navigation API (not in this TS lib's Window typings). */
interface NavEntry { readonly index: number; readonly sameDocument: boolean }
interface NavApi { readonly currentEntry: NavEntry | null; entries(): NavEntry[] }

/**
 * True when the previous history entry is one of this app's own client-side navigations, so
 * Escape may `history.back()`. `history.length` can't tell: it also counts other sites, the
 * login page a sign-in redirected from, and entries from before a full reload. Uses the per-entry
 * index the router stamps into history.state (`locusIdx`) when present, else the Navigation API's
 * same-document flag; with neither, it answers false and the caller falls back to the team list.
 */
function canGoBackInApp(): boolean {
  const state: unknown = window.history.state;
  const idx = state && typeof state === "object" ? (state as { locusIdx?: unknown }).locusIdx : undefined;
  if (typeof idx === "number") return idx > 0;
  const nav = (window as Window & { navigation?: NavApi }).navigation;
  const current = nav?.currentEntry;
  if (!nav || !current || current.index <= 0) return false;
  return nav.entries()[current.index - 1]?.sameDocument === true;
}

export default function IssueView({ identifier, embedded, header = true }: {
  identifier: string;
  /** render inside a parent pane (inbox): compact bar, no Escape → back / J·K / URL following. Default: not on the issue route. */
  embedded?: boolean;
  /** embedded only — false when the parent renders its own bar above */
  header?: boolean;
}) {
  const onIssueRoute = useRoute().route.kind === "issue";
  const isEmbedded = embedded ?? !onIssueRoute;
  const routed = !isEmbedded && onIssueRoute;
  const mode: Mode = !isEmbedded ? "page" : header ? "embedded" : "bare";

  const byKey = useIssueByKey(identifier);
  const teams = useSync((s) => s.teams);
  const lastSyncedAt = useSync((s) => s.lastSyncedAt);
  const [pin, setPin] = useState<Pin | null>(null);
  const pinned = useSync((s) => (pin ? s.issues[pin.id] : undefined));
  const pinnedHere = Boolean(pin && pin.keys.includes(identifier));
  const issue = pinnedHere ? pinned : byKey;

  // remember which issue this identifier resolved to
  useEffect(() => {
    if (byKey && !pinnedHere) setPin({ id: byKey.id, keys: [identifier] });
  }, [byKey, identifier, pinnedHere]);

  // the identifier changed under us (moved to another team) → follow the issue to its new URL
  useEffect(() => {
    if (!routed || !pin || !pinnedHere || !pinned || !pinned.number) return;
    const key = issueKey(pinned, teams);
    if (key === identifier || key.includes("?")) return;
    setPin({ id: pinned.id, keys: [...pin.keys, key] });
    navigate({ kind: "issue", identifier: key }, { replace: true });
  }, [routed, pin, pinnedHere, pinned, teams, identifier]);

  // the first boot can render from the local snapshot before the authoritative fetch lands
  const [grace, setGrace] = useState(lastSyncedAt === 0);
  useEffect(() => {
    if (!grace) return;
    if (lastSyncedAt > 0) { setGrace(false); return; }
    const t = setTimeout(() => setGrace(false), 4000);
    return () => clearTimeout(t);
  }, [grace, lastSyncedAt]);

  // prev/next (routed page): the list the user came from, captured on mount, refreshed while it still contains this issue
  const [navIds, setNavIds] = useState<string[]>(() => useUI.getState().visibleIds);
  const liveIds = useUI((s) => s.visibleIds);
  const currentId = issue?.id;
  useEffect(() => {
    if (currentId && liveIds.length && liveIds.includes(currentId)) setNavIds(liveIds);
  }, [liveIds, currentId]);

  if (!issue) {
    if (grace) return <IssueSkeleton identifier={identifier} mode={mode} />;
    if (mode === "page") return <NotFound what="issue" />;
    return <EmptyState title="This issue doesn’t exist" body="It may have been deleted, or you might not have access to it." />;
  }
  return <IssuePage issue={issue} navIds={routed ? navIds : NO_IDS} routed={routed} mode={mode} />;
}

function IssueSkeleton({ identifier, mode }: { identifier: string; mode: Mode }) {
  return (
    <>
      {mode === "page" && <ViewHeader title={identifier} />}
      {mode === "embedded" && (
        <div className="flex h-11 shrink-0 items-center border-b border-line bg-canvas px-4 text-[13px] font-medium tabular-nums text-dim">
          {identifier}
        </div>
      )}
      <div className="mx-auto w-full max-w-[760px] px-4 pt-8 sm:px-6" aria-busy="true">
        <div className="skeleton h-7 w-3/5 rounded-md" />
        <div className="skeleton mt-5 h-4 w-11/12 rounded" />
        <div className="skeleton mt-2.5 h-4 w-4/5 rounded" />
        <div className="skeleton mt-2.5 h-4 w-2/5 rounded" />
      </div>
    </>
  );
}

/** Compact 44px bar of the embedded page: team › KEY (opens the full page) · issue actions · Open. */
function EmbeddedHeader({ issue, issueKey: key, team }: { issue: Issue; issueKey: string; team: Team | undefined }) {
  const full = linkProps({ kind: "issue", identifier: key });
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-canvas pl-4 pr-2">
      <a
        {...full}
        title="Open full page"
        className="focus-ring -ml-1 flex h-7 min-w-0 items-center gap-1.5 rounded px-1 text-[13px] transition-colors hover:bg-wash"
      >
        <TeamIcon team={team} size={14} />
        {team && (
          <>
            <span className="hidden min-w-0 truncate text-dim xl:inline">{team.name}</span>
            <ChevronRight size={12} className="hidden shrink-0 text-faint xl:block" />
          </>
        )}
        <span className="shrink-0 font-medium tabular-nums text-ink">{key}</span>
      </a>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IssueHeaderActions issue={issue} issueKey={key} navIds={NO_IDS} context="embedded" />
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        <a
          {...full}
          aria-label="Open full page"
          title="Open full page"
          className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] font-medium text-ink shadow-card transition-colors hover:bg-wash"
        >
          <span className="hidden xl:inline">Open</span>
          <ArrowUpRight size={14} className="text-faint" />
        </a>
      </div>
    </div>
  );
}

function IssuePage({ issue, navIds, routed, mode }: { issue: Issue; navIds: string[]; routed: boolean; mode: Mode }) {
  const teams = useSync((s) => s.teams);
  const team = teams[issue.team_id];
  const key = issueKey(issue, teams);
  const parent = useSync((s) => (issue.parent_id ? s.issues[issue.parent_id] : undefined));
  const subs = useSubIssues(issue.id);
  const hasSubs = subs.length > 0;
  const relations = useSync((s) => s.issue_relations);
  const hasRelations = useMemo(
    () => Object.values(relations).some((r) => r.issue_id === issue.id || r.related_issue_id === issue.id),
    [relations, issue.id],
  );
  const [addingSub, setAddingSub] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const page = mode === "page";

  useIssueDetails(issue.id);

  // fresh issue → top of the page (unless deep-linked to a comment), close inline forms
  useEffect(() => {
    if (!window.location.hash.startsWith("#comment-")) scrollRef.current?.scrollTo({ top: 0 });
    setAddingSub(false);
  }, [issue.id]);

  /* Global property shortcuts (S, P, A, L…) act on the focused issue. Shell clears focus in a layout
     effect on navigation — before this runs — so pointing it here when the issue mounts / changes is
     enough. Archiving from the palette drops the issue from list focus while this page keeps showing
     it, so a change of archive state points it back here as well. */
  const issueId = issue.id;
  const archivedAt = issue.archived_at;
  useEffect(() => {
    ui.setFocused(issueId);
  }, [issueId, archivedAt]);
  useEffect(() => () => {
    if (useUI.getState().focusedId === issueId) ui.setFocused(null);
  }, [issueId]);

  /* routed page only — Escape (nothing open, not typing, nothing selected) → back to the in-app page the user
     came from, else (deep link, other site or sign-in before it) the issue's team list, replacing this entry
     so Back from the list doesn't reopen the dismissed issue · J / K → next / previous issue */
  const teamKey = team?.key;
  const navRef = useRef(navIds);
  navRef.current = navIds;
  useEffect(() => {
    if (!routed) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((k === "j" || k === "k") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.defaultPrevented || e.isComposing || e.repeat || isTypingTarget(e.target) || overlayOpen()) return;
        const u = useUI.getState();
        if (u.peekIssueId || u.selected.length) return;
        if (stepIssue(navRef.current, issueId, k === "j" ? 1 : -1)) e.preventDefault();
        return;
      }
      if (!isBareEscape(e)) return;
      const u = useUI.getState();
      if (u.peekIssueId || u.selected.length) return;
      e.preventDefault();
      if (canGoBackInApp()) window.history.back();
      else navigate(teamKey ? { kind: "team", key: teamKey, tab: "all" } : { kind: "my-issues", tab: "assigned" }, { replace: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [routed, teamKey, issueId]);

  return (
    <>
      {page ? (
        <ViewHeader
          crumbs={team ? [{
            label: <span className="hidden sm:inline">{team.name}</span>,
            icon: <TeamIcon team={team} size={16} />,
            to: { kind: "team", key: team.key, tab: "all" },
          }] : undefined}
          title={key}
          actions={<IssueHeaderActions issue={issue} issueKey={key} navIds={navIds} />}
        />
      ) : mode === "embedded" ? (
        <EmbeddedHeader issue={issue} issueKey={key} team={team} />
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className={`mx-auto w-full max-w-[760px] px-4 pb-20 pt-5 sm:px-6 ${page ? "sm:pt-8" : "sm:pt-6"}`}>
            {issue.archived_at && (
              <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[12.5px] text-dim">
                <Archive size={14} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1" title={formatDateTime(issue.archived_at)}>
                  This issue was archived {timeAgo(issue.archived_at)}.
                </span>
                <Button size="md" variant="secondary" onClick={() => void archiveIssues([issue.id], false)}>Unarchive</Button>
              </div>
            )}

            {/* embedded next to another view's list, the property sidebar needs a much wider screen */}
            <PropertyChips issue={issue} className={`mb-5 ${page ? "lg:hidden" : "2xl:hidden"}`} />

            {parent && (
              <a
                {...linkProps({ kind: "issue", identifier: issueKey(parent, teams) })}
                className="focus-ring mb-2.5 inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] text-dim transition-colors hover:bg-wash hover:text-ink sm:h-7"
              >
                <span className="shrink-0 text-faint">Sub-issue of</span>
                <StateGlyph stateId={parent.state_id} size={12} />
                <span className="shrink-0 font-medium tabular-nums">{issueKey(parent, teams)}</span>
                <span className="min-w-0 truncate">{parent.title}</span>
              </a>
            )}

            <IssueTitle key={issue.id} issue={issue} />
            <div className="mt-3">
              <IssueDescription issue={issue} />
            </div>

            {((!hasSubs && !addingSub) || !hasRelations) && (
              <div className="mt-5 flex flex-wrap items-center gap-1">
                {!hasSubs && !addingSub && (
                  <Button variant="ghost" size="md" icon={<Plus size={14} />} onClick={() => setAddingSub(true)}>
                    Add sub-issues
                  </Button>
                )}
                {!hasRelations && (
                  <AddRelationButton issue={issue}>
                    {(p) => (
                      <Button ref={p.ref} variant="ghost" size="md" icon={<Link2 size={14} />} onClick={p.onClick} className={p.open ? "bg-wash text-ink" : ""}>
                        Add relation
                      </Button>
                    )}
                  </AddRelationButton>
                )}
              </div>
            )}

            <SubIssues issue={issue} subs={subs} adding={addingSub} setAdding={setAddingSub} />
            <Relations issue={issue} />
            <Activity issue={issue} />
          </div>
        </div>

        <aside
          className={`hidden w-[280px] shrink-0 overflow-y-auto border-l border-line bg-canvas ${page ? "lg:block" : "2xl:block"}`}
          aria-label="Issue properties"
        >
          <PropertiesSidebar issue={issue} />
        </aside>
      </div>
    </>
  );
}
