"use client";
/* ─── Locus · client router ──────────────────────────────────────────────────
   The workspace is a single client app mounted by app/[slug]/layout.tsx.
   Navigation uses history.pushState (Next ≥14.1 keeps usePathname in sync),
   so moving between views never round-trips to the server.

   History state: every entry this module writes carries `{ locusIdx }`, the
   number of in-app entries behind it, so Escape / back buttons can tell
   whether `history.back()` stays inside the app (see canGoBackInApp).
   Next 14.2 patches pushState/replaceState: a state object WITHOUT `__NA`
   gets Next's internal keys (`__NA`, the router tree) merged into it and
   dispatches a restore so usePathname/useSearchParams follow the new URL.
   A state object that already has `__NA` (e.g. a copy of history.state) is
   passed straight through and the router never hears about the URL change.
   So always hand it a FRESH object holding only our keys — never spread
   window.history.state. Next keeps our keys on its own follow-up replace
   (restore → preserveCustomHistoryState); a router.refresh() or server
   action replaces the entry with Next's keys only, which drops `locusIdx`
   for that entry — canGoBackInApp then falls back to the Navigation API.
   ──────────────────────────────────────────────────────────────────────────── */

import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";

export type MyIssuesTab = "assigned" | "created" | "subscribed" | "activity";
export type TeamTab = "all" | "active" | "backlog";
export type ProjectsTab = "all" | "started" | "planned" | "backlog" | "completed";
export type ProjectTab = "overview" | "issues" | "updates";
export type SettingsSection = "account" | "preferences" | "workspace" | "members" | "teams" | "labels";

export type Route =
  | { kind: "inbox" }
  | { kind: "my-issues"; tab: MyIssuesTab }
  | { kind: "team"; key: string; tab: TeamTab }
  | { kind: "team-cycles"; key: string }
  | { kind: "cycle"; key: string; number: number | "current" }
  | { kind: "team-projects"; key: string }
  | { kind: "projects"; tab: ProjectsTab }
  | { kind: "project"; id: string; tab: ProjectTab }
  | { kind: "issue"; identifier: string }
  | { kind: "views" }
  | { kind: "view"; id: string }
  | { kind: "search" }
  | { kind: "settings"; section: SettingsSection; teamKey?: string }
  | { kind: "not-found" };

const one = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;

export function parseRoute(segments: string[]): Route {
  const [a, b, c, d] = segments;
  switch (a) {
    case undefined:
    case "":
      return { kind: "my-issues", tab: "assigned" };
    case "inbox":
      return { kind: "inbox" };
    case "my-issues":
      return { kind: "my-issues", tab: one(b, ["assigned", "created", "subscribed", "activity"] as const, "assigned") };
    case "team": {
      if (!b) return { kind: "not-found" };
      const key = b.toUpperCase();
      if (c === "cycles") return { kind: "team-cycles", key };
      if (c === "cycle") return { kind: "cycle", key, number: d === "current" || !d ? "current" : Number(d) || "current" };
      if (c === "projects") return { kind: "team-projects", key };
      return { kind: "team", key, tab: one(c, ["all", "active", "backlog"] as const, "all") };
    }
    case "projects":
      return { kind: "projects", tab: one(b, ["all", "started", "planned", "backlog", "completed"] as const, "all") };
    case "project":
      return b ? { kind: "project", id: b, tab: one(c, ["overview", "issues", "updates"] as const, "overview") } : { kind: "not-found" };
    case "issue":
      return b ? { kind: "issue", identifier: b.toUpperCase() } : { kind: "not-found" };
    case "views":
      return { kind: "views" };
    case "view":
      return b ? { kind: "view", id: b } : { kind: "not-found" };
    case "search":
      return { kind: "search" };
    case "settings": {
      if (b === "teams" && c) return { kind: "settings", section: "teams", teamKey: c.toUpperCase() };
      return { kind: "settings", section: one(b, ["account", "preferences", "workspace", "members", "teams", "labels"] as const, "account") };
    }
    default:
      return { kind: "not-found" };
  }
}

export function routePath(r: Route): string {
  switch (r.kind) {
    case "inbox": return "inbox";
    case "my-issues": return `my-issues/${r.tab}`;
    case "team": return `team/${r.key}/${r.tab}`;
    case "team-cycles": return `team/${r.key}/cycles`;
    case "cycle": return `team/${r.key}/cycle/${r.number}`;
    case "team-projects": return `team/${r.key}/projects`;
    case "projects": return `projects/${r.tab}`;
    case "project": return `project/${r.id}/${r.tab}`;
    case "issue": return `issue/${r.identifier}`;
    case "views": return "views";
    case "view": return `view/${r.id}`;
    case "search": return "search";
    case "settings": return r.teamKey ? `settings/teams/${r.teamKey}` : `settings/${r.section}`;
    case "not-found": return "";
  }
}

/** Current workspace slug, read from the URL. */
export function currentSlug(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname.split("/")[1] ?? "";
}

export function hrefFor(r: Route, slug = currentSlug()): string {
  return `/${slug}/${routePath(r)}`;
}

/* scroll positions per URL, restored by scroll containers that opt in */
export const scrollMemory = new Map<string, number>();

/* Minimal shape of the Navigation API (not in this TS lib's Window typings). */
interface NavEntry { readonly index: number; readonly sameDocument: boolean }
interface NavApi { readonly currentEntry: NavEntry | null; entries(): NavEntry[] }

function stampedIndex(): number | null {
  if (typeof window === "undefined") return null;
  const state: unknown = window.history.state;
  const idx = state && typeof state === "object" ? (state as { locusIdx?: unknown }).locusIdx : undefined;
  return typeof idx === "number" && Number.isFinite(idx) && idx >= 0 ? Math.floor(idx) : null;
}

/** How many in-app history entries sit behind the current one (0 on a fresh load or an unstamped entry). */
export function appIndex(): number {
  return stampedIndex() ?? 0;
}

/**
 * True when the previous history entry belongs to this app's own client-side navigation, so
 * Escape / a back button may call `history.back()` without leaving Locus. `history.length` can't
 * tell: it also counts other sites, the login page a sign-in redirected from, and entries from
 * before a full reload. Uses the `locusIdx` stamp; on an entry Next re-stamped without it
 * (router.refresh / server action) it asks the Navigation API whether the previous entry is
 * same-document, and answers false when neither can tell (the caller then navigates to a
 * sensible parent route instead).
 */
export function canGoBackInApp(): boolean {
  if (typeof window === "undefined") return false;
  const idx = stampedIndex();
  if (idx !== null) return idx > 0;
  const nav = (window as Window & { navigation?: NavApi }).navigation;
  const current = nav?.currentEntry;
  if (!nav || !current || current.index <= 0) return false;
  return nav.entries()[current.index - 1]?.sameDocument === true;
}

/**
 * Stamp the current entry as the first in-app one (`locusIdx: 0`) when it carries no stamp yet —
 * the workspace calls this on mount, so the entry it was entered on (a sign-in redirect, a pasted
 * link, a Next navigation from another page) never reads as "in app" behind it. The URL does not
 * change, so this deliberately keeps Next's own keys (spreads history.state): no router sync is
 * needed, and dropping `__NA` would make a later popstate onto this entry reload the page.
 */
export function stampAppEntry() {
  if (typeof window === "undefined" || stampedIndex() !== null) return;
  const state: unknown = window.history.state;
  window.history.replaceState({ ...(state && typeof state === "object" ? state : {}), locusIdx: 0 }, "");
}

export function navigate(to: Route | string, opts: { replace?: boolean } = {}) {
  const href = typeof to === "string" ? to : hrefFor(to);
  if (href === window.location.pathname + window.location.search) return;
  // fresh object (no __NA) so Next's patched history methods sync usePathname — see header
  if (opts.replace) window.history.replaceState({ locusIdx: appIndex() }, "", href);
  else window.history.pushState({ locusIdx: appIndex() + 1 }, "", href);
}

export function useRoute(): { slug: string; route: Route; path: string } {
  const pathname = usePathname() ?? "/";
  return useMemo(() => {
    const [, slug = "", ...rest] = pathname.split("/");
    return { slug, route: parseRoute(rest.filter(Boolean).map(decodeURIComponent)), path: pathname };
  }, [pathname]);
}

export function useQueryParam(name: string): string | null {
  return useSearchParams()?.get(name) ?? null;
}

export function setQueryParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
  window.history.replaceState({ locusIdx: appIndex() }, "", url.pathname + url.search);
}

/** Props for <a> elements that navigate client-side but keep cmd/ctrl-click working. */
export function linkProps(to: Route | string) {
  const href = typeof to === "string" ? to : hrefFor(to);
  return {
    href,
    onClick: (e: React.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(href);
    },
  };
}
