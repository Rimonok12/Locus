"use client";
/* ─── Locus · client router ──────────────────────────────────────────────────
   The workspace is a single client app mounted by app/[slug]/layout.tsx.
   Navigation uses history.pushState (Next ≥14.1 keeps usePathname in sync),
   so moving between views never round-trips to the server.
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

export function navigate(to: Route | string, opts: { replace?: boolean } = {}) {
  const href = typeof to === "string" ? to : hrefFor(to);
  if (href === window.location.pathname + window.location.search) return;
  window.history[opts.replace ? "replaceState" : "pushState"](null, "", href);
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
  window.history.replaceState(null, "", url.pathname + url.search);
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
