"use client";
/* ─── Locus · issue header actions (page, embedded pane, peek): prev/next, subscribe, favorite, copy link, overflow menu ─── */

import {
  Archive, ArchiveRestore, Bell, BellOff, ChevronDown, ChevronUp, CopyPlus, GitBranch, Hash, Link2, MoreHorizontal,
  Star, Trash2,
} from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { ui } from "@/lib/ui";
import { issueKey } from "@/lib/model";
import { navigate } from "@/lib/router";
import {
  archiveIssues, copyText, deleteIssues, duplicateIssue, issueUrl, subscribe, toggleFavorite, unsubscribe,
} from "@/lib/sync/actions";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu, type ActionItem } from "@/components/primitives/SelectMenu";
import { IconButton } from "@/components/primitives/controls";
import type { Issue } from "@/lib/types";
import { gitBranchName, useIsFavorite, useIsSubscribed } from "./shared";

/** Shared overflow-menu items for an issue (page header). */
function useIssueMenu(issue: Issue, key: string, beforeDelete: () => void): ActionItem[] {
  const subscribed = useIsSubscribed(issue.id);
  const favorite = useIsFavorite(issue.id);
  return [
    { id: "copy-id", label: "Copy ID", icon: <Hash size={14} />, onSelect: () => copyText(key, `Copied ${key}`) },
    { id: "copy-link", label: "Copy link", icon: <Link2 size={14} />, onSelect: () => copyText(issueUrl(issue), "Link copied") },
    { id: "copy-branch", label: "Copy git branch name", icon: <GitBranch size={14} />, onSelect: () => copyText(gitBranchName(issue, key), "Branch name copied") },
    {
      id: "subscribe", divider: true,
      label: subscribed ? "Unsubscribe" : "Subscribe",
      icon: subscribed ? <BellOff size={14} /> : <Bell size={14} />,
      onSelect: () => void (subscribed ? unsubscribe(issue.id) : subscribe(issue.id)),
    },
    {
      id: "favorite",
      label: favorite ? "Remove from favorites" : "Add to favorites",
      icon: <Star size={14} className={favorite ? "fill-current text-warning" : ""} />,
      onSelect: () => void toggleFavorite("issue", issue.id),
    },
    { id: "duplicate", divider: true, label: "Duplicate", icon: <CopyPlus size={14} />, onSelect: () => void duplicateIssue(issue.id) },
    issue.archived_at
      ? { id: "unarchive", label: "Unarchive", icon: <ArchiveRestore size={14} />, onSelect: () => void archiveIssues([issue.id], false) }
      : { id: "archive", label: "Archive", icon: <Archive size={14} />, onSelect: () => void archiveIssues([issue.id], true) },
    {
      id: "delete", label: "Delete…", icon: <Trash2 size={14} />, danger: true,
      onSelect: () =>
        ui.askConfirm({
          title: `Delete ${key}?`,
          body: "The issue is removed for everyone, together with its comments and activity.",
          confirmLabel: "Delete issue",
          destructive: true,
          onConfirm: async () => {
            beforeDelete();
            await deleteIssues([issue.id]);
          },
        }),
    },
  ];
}

/** Leave the issue page for its team's issue list (used before deleting from the page). */
function leaveToTeam(issue: Issue) {
  const team = useSync.getState().teams[issue.team_id];
  navigate(team ? { kind: "team", key: team.key, tab: "all" } : { kind: "my-issues", tab: "assigned" });
}

export type IssueActionsContext = "page" | "peek" | "embedded";

/** Before deleting: the page leaves for the team list, the peek closes, an embedded pane stays (its parent drops the gone issue). */
function beforeDeleteFor(context: IssueActionsContext, issue: Issue): () => void {
  if (context === "peek") return () => ui.peek(null);
  if (context === "embedded") return () => {};
  return () => leaveToTeam(issue);
}

/** "…" menu. `context` decides what happens to the surrounding UI when the issue is deleted. */
export function IssueMoreMenu({ issue, issueKey: key, context = "page", size = 32 }: {
  issue: Issue;
  issueKey: string;
  context?: IssueActionsContext;
  size?: number;
}) {
  const items = useIssueMenu(issue, key, beforeDeleteFor(context, issue));
  return (
    <Dropdown
      align="end"
      width={240}
      trigger={(p) => (
        <IconButton ref={p.ref} label="More actions" size={size} active={p.open} onClick={p.onClick} aria-expanded={p["aria-expanded"]}>
          <MoreHorizontal size={16} />
        </IconButton>
      )}
    >
      {(close) => <ActionMenu items={items} onDone={close} />}
    </Dropdown>
  );
}

/** Open the previous (-1) / next (+1) issue of the list the user came from. Returns false at either end. */
export function stepIssue(navIds: string[], currentId: string, delta: 1 | -1): boolean {
  const index = navIds.indexOf(currentId);
  if (index < 0) return false;
  const s = useSync.getState();
  for (let i = index + delta; i >= 0 && i < navIds.length; i += delta) {
    const next = s.issues[navIds[i]];
    if (next) {
      navigate({ kind: "issue", identifier: issueKey(next, s.teams) });
      return true;
    }
  }
  return false;
}

/**
 * Prev/next (page only), subscribe, favorite, copy link and the "…" menu.
 * `context="embedded"`: compact 30px buttons for a pane bar, no prev/next, deleting keeps the pane.
 */
export function IssueHeaderActions({ issue, issueKey: key, navIds, context = "page" }: {
  issue: Issue;
  issueKey: string;
  navIds: string[];
  context?: Exclude<IssueActionsContext, "peek">;
}) {
  const subscribed = useIsSubscribed(issue.id);
  const favorite = useIsFavorite(issue.id);
  const embedded = context === "embedded";
  const size = embedded ? 30 : 32;
  const index = embedded ? -1 : navIds.indexOf(issue.id);
  const go = (delta: 1 | -1) => stepIssue(navIds, issue.id, delta);

  return (
    <>
      {index >= 0 && navIds.length > 1 && (
        <div className="flex items-center gap-0.5">
          <span className="mr-1 hidden text-[12px] tabular-nums text-faint md:inline">
            {index + 1} / {navIds.length}
          </span>
          <IconButton label="Previous issue (K)" size={32} disabled={index <= 0} onClick={() => go(-1)} className="disabled:pointer-events-none disabled:opacity-40">
            <ChevronUp size={16} />
          </IconButton>
          <IconButton label="Next issue (J)" size={32} disabled={index >= navIds.length - 1} onClick={() => go(1)} className="disabled:pointer-events-none disabled:opacity-40">
            <ChevronDown size={16} />
          </IconButton>
          <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
        </div>
      )}
      <IconButton
        label={subscribed ? "Unsubscribe" : "Subscribe to updates"}
        size={size}
        active={subscribed}
        onClick={() => void (subscribed ? unsubscribe(issue.id) : subscribe(issue.id))}
        className="hidden sm:inline-flex"
      >
        {subscribed ? <Bell size={15} className="fill-current" /> : <BellOff size={15} />}
      </IconButton>
      <IconButton
        label={favorite ? "Remove from favorites" : "Add to favorites"}
        size={size}
        onClick={() => void toggleFavorite("issue", issue.id)}
        className="hidden sm:inline-flex"
      >
        <Star size={15} className={favorite ? "fill-current text-warning" : ""} />
      </IconButton>
      <IconButton label="Copy link" size={size} onClick={() => copyText(issueUrl(issue), "Link copied")} className="hidden sm:inline-flex">
        <Link2 size={15} />
      </IconButton>
      <IssueMoreMenu issue={issue} issueKey={key} context={context} size={size} />
    </>
  );
}
