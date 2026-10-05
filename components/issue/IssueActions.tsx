"use client";
/* ─── Locus · issue page header actions: prev/next, subscribe, favorite, copy link, overflow menu ─── */

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

/** "…" menu. `context="peek"` closes the peek before deleting instead of leaving the page. */
export function IssueMoreMenu({ issue, issueKey: key, context = "page" }: { issue: Issue; issueKey: string; context?: "page" | "peek" }) {
  const items = useIssueMenu(issue, key, () => (context === "peek" ? ui.peek(null) : leaveToTeam(issue)));
  return (
    <Dropdown
      align="end"
      width={240}
      trigger={(p) => (
        <IconButton ref={p.ref} label="More actions" size={32} active={p.open} onClick={p.onClick} aria-expanded={p["aria-expanded"]}>
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

export function IssueHeaderActions({ issue, issueKey: key, navIds }: { issue: Issue; issueKey: string; navIds: string[] }) {
  const subscribed = useIsSubscribed(issue.id);
  const favorite = useIsFavorite(issue.id);
  const index = navIds.indexOf(issue.id);
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
        size={32}
        active={subscribed}
        onClick={() => void (subscribed ? unsubscribe(issue.id) : subscribe(issue.id))}
        className="hidden sm:inline-flex"
      >
        {subscribed ? <Bell size={15} className="fill-current" /> : <BellOff size={15} />}
      </IconButton>
      <IconButton
        label={favorite ? "Remove from favorites" : "Add to favorites"}
        size={32}
        onClick={() => void toggleFavorite("issue", issue.id)}
        className="hidden sm:inline-flex"
      >
        <Star size={15} className={favorite ? "fill-current text-warning" : ""} />
      </IconButton>
      <IconButton label="Copy link" size={32} onClick={() => copyText(issueUrl(issue), "Link copied")} className="hidden sm:inline-flex">
        <Link2 size={15} />
      </IconButton>
      <IssueMoreMenu issue={issue} issueKey={key} />
    </>
  );
}
