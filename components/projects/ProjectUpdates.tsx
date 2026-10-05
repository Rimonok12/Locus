"use client";
/* ─── Locus · project updates tab (composer + feed) ─── */

import { useRef, useState } from "react";
import { ArrowRight, Megaphone, Trash2 } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { HEALTH, displayName, useIsAdmin, useMe } from "@/lib/model";
import { deleteProjectUpdate, postProjectUpdate } from "@/lib/sync/actions";
import { formatDateTime, modKey, timeAgo } from "@/lib/format";
import { ui } from "@/lib/ui";
import { Button, IconButton } from "@/components/primitives/controls";
import { Avatar } from "@/components/primitives/Avatar";
import { HealthDot } from "@/components/primitives/icons";
import Editor, { RichText, isEmptyHtml } from "@/components/editor/Editor";
import ProjectHeader from "./ProjectHeader";
import { HealthBadge, useProjectUpdates } from "./shared";
import type { Health, Project, ProjectUpdate } from "@/lib/types";

export default function ProjectUpdates({ project }: { project: Project }) {
  const updates = useProjectUpdates(project.id);
  return (
    <>
      <ProjectHeader project={project} tab="updates" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-6 sm:px-8 sm:pt-8">
          <Composer project={project} />
          <div className="mt-8">
            {updates.length ? (
              <ol className="space-y-3" aria-label="Project updates">
                {updates.map((u, i) => <UpdateItem key={u.id} update={u} previous={updates[i + 1]} />)}
              </ol>
            ) : (
              <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
                <Megaphone size={22} strokeWidth={1.6} className="text-faint" />
                <p className="mt-3 text-[13px] font-medium text-ink">No updates yet</p>
                <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-dim">
                  Regular updates keep everyone aligned. Each one records the project’s health and notifies its lead and members.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══ composer ═══ */

function Composer({ project }: { project: Project }) {
  const me = useMe();
  const draftKey = `locus:project-update-draft:${project.id}`;
  const [initial] = useState(() => {
    try { return window.localStorage.getItem(draftKey) ?? ""; } catch { return ""; }
  });
  const [body, setBody] = useState(initial);
  // follows the project's current health (incl. teammates' updates) until the author picks one
  const [picked, setPicked] = useState<Health | null>(null);
  const health: Health = picked ?? project.health ?? "on_track";
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const empty = isEmptyHtml(body);

  const persistDraft = (html: string) => {
    try {
      if (isEmptyHtml(html)) window.localStorage.removeItem(draftKey);
      else window.localStorage.setItem(draftKey, html);
    } catch { /* storage unavailable */ }
  };

  const post = async () => {
    if (busyRef.current || isEmptyHtml(body)) return;
    busyRef.current = true;
    setBusy(true);
    const created = await postProjectUpdate(project.id, health, body);
    busyRef.current = false;
    setBusy(false);
    if (!created) return; // failure already toasted; keep the draft
    setBody("");
    persistDraft("");
    setEditorKey((k) => k + 1);
    // postProjectUpdate mirrors the new health onto the project (the DB trigger sets it server-side);
    // never write it from here — a second write could overwrite a newer update's health.
    setPicked(null);
  };
  // the editor may keep the first onSubmit it receives — always call the latest post
  const postRef = useRef(post);
  postRef.current = post;

  return (
    <div className="rounded-lg border border-line bg-surface shadow-card transition-colors focus-within:border-line-strong">
      <div className="flex items-center gap-2 px-4 pt-3.5">
        <Avatar profile={me} size={20} />
        <span className="text-[12.5px] font-medium text-dim">New update</span>
      </div>
      <div className="px-4 pb-2 pt-2">
        <Editor
          key={editorKey}
          value={editorKey === 0 ? initial : ""}
          onChange={(html) => { setBody(html); persistDraft(html); }}
          onSubmit={() => { void postRef.current(); }}
          placeholder="How is the project going? Share progress, risks and next steps…"
          compact
          minHeight={88}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
        <div role="radiogroup" aria-label="Project health" className="inline-flex items-center gap-0.5 rounded-md border border-line bg-raised p-0.5">
          {HEALTH.map((h) => {
            const active = health === h.value;
            return (
              <button
                key={h.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPicked(h.value)}
                className={`focus-ring flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-[12px] font-medium transition-colors sm:h-6 ${
                  active ? "bg-surface text-ink shadow-card" : "text-faint hover:text-dim"
                }`}
              >
                <HealthDot health={h.value} size={7} />
                {h.label}
              </button>
            );
          })}
        </div>
        <span className="ml-auto hidden text-xxs text-faint sm:inline"><kbd>{modKey()}</kbd> <kbd>↵</kbd></span>
        <Button variant="primary" size="sm" onClick={() => { void post(); }} disabled={empty} loading={busy} className="ml-auto h-8 sm:ml-0 sm:h-7">
          Post update
        </Button>
      </div>
    </div>
  );
}

/* ═══ feed ═══ */

function UpdateItem({ update: u, previous }: { update: ProjectUpdate; previous?: ProjectUpdate }) {
  const author = useSync((s) => (u.user_id ? s.profiles[u.user_id] : undefined));
  const me = useSync((s) => s.userId);
  const isAdmin = useIsAdmin();
  const canDelete = u.user_id === me || isAdmin;
  const healthChanged = previous && previous.health !== u.health;

  const remove = () => {
    ui.askConfirm({
      title: "Delete this update?",
      body: "The update is removed for everyone. The project’s current health isn’t changed.",
      confirmLabel: "Delete update",
      destructive: true,
      onConfirm: async () => { await deleteProjectUpdate(u.id); },
    });
  };

  return (
    <li className="group rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="flex min-w-0 items-center gap-2">
        <Avatar profile={author ?? null} size={22} />
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{displayName(author)}</span>
        <time dateTime={u.created_at} title={formatDateTime(u.created_at)} className="shrink-0 text-[12px] text-faint">{timeAgo(u.created_at)}</time>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <HealthBadge health={u.health} />
          {canDelete && (
            <IconButton
              label="Delete update"
              onClick={remove}
              size={30}
              className="transition-opacity md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <Trash2 size={14} />
            </IconButton>
          )}
        </span>
      </div>
      {healthChanged && previous && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-faint">
          Health changed
          <HealthBadge health={previous.health} size="xs" />
          <ArrowRight size={11} />
          <HealthBadge health={u.health} size="xs" />
        </div>
      )}
      <div className="mt-3">
        {isEmptyHtml(u.body) ? <p className="text-[13px] text-faint">No details were added.</p> : <RichText html={u.body} compact />}
      </div>
    </li>
  );
}
