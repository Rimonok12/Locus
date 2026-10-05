"use client";
/* ─── Locus · grouped issue list ─── */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, SlidersHorizontal, X } from "lucide-react";
import { LABELS, PRIORITIES, STATUSES, USERS, type Issue, type StatusId } from "@/lib/data";
import { identifier, labelById, projectById, useLocus, userById } from "@/lib/store";
import { Avatar, Chip, LabelDot, Menu, PriorityIcon, StatusIcon, timeAgo } from "./ui";

export function useFilteredIssues(scope: "team" | "mine") {
  const { issues, activeTeamId, filterAssignee, filterPriority, filterLabel } = useLocus();
  return useMemo(() => {
    let list = issues;
    if (scope === "team") list = list.filter((i) => i.teamId === activeTeamId);
    if (scope === "mine") list = list.filter((i) => i.assigneeId === "u1");
    if (filterAssignee) list = list.filter((i) => i.assigneeId === filterAssignee);
    if (filterPriority !== null) list = list.filter((i) => i.priority === filterPriority);
    if (filterLabel) list = list.filter((i) => i.labelIds.includes(filterLabel));
    return list;
  }, [issues, activeTeamId, scope, filterAssignee, filterPriority, filterLabel]);
}

export function FilterBar() {
  const { filterAssignee, filterPriority, filterLabel, setFilters, clearFilters } = useLocus();
  const any = filterAssignee || filterPriority !== null || filterLabel;
  return (
    <div className="flex items-center gap-1.5">
      <Menu
        button={<Chip><SlidersHorizontal size={11} /> Assignee{filterAssignee ? `: ${userById(filterAssignee)?.name.split(" ")[0]}` : ""}</Chip>}
        items={USERS}
        onPick={(u) => setFilters({ filterAssignee: u.id })}
        render={(u) => (<><Avatar initials={u.initials} hue={u.hue} size={16} /> {u.name}</>)}
      />
      <Menu
        button={<Chip>Priority{filterPriority !== null ? `: ${PRIORITIES[filterPriority].name}` : ""}</Chip>}
        items={PRIORITIES.slice(1)}
        onPick={(p) => setFilters({ filterPriority: p.id })}
        render={(p) => (<><PriorityIcon priority={p.id} /> {p.name}</>)}
      />
      <Menu
        button={<Chip>Label{filterLabel ? `: ${labelById(filterLabel).name}` : ""}</Chip>}
        items={LABELS}
        onPick={(l) => setFilters({ filterLabel: l.id })}
        render={(l) => (<><LabelDot color={l.color} /> {l.name}</>)}
      />
      {any && (
        <Chip onClick={clearFilters}><X size={11} /> Clear</Chip>
      )}
    </div>
  );
}

export function IssueRow({ issue }: { issue: Issue }) {
  const { select, updateIssue } = useLocus();
  const assignee = userById(issue.assigneeId);
  const project = projectById(issue.projectId);

  return (
    <div
      onClick={() => select(issue.id)}
      className="row-hover group flex h-9 cursor-pointer items-center gap-2.5 border-b border-line/60 px-4"
    >
      <Menu
        button={<button className="focus-ring flex h-5 w-5 items-center justify-center rounded hover:bg-wash" title="Priority"><PriorityIcon priority={issue.priority} /></button>}
        items={PRIORITIES}
        onPick={(p) => updateIssue(issue.id, { priority: p.id })}
        render={(p) => (<><PriorityIcon priority={p.id} /> {p.name}</>)}
        width={180}
      />
      <span className="w-[62px] shrink-0 font-mono text-xxs text-faint">{identifier(issue)}</span>
      <Menu
        button={<button className="focus-ring flex h-5 w-5 items-center justify-center rounded hover:bg-wash" title="Status"><StatusIcon status={issue.status} /></button>}
        items={STATUSES}
        onPick={(s) => updateIssue(issue.id, { status: s.id })}
        render={(s) => (<><StatusIcon status={s.id} /> {s.name}</>)}
        width={180}
      />
      <span className="truncate text-[13px] font-medium text-ink">{issue.title}</span>

      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {issue.labelIds.slice(0, 2).map((lid) => {
          const l = labelById(lid);
          return (
            <span key={lid} className="hidden items-center gap-1 rounded-full border border-line px-1.5 py-px text-xxs text-dim md:inline-flex">
              <LabelDot color={l.color} /> {l.name}
            </span>
          );
        })}
        {project && (
          <span className="hidden items-center gap-1 rounded-full border border-line px-1.5 py-px text-xxs text-dim lg:inline-flex">
            <span style={{ color: project.color }}>{project.glyph}</span> {project.name}
          </span>
        )}
        {issue.estimate ? <span className="hidden rounded bg-wash px-1 text-xxs text-dim sm:inline">{issue.estimate}</span> : null}
        <span className="w-8 text-right text-xxs text-faint">{timeAgo(issue.updatedAt)}</span>
        {assignee ? (
          <Avatar name={assignee.name} initials={assignee.initials} hue={assignee.hue} />
        ) : (
          <span className="h-[18px] w-[18px] rounded-full border border-dashed border-line" />
        )}
      </span>
    </div>
  );
}

export default function IssuesView({ scope = "team" }: { scope?: "team" | "mine" }) {
  const issues = useFilteredIssues(scope);
  const { setNewIssue } = useLocus();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = STATUSES.map((s) => ({ status: s, items: issues.filter((i) => i.status === s.id) })).filter(
    (g) => g.items.length > 0
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map(({ status, items }) => (
        <section key={status.id}>
          <header
            className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-line bg-raised/95 px-4 backdrop-blur"
          >
            <button onClick={() => setCollapsed((c) => ({ ...c, [status.id]: !c[status.id] }))} className="focus-ring text-faint">
              {collapsed[status.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
            <StatusIcon status={status.id as StatusId} />
            <span className="text-[12.5px] font-semibold">{status.name}</span>
            <span className="text-xxs text-faint">{items.length}</span>
            <button
              onClick={() => setNewIssue(true)}
              className="focus-ring ml-auto flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-wash hover:text-ink"
              title="New issue"
            >
              <Plus size={12} />
            </button>
          </header>
          {!collapsed[status.id] && items.map((i) => <IssueRow key={i.id} issue={i} />)}
        </section>
      ))}
      {groups.length === 0 && (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-dim">
          <span className="text-2xl">◎</span>
          <p className="text-[13px]">No issues match the current filters.</p>
          <button onClick={() => setNewIssue(true)} className="focus-ring rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-ink">
            New issue <kbd className="ml-1 border-accent-ink/40 bg-transparent text-accent-ink">C</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
