"use client";
/* ─── Locus · project milestones (inline-editable list + add row) ─── */

import { useMemo, useRef, useState } from "react";
import { CalendarDays, Diamond, Plus, Trash2 } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { progressOf } from "@/lib/model";
import { createMilestone, deleteMilestone, updateMilestone } from "@/lib/sync/actions";
import { formatDate, localToday } from "@/lib/format";
import { ui } from "@/lib/ui";
import { Dropdown } from "@/components/primitives/overlay";
import { Button, IconButton } from "@/components/primitives/controls";
import { ProgressRing } from "@/components/primitives/icons";
import { DateMenu } from "./menus";
import { InlineInput, SectionTitle, pct } from "./shared";
import type { Issue, Milestone, Project, WorkflowState } from "@/lib/types";

export default function Milestones({
  project, byMilestone, states,
}: { project: Project; byMilestone: Record<string, Issue[]>; states: Record<string, WorkflowState> }) {
  const all = useSync((s) => s.project_milestones);
  const milestones = useMemo(
    () => Object.values(all).filter((m) => m.project_id === project.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
    [all, project.id],
  );

  return (
    <section aria-label="Milestones">
      <SectionTitle right={milestones.length ? <span className="text-xxs tabular-nums text-faint">{milestones.length}</span> : null}>
        Milestones
      </SectionTitle>
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        {milestones.map((m) => (
          <MilestoneRow key={m.id} milestone={m} issues={byMilestone[m.id] ?? []} states={states} color={project.color} />
        ))}
        <AddMilestone projectId={project.id} first={!milestones.length} />
      </div>
    </section>
  );
}

function MilestoneRow({
  milestone: m, issues, states, color,
}: { milestone: Milestone; issues: Issue[]; states: Record<string, WorkflowState>; color: string }) {
  const prog = progressOf(issues, states);
  const complete = prog.total > 0 && prog.done === prog.total;
  const overdue = Boolean(m.target_date && m.target_date < localToday() && !complete);

  const remove = () => {
    ui.askConfirm({
      title: `Delete milestone “${m.name}”?`,
      body: issues.length
        ? `${issues.length} issue${issues.length === 1 ? "" : "s"} will be removed from this milestone but stay in the project.`
        : "This milestone has no issues.",
      confirmLabel: "Delete milestone",
      destructive: true,
      onConfirm: async () => { await deleteMilestone(m.id); },
    });
  };

  return (
    <div className="group flex min-h-10 items-center gap-2 border-b border-line px-3">
      <Diamond size={13} className={`shrink-0 ${complete ? "fill-current" : ""}`} style={{ color }} aria-label={complete ? "Completed" : undefined} />
      <InlineInput
        value={m.name}
        onSave={(name) => { void updateMilestone(m.id, { name }); }}
        required
        aria-label="Milestone name"
        placeholder="Milestone name"
        className="h-8 flex-1 rounded px-1 text-[13px] text-ink focus:bg-raised"
      />
      <span
        className="flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums text-dim"
        title={prog.total ? `${prog.done} of ${prog.total} issues completed` : "No issues in this milestone"}
      >
        <ProgressRing value={prog.ratio} size={14} color={color} />
        {prog.total ? (
          <>
            <span>{pct(prog.ratio)}%</span>
            <span className="hidden text-faint sm:inline">{prog.done}/{prog.total}</span>
          </>
        ) : (
          <span className="hidden text-faint sm:inline">No issues</span>
        )}
      </span>
      <Dropdown
        width={256}
        align="end"
        trigger={(t) => (
          <button
            ref={t.ref}
            type="button"
            onClick={t.onClick}
            aria-expanded={t["aria-expanded"]}
            aria-label="Milestone target date"
            title={m.target_date ? `Target: ${formatDate(m.target_date, true)}` : "Set target date"}
            className={`focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors hover:bg-wash ${
              overdue ? "text-danger" : m.target_date ? "text-dim" : "text-faint"
            } ${t.open ? "bg-wash" : ""}`}
          >
            <CalendarDays size={13} />
            <span className={m.target_date ? "" : "hidden sm:inline"}>{m.target_date ? formatDate(m.target_date) : "Target"}</span>
          </button>
        )}
      >
        {(close) => <DateMenu value={m.target_date} onChange={(d) => { void updateMilestone(m.id, { target_date: d }); close(); }} clearLabel="Remove target date" />}
      </Dropdown>
      <IconButton
        label="Delete milestone"
        onClick={remove}
        size={32}
        className="transition-opacity md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
      >
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

function AddMilestone({ projectId, first }: { projectId: string; first: boolean }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typing = name.trim().length > 0;

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const d = date;
    setName("");
    setDate(null);
    inputRef.current?.focus();
    const created = await createMilestone(projectId, n, d);
    if (!created) setName((cur) => cur || n); // insert failed (already toasted) — give the text back
  };

  return (
    <div className="flex min-h-10 items-center gap-2 px-3">
      <Plus size={14} className="shrink-0 text-faint" />
      <input
        ref={inputRef}
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void add(); }
          else if (e.key === "Escape" && name) { e.preventDefault(); e.stopPropagation(); setName(""); setDate(null); }
        }}
        placeholder={first ? "Add a milestone to break the project into stages…" : "Add milestone…"}
        aria-label="New milestone name"
        className="h-8 min-w-0 flex-1 bg-transparent px-1 text-[13px] text-ink outline-none placeholder:text-faint"
      />
      {typing && (
        <>
          <Dropdown
            width={256}
            align="end"
            trigger={(t) => (
              <button
                ref={t.ref}
                type="button"
                onClick={t.onClick}
                aria-expanded={t["aria-expanded"]}
                aria-label="New milestone target date"
                className={`focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] hover:bg-wash ${date ? "text-dim" : "text-faint"}`}
              >
                <CalendarDays size={13} />
                <span className={date ? "" : "hidden sm:inline"}>{date ? formatDate(date) : "Target"}</span>
              </button>
            )}
          >
            {(close) => <DateMenu value={date} onChange={(d) => { setDate(d); close(); inputRef.current?.focus(); }} />}
          </Dropdown>
          <Button size="xs" variant="primary" onClick={() => { void add(); }} className="h-8 sm:h-6">Add</Button>
        </>
      )}
    </div>
  );
}
