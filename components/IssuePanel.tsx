"use client";
/* ─── Locus · issue detail side panel ─── */

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { CYCLES, LABELS, PRIORITIES, PROJECTS, STATUSES, USERS } from "@/lib/data";
import { cycleById, identifier, labelById, projectById, useLocus, userById } from "@/lib/store";
import { Avatar, LabelDot, Menu, PriorityIcon, StatusIcon, timeAgo } from "./ui";

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-[76px] shrink-0 text-xxs font-medium uppercase tracking-wide text-faint">{label}</span>
      {children}
    </div>
  );
}

const propBtn =
  "focus-ring flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] font-medium text-ink hover:border-accent/50";

export default function IssuePanel() {
  const { selectedIssueId, issues, select, updateIssue, deleteIssue, addComment } = useLocus();
  const issue = issues.find((i) => i.id === selectedIssueId) ?? null;
  const [comment, setComment] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    if (issue) { setTitle(issue.title); setDesc(issue.description); }
  }, [issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [select]);

  if (!issue) return null;
  const assignee = userById(issue.assigneeId);
  const project = projectById(issue.projectId);
  const cycle = cycleById(issue.cycleId);

  return (
    <aside className="pop flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-surface shadow-panel">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-xxs text-faint">{identifier(issue)}</span>
        <span className="text-xxs text-faint">· updated {timeAgo(issue.updatedAt)} ago</span>
        <button
          onClick={() => deleteIssue(issue.id)}
          title="Delete issue"
          className="focus-ring ml-auto flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-wash hover:text-[#e5484d]"
        >
          <Trash2 size={13} />
        </button>
        <button onClick={() => select(null)} className="focus-ring flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-wash hover:text-ink">
          <X size={14} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== issue.title && updateIssue(issue.id, { title: title.trim() })}
          rows={2}
          className="w-full resize-none bg-transparent text-[15px] font-semibold leading-snug text-ink outline-none placeholder:text-faint"
          placeholder="Issue title"
        />
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== issue.description && updateIssue(issue.id, { description: desc })}
          rows={5}
          className="mt-1 w-full resize-none rounded-md bg-transparent text-[12.5px] leading-relaxed text-dim outline-none placeholder:text-faint"
          placeholder="Add a description…"
        />

        <div className="mt-3 border-t border-line pt-3">
          <Prop label="Status">
            <Menu
              button={<button className={propBtn}><StatusIcon status={issue.status} /> {STATUSES.find((s) => s.id === issue.status)!.name}</button>}
              items={STATUSES}
              onPick={(s) => updateIssue(issue.id, { status: s.id })}
              render={(s) => (<><StatusIcon status={s.id} /> {s.name}</>)}
            />
          </Prop>
          <Prop label="Priority">
            <Menu
              button={<button className={propBtn}><PriorityIcon priority={issue.priority} /> {PRIORITIES[issue.priority].name}</button>}
              items={PRIORITIES}
              onPick={(p) => updateIssue(issue.id, { priority: p.id })}
              render={(p) => (<><PriorityIcon priority={p.id} /> {p.name}</>)}
            />
          </Prop>
          <Prop label="Assignee">
            <Menu
              button={
                <button className={propBtn}>
                  {assignee ? (<><Avatar initials={assignee.initials} hue={assignee.hue} size={16} /> {assignee.name}</>) : "Unassigned"}
                </button>
              }
              items={[null, ...USERS] as (typeof USERS[number] | null)[]}
              onPick={(u) => updateIssue(issue.id, { assigneeId: u ? u.id : null })}
              render={(u) => (u ? (<><Avatar initials={u.initials} hue={u.hue} size={16} /> {u.name}</>) : (<>Unassigned</>))}
            />
          </Prop>
          <Prop label="Labels">
            <div className="flex flex-wrap items-center gap-1">
              {issue.labelIds.map((lid) => {
                const l = labelById(lid);
                return (
                  <button
                    key={lid}
                    onClick={() => updateIssue(issue.id, { labelIds: issue.labelIds.filter((x) => x !== lid) })}
                    title="Remove label"
                    className="focus-ring inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px text-xxs text-dim hover:border-[#e5484d]/60"
                  >
                    <LabelDot color={l.color} /> {l.name}
                  </button>
                );
              })}
              <Menu
                button={<button className="focus-ring rounded-full border border-dashed border-line px-2 py-px text-xxs text-faint hover:text-ink">+ Add</button>}
                items={LABELS.filter((l) => !issue.labelIds.includes(l.id))}
                onPick={(l) => updateIssue(issue.id, { labelIds: [...issue.labelIds, l.id] })}
                render={(l) => (<><LabelDot color={l.color} /> {l.name}</>)}
              />
            </div>
          </Prop>
          <Prop label="Project">
            <Menu
              button={<button className={propBtn}>{project ? (<><span style={{ color: project.color }}>{project.glyph}</span> {project.name}</>) : "No project"}</button>}
              items={[null, ...PROJECTS] as (typeof PROJECTS[number] | null)[]}
              onPick={(p) => updateIssue(issue.id, { projectId: p ? p.id : null })}
              render={(p) => (p ? (<><span style={{ color: p.color }}>{p.glyph}</span> {p.name}</>) : (<>No project</>))}
            />
          </Prop>
          <Prop label="Cycle">
            <Menu
              button={<button className={propBtn}>{cycle ? `Cycle ${cycle.number}` : "No cycle"}</button>}
              items={[null, ...CYCLES.filter((c) => c.teamId === issue.teamId)] as (typeof CYCLES[number] | null)[]}
              onPick={(c) => updateIssue(issue.id, { cycleId: c ? c.id : null })}
              render={(c) => (c ? (<>Cycle {c.number} · {c.start.slice(5)} → {c.end.slice(5)}</>) : (<>No cycle</>))}
            />
          </Prop>
          <Prop label="Estimate">
            <Menu
              button={<button className={propBtn}>{issue.estimate ?? "—"} pts</button>}
              items={[null, 1, 2, 3, 5, 8, 13] as (number | null)[]}
              onPick={(e) => updateIssue(issue.id, { estimate: e })}
              render={(e) => <>{e ?? "No estimate"}</>}
              width={140}
            />
          </Prop>
        </div>

        {/* activity */}
        <div className="mt-4 border-t border-line pt-3">
          <h4 className="mb-2 text-xxs font-semibold uppercase tracking-wide text-faint">Activity</h4>
          <div className="space-y-2.5">
            {issue.comments.map((c) => {
              const u = userById(c.userId)!;
              return (
                <div key={c.id} className="flex gap-2">
                  <Avatar initials={u.initials} hue={u.hue} size={20} />
                  <div className="min-w-0">
                    <p className="text-xxs text-faint">
                      <span className="font-semibold text-dim">{u.name}</span> · {timeAgo(c.at)} ago
                    </p>
                    <p className="text-[12.5px] text-ink">{c.body}</p>
                  </div>
                </div>
              );
            })}
            {issue.comments.length === 0 && <p className="text-xxs text-faint">No comments yet.</p>}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-line p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) { addComment(issue.id, comment.trim()); setComment(""); }
          }}
          className="flex gap-2"
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Leave a comment…"
            className="focus-ring h-8 flex-1 rounded-md border border-line bg-canvas px-2 text-[12.5px] text-ink outline-none placeholder:text-faint"
          />
          <button type="submit" className="focus-ring h-8 rounded-md bg-accent px-3 text-[12px] font-semibold text-accent-ink disabled:opacity-40" disabled={!comment.trim()}>
            Send
          </button>
        </form>
      </footer>
    </aside>
  );
}
