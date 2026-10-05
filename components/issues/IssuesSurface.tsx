"use client";
/* ─── Locus · issue list / board surface ─────────────────────────────────────
   CONTRACT (used by team, my-issues, cycle, project, saved views):
     default IssuesSurface({ query, viewKey, createDefaults, empty })
        renders query.groups as a grouped list or a board (query.display.layout)
     DisplayMenu({ viewKey, query, groupings? })   header "Display" popover
     FilterButton({ viewKey, teamId? })            header "Filter" popover (adds a filter)
     FilterBar({ viewKey, query })                 row of active filter chips (render in ViewHeader `sub`)
   ──────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleDot, FilterX, Plus } from "lucide-react";
import { useSync, type SyncState } from "@/lib/sync/store";
import { ui, useUI } from "@/lib/ui";
import { patchForGroup, type IssueGroup, type IssueQuery } from "@/lib/model";
import { Button, EmptyState } from "@/components/primitives/controls";
import IssueList from "./IssueList";
import IssueBoard from "./IssueBoard";
import IssueContextMenu from "./IssueContextMenu";
import type { MenuRequest } from "./useListInteractions";
import type { SubCounts } from "./shared";
import type { Issue } from "@/lib/types";

export { DisplayMenu } from "./DisplayMenu";
export { FilterButton, FilterBar } from "./filters";

export interface IssuesSurfaceProps {
  query: IssueQuery;
  /** same key passed to useIssueQuery */
  viewKey: string;
  /** defaults for issues created from this surface (team, project, cycle, assignee…) */
  createDefaults?: Partial<Issue>;
  /** rendered when the query has no issues at all */
  empty?: ReactNode;
}

/** the team new issues land in when the surface doesn't say: my first team, else any team */
function fallbackTeam(s: SyncState): string | undefined {
  const teams = Object.values(s.teams).filter((t) => !t.archived_at).sort((a, b) => a.name.localeCompare(b.name));
  return (teams.find((t) => s.team_members[`${t.id}:${s.userId}`]) ?? teams[0])?.id;
}

export default function IssuesSurface({ query, viewKey, createDefaults, empty }: IssuesSurfaceProps) {
  const userFilters = useUI((u) => u.filters[viewKey]);
  const hasFilters = Boolean(userFilters?.length);
  const issues = useSync((s) => s.issues);
  const states = useSync((s) => s.workflow_states);
  const showSubCounts = query.display.properties.subIssues;

  /* sub-issue progress per parent (canceled children don't count, like Linear) */
  const subCounts = useMemo((): SubCounts => {
    const m: SubCounts = new Map();
    if (!showSubCounts) return m;
    for (const i of Object.values(issues)) {
      if (!i.parent_id || i.archived_at) continue;
      const type = states[i.state_id]?.type;
      if (type === "canceled") continue;
      const e = m.get(i.parent_id);
      if (e) { e.total++; if (type === "completed") e.done++; }
      else m.set(i.parent_id, { total: 1, done: type === "completed" ? 1 : 0 });
    }
    return m;
  }, [issues, states, showSubCounts]);

  /* the selection only ever holds issues this surface shows */
  useEffect(() => {
    const sel = useUI.getState().selected;
    if (!sel.length) return;
    const present = new Set(query.flat.map((i) => i.id));
    if (sel.some((id) => !present.has(id))) ui.setSelected(sel.filter((id) => present.has(id)));
  }, [query.flat]);

  /* context menu */
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const openMenu = useCallback((req: MenuRequest) => setMenu(req), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  /* "+" on a group: the surface defaults plus whatever puts the new issue into that group */
  const latest = useRef({ createDefaults, ctx: query.ctx });
  useLayoutEffect(() => { latest.current = { createDefaults, ctx: query.ctx }; });
  const createInGroup = useCallback((group: IssueGroup) => {
    const { createDefaults: surface = {}, ctx } = latest.current;
    // a team-specific group (a team, or one team's workflow state / cycle) decides the team:
    // "+" on a cycle of another team (project / my-issues boards) creates the issue in that team
    const v = group.value;
    const groupTeam = !v ? undefined
      : group.grouping === "team" ? v
        : group.grouping === "status" ? ctx.states[v]?.team_id
          : group.grouping === "cycle" ? ctx.cycles[v]?.team_id
            : undefined;
    const teamId = groupTeam || surface.team_id || fallbackTeam(useSync.getState());
    if (!teamId) { ui.openCreateIssue(surface); return; }
    const defaults: Partial<Issue> = { ...surface };
    if (surface.team_id && surface.team_id !== teamId) { delete defaults.state_id; delete defaults.cycle_id; }
    const dummy = { ...defaults, team_id: teamId, label_ids: defaults.label_ids ?? [] } as Issue;
    const patch = patchForGroup(group, dummy, ctx) ?? {};
    const merged: Partial<Issue> = { ...defaults, ...patch };
    if (patch.label_ids && defaults.label_ids) merged.label_ids = Array.from(new Set([...defaults.label_ids, ...patch.label_ids]));
    // pin the team whenever the group or the patch is team-specific (a workflow state or a cycle)
    if (groupTeam || "state_id" in patch || "cycle_id" in patch || "team_id" in patch) merged.team_id = teamId;
    ui.openCreateIssue(merged);
  }, []);

  if (!query.flat.length) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hasFilters ? (
          <EmptyState
            icon={<FilterX size={30} strokeWidth={1.5} />}
            title="No issues match your filters"
            body="Try removing a filter or broadening what you’re looking for."
            action={<Button onClick={() => ui.setFilters(viewKey, [])}>Clear filters</Button>}
          />
        ) : (
          empty ?? (
            <EmptyState
              icon={<CircleDot size={30} strokeWidth={1.5} />}
              title="No issues"
              body="Issues created here will show up in this view."
              action={
                <Button variant="primary" icon={<Plus size={14} />} onClick={() => ui.openCreateIssue(createDefaults ?? {})}>
                  Create issue
                </Button>
              }
            />
          )
        )}
      </div>
    );
  }

  return (
    <>
      {query.display.layout === "board" ? (
        <IssueBoard query={query} viewKey={viewKey} openMenu={openMenu} createInGroup={createInGroup} subCounts={subCounts} />
      ) : (
        <IssueList query={query} viewKey={viewKey} openMenu={openMenu} createInGroup={createInGroup} subCounts={subCounts} />
      )}
      <IssueContextMenu menu={menu} onClose={closeMenu} />
    </>
  );
}
