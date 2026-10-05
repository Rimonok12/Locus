"use client";
/* ─── Locus · sub-issues: progress, rows, inline creation ─── */

import { useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { issueKey, progressOf } from "@/lib/model";
import { linkProps } from "@/lib/router";
import { createIssue } from "@/lib/sync/actions";
import { PropertyChip } from "@/components/pickers";
import { ProgressRing } from "@/components/primitives/icons";
import { IconButton } from "@/components/primitives/controls";
import type { Issue } from "@/lib/types";

function SubIssueRow({ sub }: { sub: Issue }) {
  const teams = useSync((s) => s.teams);
  const key = issueKey(sub, teams);
  return (
    <div className="group flex h-9 items-center gap-1.5 rounded-md pl-0.5 pr-1 transition-colors hover:bg-wash">
      <span className="inline-flex sm:[&>button]:h-7 sm:[&>button]:w-7">
        <PropertyChip issue={sub} kind="status" variant="icon" />
      </span>
      <a {...linkProps({ kind: "issue", identifier: key })} className="flex h-full min-w-0 flex-1 items-center gap-2 text-[13px]">
        <span className="w-[62px] shrink-0 truncate text-[12px] tabular-nums text-faint">{key}</span>
        <span className="min-w-0 truncate text-ink">{sub.title}</span>
      </a>
      <span className="hidden sm:inline-flex sm:[&>button]:h-7 sm:[&>button]:w-7"><PropertyChip issue={sub} kind="priority" variant="icon" /></span>
      <span className="inline-flex sm:[&>button]:h-7 sm:[&>button]:w-7">
        <PropertyChip issue={sub} kind="assignee" variant="icon" />
      </span>
    </div>
  );
}

function AddSubIssue({ parent, onClose, inputRef: ref }: { parent: Issue; onClose: () => void; inputRef: React.RefObject<HTMLInputElement> }) {
  const [title, setTitle] = useState("");
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    void createIssue(
      { team_id: parent.team_id, parent_id: parent.id, project_id: parent.project_id, cycle_id: parent.cycle_id, title: t },
      { silent: true },
    );
    ref.current?.focus();
  };
  return (
    <form
      className="mt-1 flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <Plus size={14} className="shrink-0 text-faint" />
      <input
        ref={ref}
        autoFocus
        value={title}
        maxLength={512}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
        }}
        onBlur={() => { if (!title.trim()) onClose(); }}
        placeholder="Sub-issue title — Enter to add, Esc to close"
        className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
      />
      <button
        type="submit"
        disabled={!title.trim()}
        onMouseDown={(e) => e.preventDefault()}
        className="focus-ring h-8 shrink-0 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-ink transition-opacity hover:bg-accent-hover disabled:opacity-40 sm:h-7"
      >
        Add
      </button>
    </form>
  );
}

/** Sub-issue section (`subs` = useSubIssues(issue.id)). Renders nothing when there are none and `adding` is false. */
export function SubIssues({ issue, subs, adding, setAdding }: { issue: Issue; subs: Issue[]; adding: boolean; setAdding: (v: boolean) => void }) {
  const states = useSync((s) => s.workflow_states);
  const [open, setOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  if (!subs.length && !adding) return null;
  const p = progressOf(subs, states);

  return (
    <section className="mt-8">
      <div className="mb-1 flex h-8 items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="focus-ring -ml-1 flex h-8 items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-ink hover:bg-wash sm:h-7"
          aria-expanded={open}
        >
          <ChevronDown size={13} className={`text-faint transition-transform ${open ? "" : "-rotate-90"}`} />
          Sub-issues
        </button>
        {subs.length > 0 && (
          <span className="flex items-center gap-1.5 text-[12px] tabular-nums text-faint">
            <ProgressRing value={p.ratio} size={14} color="var(--accent)" />
            {p.done}/{p.total}
          </span>
        )}
        <IconButton label="Add sub-issue" size={32} className="ml-auto" onClick={() => { setOpen(true); setAdding(true); inputRef.current?.focus(); }}>
          <Plus size={15} />
        </IconButton>
      </div>
      {open && (
        <div>
          <div className="space-y-px">
            {subs.map((s) => <SubIssueRow key={s.id} sub={s} />)}
          </div>
          {adding && <AddSubIssue parent={issue} inputRef={inputRef} onClose={() => setAdding(false)} />}
        </div>
      )}
    </section>
  );
}
