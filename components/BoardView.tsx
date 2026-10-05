"use client";
/* ─── Locus · kanban board with native drag & drop ─── */

import { useState } from "react";
import { Plus } from "lucide-react";
import { STATUSES, type StatusId } from "@/lib/data";
import { identifier, labelById, useLocus, userById } from "@/lib/store";
import { useFilteredIssues } from "./IssuesView";
import { Avatar, LabelDot, PriorityIcon, StatusIcon } from "./ui";

const COLUMNS: StatusId[] = ["backlog", "todo", "in_progress", "in_review", "done"];

export default function BoardView() {
  const issues = useFilteredIssues("team");
  const { updateIssue, select, setNewIssue, showToast } = useLocus();
  const [over, setOver] = useState<StatusId | null>(null);

  return (
    <div className="flex flex-1 gap-3 overflow-x-auto px-4 pb-4 pt-3">
      {COLUMNS.map((col) => {
        const items = issues.filter((i) => i.status === col);
        const meta = STATUSES.find((s) => s.id === col)!;
        return (
          <div
            key={col}
            onDragOver={(e) => { e.preventDefault(); setOver(col); }}
            onDragLeave={() => setOver((o) => (o === col ? null : o))}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/locus-issue");
              if (id) {
                updateIssue(id, { status: col });
                showToast(`Moved to ${meta.name}`);
              }
              setOver(null);
            }}
            className={`flex w-[264px] shrink-0 flex-col rounded-xl border transition-colors ${
              over === col ? "border-accent bg-wash/80" : "border-line bg-raised/60"
            }`}
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <StatusIcon status={col} />
              <span className="text-[12.5px] font-semibold">{meta.name}</span>
              <span className="text-xxs text-faint">{items.length}</span>
              <button
                onClick={() => setNewIssue(true)}
                className="focus-ring ml-auto flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-wash hover:text-ink"
              >
                <Plus size={12} />
              </button>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {items.map((i) => {
                const assignee = userById(i.assigneeId);
                return (
                  <article
                    key={i.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/locus-issue", i.id)}
                    onClick={() => select(i.id)}
                    className="pop cursor-grab rounded-lg border border-line bg-surface p-2.5 shadow-sm transition-shadow hover:shadow-pop active:cursor-grabbing"
                  >
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="font-mono text-xxs text-faint">{identifier(i)}</span>
                      <span className="ml-auto" />
                      {assignee && <Avatar name={assignee.name} initials={assignee.initials} hue={assignee.hue} size={16} />}
                    </div>
                    <p className="mb-2 text-[12.5px] font-medium leading-snug text-ink">{i.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PriorityIcon priority={i.priority} size={12} />
                      {i.labelIds.slice(0, 2).map((lid) => {
                        const l = labelById(lid);
                        return (
                          <span key={lid} className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px text-xxs text-dim">
                            <LabelDot color={l.color} /> {l.name}
                          </span>
                        );
                      })}
                      {i.estimate ? <span className="rounded bg-wash px-1 text-xxs text-dim">{i.estimate}</span> : null}
                    </div>
                  </article>
                );
              })}
              {items.length === 0 && (
                <div className="rounded-lg border border-dashed border-line p-3 text-center text-xxs text-faint">Drop issues here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
