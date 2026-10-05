"use client";
/* ─── Locus · issue detail helpers shared by the page and the peek panel ─── */

import { useEffect, useMemo } from "react";
import { useSync, loadIssueDetails } from "@/lib/sync/store";
import { useUI } from "@/lib/ui";
import { displayName } from "@/lib/model";
import { slugify } from "@/lib/format";
import { anyOverlayOpen } from "@/components/primitives/overlay";
import type { Issue } from "@/lib/types";

/** True when a key event comes from a text field / contenteditable (shortcuts must ignore it). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** Any modal-ish UI (popover, modal, palette, picker, confirm, drawer) currently open. */
export function overlayOpen(): boolean {
  if (anyOverlayOpen()) return true;
  const u = useUI.getState();
  return Boolean(u.paletteOpen || u.createIssue || u.picker || u.shortcutsOpen || u.confirm || u.mobileNavOpen)
    || Boolean(document.querySelector("[data-locus-mention]"));
}

/* Another Escape handler (global shortcuts, peek) may run before ours on the same key press and
   dismiss something synchronously; remember when that happened so one Escape never does two things. */
let lastDismissAt = 0;
if (typeof window !== "undefined") {
  useUI.subscribe((s, p) => {
    if ((p.peekIssueId && !s.peekIssueId) || (p.selected.length && !s.selected.length) || (p.confirm && !s.confirm)
      || (p.picker && !s.picker) || (p.paletteOpen && !s.paletteOpen) || (p.createIssue && !s.createIssue)
      || (p.shortcutsOpen && !s.shortcutsOpen) || (p.mobileNavOpen && !s.mobileNavOpen)) {
      lastDismissAt = performance.now();
    }
  });
}
const justDismissed = () => performance.now() - lastDismissAt < 120;

/** A plain Escape that nothing else (field, overlay, selection) should consume. */
export function isBareEscape(e: KeyboardEvent): boolean {
  return e.key === "Escape" && !e.defaultPrevented && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
    && !isTypingTarget(e.target) && !overlayOpen() && !justDismissed();
}

/** Fetch comments / history / subscribers / reactions for an issue; returns whether they are loaded. */
export function useIssueDetails(issueId: string | undefined): boolean {
  const loaded = useSync((s) => (issueId ? Boolean(s.loadedIssues[issueId]) : false));
  useEffect(() => {
    if (issueId) void loadIssueDetails(issueId);
  }, [issueId]);
  return loaded;
}

export function useIsSubscribed(issueId: string): boolean {
  return useSync((s) => Boolean(s.issue_subscribers[`${issueId}:${s.userId}`]));
}

export function useIsFavorite(issueId: string): boolean {
  return useSync((s) => Object.values(s.favorites).some((f) => f.kind === "issue" && f.target_id === issueId && f.user_id === s.userId));
}

export function useSubscriberIds(issueId: string): string[] {
  const subs = useSync((s) => s.issue_subscribers);
  return useMemo(
    () => Object.values(subs).filter((x) => x.issue_id === issueId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((x) => x.user_id),
    [subs, issueId],
  );
}

/** `rimon/eng-123-fix-login-redirect` */
export function gitBranchName(issue: Issue, key: string): string {
  const s = useSync.getState();
  const user = displayName(s.profiles[s.userId]).toLowerCase().replace(/[^a-z0-9._-]+/g, "") || "me";
  const title = slugify(issue.title);
  return `${user}/${key.toLowerCase()}${title ? `-${title}` : ""}`;
}
