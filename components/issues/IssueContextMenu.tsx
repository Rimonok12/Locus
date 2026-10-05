"use client";
/* ─── Locus · issue context menu (right-click / long-press on a list row or board card) ─── */

import { useMemo, useRef } from "react";
import {
  Archive, CalendarDays, CircleDashed, Copy, CopyPlus, Hexagon, Link2, RefreshCw, SignalHigh, Star, Tag, Trash2, Triangle, UserRound,
} from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { ui, useUI, type PickerKind } from "@/lib/ui";
import { issueKey } from "@/lib/model";
import { archiveIssues, copyText, deleteIssues, duplicateIssue, issueUrl, toggleFavorite } from "@/lib/sync/actions";
import { Popover } from "@/components/primitives/overlay";
import { ActionMenu, type ActionItem } from "@/components/primitives/SelectMenu";
import { usePopoverFix } from "./shared";
import type { MenuRequest } from "./useListInteractions";
import type { Issue } from "@/lib/types";

export default function IssueContextMenu({ menu, onClose }: { menu: MenuRequest | null; onClose: () => void }) {
  const issue = useSync((s) => (menu ? s.issues[menu.id] : undefined));
  const favorite = useSync((s) => {
    if (!menu) return false;
    for (const f of Object.values(s.favorites)) if (f.kind === "issue" && f.target_id === menu.id && f.user_id === s.userId) return true;
    return false;
  });
  const selected = useUI((s) => s.selected);
  const anchor = useMemo(() => (menu ? { x: menu.x, y: menu.y } : null), [menu]);
  const open = Boolean(menu && issue);
  const contentRef = useRef<HTMLDivElement>(null);
  usePopoverFix(open, contentRef);

  const items = useMemo((): ActionItem[] => {
    if (!issue) return [];
    // act on the whole selection when the clicked issue is part of it
    const targets = selected.includes(issue.id) ? selected : [issue.id];
    const many = targets.length > 1;
    const key = issueKey(issue);
    const rows = () => {
      const all = useSync.getState().issues;
      return targets.map((id) => all[id]).filter((x): x is Issue => Boolean(x));
    };
    const pick = (kind: PickerKind) => () => ui.openPicker(kind, targets);
    const dropFromSelection = () => {
      const gone = new Set(targets);
      const sel = useUI.getState().selected;
      if (sel.some((id) => gone.has(id))) ui.setSelected(sel.filter((id) => !gone.has(id)));
    };
    return [
      { id: "status", label: "Status…", icon: <CircleDashed size={14} />, hint: "S", onSelect: pick("status") },
      { id: "priority", label: "Priority…", icon: <SignalHigh size={14} />, hint: "P", onSelect: pick("priority") },
      { id: "assignee", label: "Assignee…", icon: <UserRound size={14} />, hint: "A", onSelect: pick("assignee") },
      { id: "labels", label: "Labels…", icon: <Tag size={14} />, hint: "L", onSelect: pick("labels") },
      { id: "project", label: "Project…", icon: <Hexagon size={14} />, onSelect: pick("project") },
      { id: "cycle", label: "Cycle…", icon: <RefreshCw size={13} />, onSelect: pick("cycle") },
      { id: "estimate", label: "Estimate…", icon: <Triangle size={13} />, onSelect: pick("estimate") },
      { id: "due", label: "Due date…", icon: <CalendarDays size={14} />, onSelect: pick("due") },
      {
        id: "copy-id", divider: true, label: many ? `Copy ${targets.length} IDs` : "Copy ID", icon: <Copy size={14} />,
        onSelect: () => {
          const keys = rows().map((r) => issueKey(r));
          copyText(keys.join(", "), many ? `Copied ${keys.length} IDs` : `Copied ${key}`);
        },
      },
      {
        id: "copy-link", label: many ? "Copy links" : "Copy link", icon: <Link2 size={14} />,
        onSelect: () => copyText(rows().map((r) => issueUrl(r)).join("\n"), many ? "Copied links" : "Copied link"),
      },
      {
        id: "favorite", label: favorite ? "Unfavorite" : "Favorite",
        icon: <Star size={14} className={favorite ? "fill-current text-warning" : ""} />,
        onSelect: () => { toggleFavorite("issue", issue.id); },
      },
      { id: "duplicate", label: "Duplicate", icon: <CopyPlus size={14} />, onSelect: () => { duplicateIssue(issue.id); } },
      {
        id: "archive", divider: true, label: many ? `Archive ${targets.length} issues` : "Archive", icon: <Archive size={14} />,
        onSelect: () => { archiveIssues(targets); dropFromSelection(); },
      },
      {
        id: "delete", label: many ? `Delete ${targets.length} issues` : "Delete", icon: <Trash2 size={14} />, danger: true,
        onSelect: () => ui.askConfirm({
          title: many ? `Delete ${targets.length} issues?` : `Delete ${key}?`,
          body: many
            ? "These issues and their comments will be deleted. You can undo right after."
            : `“${issue.title || "Untitled"}” and its comments will be deleted. You can undo right after.`,
          confirmLabel: "Delete",
          destructive: true,
          onConfirm: async () => {
            await deleteIssues(targets);
            dropFromSelection();
          },
        }),
      },
    ];
  }, [issue, selected, favorite]);

  if (!open || !issue) return null;
  const count = selected.includes(issue.id) ? selected.length : 1;
  return (
    <Popover open anchor={anchor} onClose={onClose} width={236}>
      <div ref={contentRef}>
        <div className="truncate border-b border-line px-3 py-2 text-xxs font-medium text-faint">
          {count > 1 ? `${count} issues selected` : `${issueKey(issue)} · ${issue.title || "Untitled"}`}
        </div>
        <div className="max-h-[min(70vh,460px)] overflow-y-auto">
          <ActionMenu items={items} onDone={onClose} />
        </div>
      </div>
    </Popover>
  );
}
