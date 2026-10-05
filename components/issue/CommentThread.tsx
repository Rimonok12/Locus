"use client";
/* ─── Locus · comment threads: card, reactions, actions, inline edit, replies ─── */

import { memo, useMemo, useRef, useState } from "react";
import { Link2, MoreHorizontal, Pencil, Reply, SmilePlus, Trash2 } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui } from "@/lib/ui";
import { displayName, useIsAdmin, useMeId } from "@/lib/model";
import { formatDateTime, timeAgo } from "@/lib/format";
import { addComment, copyText, deleteComment, editComment, issueUrl, toggleReaction } from "@/lib/sync/actions";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import { Avatar } from "@/components/primitives/Avatar";
import { Button } from "@/components/primitives/controls";
import Editor, { RichText, isEmptyHtml } from "@/components/editor/Editor";
import type { Comment } from "@/lib/types";
import { COMMENT_TOO_LONG, Composer, MAX_COMMENT_CHARS } from "./Composer";
import { exceedsChars } from "./shared";

export const REACTIONS = ["👍", "👎", "❤️", "🎉", "😄", "😕", "🚀", "👀"];

/* ─── reactions ─── */

function ReactionPicker({ commentId, compact }: { commentId: string; compact?: boolean }) {
  return (
    <Dropdown
      align="end"
      trigger={(p) => (
        <button
          ref={p.ref}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-label="Add reaction"
          title="Add reaction"
          className={compact
            ? `focus-ring inline-flex h-8 w-9 items-center justify-center rounded-full border sm:h-7 sm:w-8 border-line text-faint transition-colors hover:border-line-strong hover:bg-wash hover:text-ink ${p.open ? "bg-wash text-ink" : ""}`
            : `focus-ring flex h-8 w-8 items-center justify-center rounded-md text-faint transition-colors hover:bg-wash hover:text-ink ${p.open ? "bg-wash text-ink" : ""}`}
        >
          <SmilePlus size={compact ? 13 : 15} />
        </button>
      )}
    >
      {(close) => (
        <div className="grid grid-cols-4 gap-0.5 p-1.5" role="menu" aria-label="Reactions">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              role="menuitem"
              onClick={() => { void toggleReaction(commentId, emoji); close(); }}
              className="flex h-9 w-9 items-center justify-center rounded-md text-[18px] leading-none transition-transform hover:scale-110 hover:bg-wash"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

function ReactionsBar({ commentId }: { commentId: string }) {
  const reactions = useSync((s) => s.reactions);
  const profiles = useSync((s) => s.profiles);
  const me = useMeId();
  const groups = useMemo(() => {
    const map = new Map<string, { emoji: string; users: string[]; mine: boolean; first: string }>();
    for (const r of Object.values(reactions)) {
      if (r.comment_id !== commentId) continue;
      const g = map.get(r.emoji) ?? { emoji: r.emoji, users: [], mine: false, first: r.created_at };
      g.users.push(r.user_id);
      if (r.user_id === me) g.mine = true;
      if (r.created_at < g.first) g.first = r.created_at;
      map.set(r.emoji, g);
    }
    return Array.from(map.values()).sort((a, b) => a.first.localeCompare(b.first));
  }, [reactions, commentId, me]);

  if (!groups.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {groups.map((g) => (
        <button
          key={g.emoji}
          onClick={() => void toggleReaction(commentId, g.emoji)}
          aria-pressed={g.mine}
          title={g.users.map((u) => (u === me ? "You" : displayName(profiles[u]))).join(", ")}
          className={`focus-ring inline-flex h-8 items-center gap-1 rounded-full border px-2 text-[12px] font-medium tabular-nums transition-colors sm:h-7 ${
            g.mine ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface text-dim hover:border-line-strong hover:bg-wash"
          }`}
        >
          <span className="text-[13px] leading-none">{g.emoji}</span>
          {g.users.length}
        </button>
      ))}
      <ReactionPicker commentId={commentId} compact />
    </div>
  );
}

/* ─── a single comment (top-level or reply) ─── */

function copyCommentLink(issueId: string, commentId: string) {
  const issue = useSync.getState().issues[issueId];
  if (issue) copyText(`${issueUrl(issue)}#comment-${commentId}`, "Comment link copied");
}

function CommentItem({
  comment, issueId, onReply, replyCount, highlighted, readOnly,
}: {
  comment: Comment;
  issueId: string;
  onReply?: () => void;
  replyCount: number;
  highlighted: boolean;
  readOnly?: boolean;
}) {
  const author = useSync((s) => (comment.user_id ? s.profiles[comment.user_id] : undefined));
  const me = useMeId();
  const isAdmin = useIsAdmin();
  const mine = comment.user_id === me;
  const [editing, setEditing] = useState(false);
  const draft = useRef(comment.body);
  const [canSave, setCanSave] = useState(true);

  const startEdit = () => {
    draft.current = comment.body;
    setCanSave(!isEmptyHtml(comment.body));
    setEditing(true);
  };
  const save = () => {
    const body = draft.current;
    if (isEmptyHtml(body)) return;
    // the database would refuse it: keep the editor open so nothing is lost
    if (body !== comment.body && exceedsChars(body, MAX_COMMENT_CHARS)) { toast.error(COMMENT_TOO_LONG); return; }
    if (body !== comment.body) void editComment(comment.id, body);
    setEditing(false);
  };

  const remove = () =>
    ui.askConfirm({
      title: "Delete comment?",
      body: replyCount ? `The comment and its ${replyCount} ${replyCount === 1 ? "reply" : "replies"} will be deleted. This can't be undone.` : "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: async () => { await deleteComment(comment.id); },
    });

  const items = [
    ...(onReply ? [{ id: "reply", label: "Reply", icon: <Reply size={14} />, onSelect: onReply }] : []),
    { id: "link", label: "Copy link", icon: <Link2 size={14} />, onSelect: () => copyCommentLink(issueId, comment.id) },
    ...(mine ? [{ id: "edit", label: "Edit", icon: <Pencil size={14} />, onSelect: startEdit }] : []),
    ...(mine || isAdmin ? [{ id: "delete", label: "Delete", icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: remove }] : []),
  ];

  return (
    <div
      id={`comment-${comment.id}`}
      className={`group scroll-mt-24 px-3 py-2.5 transition-colors duration-700 sm:px-4 ${highlighted ? "bg-accent-soft" : ""}`}
    >
      <div className="flex min-h-7 items-center gap-2">
        <Avatar profile={author} size={20} />
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{author ? displayName(author) : "Former member"}</span>
        <span className="shrink-0 text-xxs text-faint" title={formatDateTime(comment.created_at)}>
          {timeAgo(comment.created_at)}
        </span>
        {comment.edited_at && <span className="shrink-0 text-xxs text-faint" title={`Edited ${formatDateTime(comment.edited_at)}`}>(edited)</span>}
        {!readOnly && !editing && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:hover)]:opacity-0">
            <ReactionPicker commentId={comment.id} />
            <Dropdown
              align="end"
              trigger={(p) => (
                <button
                  ref={p.ref}
                  onClick={p.onClick}
                  aria-expanded={p["aria-expanded"]}
                  aria-label="Comment actions"
                  title="More"
                  className={`focus-ring flex h-8 w-8 items-center justify-center rounded-md text-faint transition-colors hover:bg-wash hover:text-ink ${p.open ? "bg-wash text-ink" : ""}`}
                >
                  <MoreHorizontal size={15} />
                </button>
              )}
            >
              {(close) => <ActionMenu items={items} onDone={close} />}
            </Dropdown>
          </div>
        )}
      </div>
      <div className="mt-1 pl-7">
        {editing ? (
          <div
            onKeyDown={(e) => {
              // a plain Escape (not one that closed the @mention popup) cancels editing
              if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); setEditing(false); }
            }}
          >
            <div className="rounded-md border border-line-strong bg-surface px-2.5 py-2 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
              <Editor
                value={comment.body}
                autoFocus
                compact
                minHeight={40}
                onChange={(h) => { draft.current = h; setCanSave(!isEmptyHtml(h)); }}
                onSubmit={save}
              />
            </div>
            <div className="mt-2 flex justify-end gap-1.5">
              <Button variant="ghost" size="md" onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="primary" size="md" disabled={!canSave} onClick={save}>Save</Button>
            </div>
          </div>
        ) : (
          <RichText html={comment.body} compact />
        )}
        {!editing && !readOnly && <ReactionsBar commentId={comment.id} />}
      </div>
    </div>
  );
}

/* ─── thread: top-level comment + indented replies + reply composer ─── */

export const CommentThread = memo(function CommentThread({
  issueId, comment, replies, highlightId, readOnly = false,
}: {
  issueId: string;
  comment: Comment;
  replies: Comment[];
  highlightId?: string | null;
  /** peek panel: no actions, no replies, just the content */
  readOnly?: boolean;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const openReply = () => { setReplyOpen(true); setFocusTick((t) => t + 1); };
  const showComposer = !readOnly && (replies.length > 0 || replyOpen);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <CommentItem
        comment={comment}
        issueId={issueId}
        onReply={readOnly ? undefined : openReply}
        replyCount={replies.length}
        highlighted={highlightId === comment.id}
        readOnly={readOnly}
      />
      {readOnly && replies.length > 0 && (
        <div className="border-t border-line px-3 py-2 pl-[40px] text-xxs text-faint sm:px-4 sm:pl-[44px]">
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
        </div>
      )}
      {!readOnly && replies.map((r) => (
        <div key={r.id} className="border-t border-line pl-5 sm:pl-7">
          <CommentItem comment={r} issueId={issueId} onReply={openReply} replyCount={0} highlighted={highlightId === r.id} />
        </div>
      ))}
      {showComposer && (
        <div className="border-t border-line bg-raised pl-5 sm:pl-7">
          <Composer
            variant="inline"
            placeholder="Leave a reply…"
            submitLabel="Reply"
            minHeight={22}
            focusTick={focusTick}
            draftKey={`reply:${comment.id}`}
            onCancel={replies.length ? undefined : () => setReplyOpen(false)}
            send={(body) => addComment(issueId, body, comment.id)}
          />
        </div>
      )}
    </div>
  );
});
