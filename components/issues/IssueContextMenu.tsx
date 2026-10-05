"use client";
/* ─── Locus · issue context menu (right-click / long-press on a list row or board card) ─── */

import { useMemo, type KeyboardEvent } from "react";
import {
  Archive, CalendarDays, CircleDashed, Copy, CopyPlus, Hexagon, Link2, RefreshCw, SignalHigh, Star, Tag, Trash2, Triangle, UserRound,
} from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { ui, useUI, type PickerKind } from "@/lib/ui";
import { issueKey } from "@/lib/model";
import { copyText, duplicateIssue, issueUrl, toggleFavorite } from "@/lib/sync/actions";
import { Popover } from "@/components/primitives/overlay";
import { ActionMenu, type ActionItem } from "@/components/primitives/SelectMenu";
import { archiveTargets, confirmDeleteIssues } from "@/components/overlays/commands";
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
    // archive / delete go through the shared commands (palette, bulk bar, ⌘⌫ use them too): besides the
    // write they drop the ids from the selection, close a peek showing them and move list focus to the
    // neighbouring row, so J/K continue from where the issue was instead of jumping to the ends
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
        onSelect: () => archiveTargets(targets),
      },
      {
        id: "delete", label: many ? `Delete ${targets.length} issues` : "Delete", icon: <Trash2 size={14} />, danger: true,
        onSelect: () => confirmDeleteIssues(targets),
      },
    ];
  }, [issue, selected, favorite]);

  /* the hinted letters (S/P/A/L) work inside the menu too — global shortcuts stand down while it is open */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.key.length !== 1) return;
    const key = e.key.toUpperCase();
    const item = items.find((it) => it.hint === key && !it.disabled);
    if (!item) return;
    e.preventDefault();
    if (e.repeat) return;
    item.onSelect();
    onClose();
  };

  if (!open || !issue) return null;
  const count = selected.includes(issue.id) ? selected.length : 1;
  return (
    <Popover open anchor={anchor} onClose={onClose} width={236}>
      <div onKeyDown={onKeyDown}>
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
