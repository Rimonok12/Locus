"use client";
/* ─── Locus · new issue modal (C) ─── */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { LABELS, PRIORITIES, PROJECTS, STATUSES, TEAMS, USERS, type Priority, type StatusId } from "@/lib/data";
import { labelById, useLocus } from "@/lib/store";
import { Avatar, LabelDot, Menu, PriorityIcon, StatusIcon } from "./ui";

const pill =
  "focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-canvas px-2 text-[12px] font-medium text-dim hover:text-ink";

export default function NewIssueModal() {
  const { newIssueOpen, setNewIssue, createIssue, activeTeamId } = useLocus();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [teamId, setTeamId] = useState(activeTeamId);
  const [status, setStatus] = useState<StatusId>("todo");
  const [priority, setPriority] = useState<Priority>(0);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [createMore, setCreateMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (newIssueOpen) {
      setTeamId(activeTeamId);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [newIssueOpen, activeTeamId]);

  if (!newIssueOpen) return null;
  const team = TEAMS.find((t) => t.id === teamId)!;

  const reset = () => { setTitle(""); setDesc(""); setPriority(0); setStatus("todo"); setAssigneeId(null); setLabelIds([]); setProjectId(null); };
  const submit = () => {
    if (!title.trim()) return;
    createIssue({ title: title.trim(), description: desc, teamId, status, priority, assigneeId, labelIds, projectId });
    reset();
    if (!createMore) setNewIssue(false);
    else inputRef.current?.focus();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh]"
      style={{ background: "rgba(17,45,78,0.38)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => e.target === e.currentTarget && setNewIssue(false)}
    >
      <div className="pop w-[640px] max-w-[94vw] rounded-xl border border-line bg-surface shadow-pop">
        <header className="flex items-center gap-2 px-4 pt-3">
          <Menu
            button={<button className="focus-ring inline-flex h-6 items-center gap-1.5 rounded border border-line px-1.5 text-xxs font-semibold text-dim">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[8px] font-bold text-white" style={{ background: `hsl(${team.hue} 48% 48%)` }}>{team.key[0]}</span>
              {team.key}
            </button>}
            items={TEAMS}
            onPick={(t) => setTeamId(t.id)}
            render={(t) => (<>{t.name} ({t.key})</>)}
            width={200}
          />
          <span className="text-xxs text-faint">› New issue</span>
          <button onClick={() => setNewIssue(false)} className="focus-ring ml-auto flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-wash hover:text-ink">
            <X size={14} />
          </button>
        </header>

        <div className="px-4 pb-1 pt-2">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="Issue title"
            className="w-full bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:text-faint"
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Add description…"
            rows={3}
            className="mt-1.5 w-full resize-none bg-transparent text-[12.5px] leading-relaxed text-dim outline-none placeholder:text-faint"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          <Menu button={<button className={pill}><StatusIcon status={status} /> {STATUSES.find((s) => s.id === status)!.name}</button>}
            items={STATUSES} onPick={(s) => setStatus(s.id)} render={(s) => (<><StatusIcon status={s.id} /> {s.name}</>)} />
          <Menu button={<button className={pill}><PriorityIcon priority={priority} /> {PRIORITIES[priority].name}</button>}
            items={PRIORITIES} onPick={(p) => setPriority(p.id)} render={(p) => (<><PriorityIcon priority={p.id} /> {p.name}</>)} />
          <Menu button={<button className={pill}>{assigneeId ? USERS.find((u) => u.id === assigneeId)!.name.split(" ")[0] : "Assignee"}</button>}
            items={[null, ...USERS] as (typeof USERS[number] | null)[]}
            onPick={(u) => setAssigneeId(u ? u.id : null)}
            render={(u) => (u ? (<><Avatar initials={u.initials} hue={u.hue} size={16} /> {u.name}</>) : (<>Unassigned</>))} />
          <Menu button={<button className={pill}>{labelIds.length ? `${labelIds.length} label${labelIds.length > 1 ? "s" : ""}` : "Labels"}</button>}
            items={LABELS}
            onPick={(l) => setLabelIds((ids) => (ids.includes(l.id) ? ids.filter((x) => x !== l.id) : [...ids, l.id]))}
            render={(l) => (<><LabelDot color={l.color} /> {l.name} {labelIds.includes(l.id) ? "✓" : ""}</>)} />
          <Menu button={<button className={pill}>{projectId ? PROJECTS.find((p) => p.id === projectId)!.name : "Project"}</button>}
            items={[null, ...PROJECTS] as (typeof PROJECTS[number] | null)[]}
            onPick={(p) => setProjectId(p ? p.id : null)}
            render={(p) => (p ? (<><span style={{ color: p.color }}>{p.glyph}</span> {p.name}</>) : (<>No project</>))} />
          {labelIds.map((lid) => {
            const l = labelById(lid);
            return (
              <span key={lid} className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px text-xxs text-dim">
                <LabelDot color={l.color} /> {l.name}
              </span>
            );
          })}
        </div>

        <footer className="flex items-center gap-3 border-t border-line px-4 py-2.5">
          <label className="flex cursor-pointer items-center gap-1.5 text-xxs text-dim">
            <input type="checkbox" checked={createMore} onChange={(e) => setCreateMore(e.target.checked)} className="accent-[var(--accent)]" />
            Create more
          </label>
          <span className="ml-auto text-xxs text-faint"><kbd>⌘</kbd> <kbd>↵</kbd> to create</span>
          <button
            onClick={submit}
            disabled={!title.trim()}
            className="focus-ring h-7 rounded-md bg-accent px-3 text-[12px] font-semibold text-accent-ink disabled:opacity-40"
          >
            Create issue
          </button>
        </footer>
      </div>
    </div>
  );
}
