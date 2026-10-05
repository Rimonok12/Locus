"use client";
/* ─── Locus · issue list / board surface ─────────────────────────────────────
   CONTRACT (used by team, my-issues, cycle, project, saved views):
     default IssuesSurface({ query, viewKey, createDefaults, empty })
        renders query.groups as a grouped list or a board (query.display.layout)
     DisplayMenu({ viewKey, query, groupings? })   header "Display" popover
     FilterButton({ viewKey, teamId? })            header "Filter" popover (adds a filter)
     FilterBar({ viewKey, query })                 row of active filter chips (render in ViewHeader `sub`)
   STUB implementation — replaced by the real list/board.
   ──────────────────────────────────────────────────────────────────────────── */

import type { ReactNode } from "react";
import type { IssueQuery } from "@/lib/model";
import type { Grouping, Issue } from "@/lib/types";

export interface IssuesSurfaceProps {
  query: IssueQuery;
  /** same key passed to useIssueQuery */
  viewKey: string;
  /** defaults for issues created from this surface (team, project, cycle, assignee…) */
  createDefaults?: Partial<Issue>;
  /** rendered when the query has no issues at all */
  empty?: ReactNode;
}

export default function IssuesSurface({ query }: IssuesSurfaceProps) {
  return <div className="flex-1 overflow-auto p-4 text-dim">{query.total} issues</div>;
}

export function DisplayMenu(_: { viewKey: string; query: IssueQuery; groupings?: Grouping[] }) {
  return null;
}
export function FilterButton(_: { viewKey: string; teamId?: string }) {
  return null;
}
export function FilterBar(_: { viewKey: string; query: IssueQuery }) {
  return null;
}
