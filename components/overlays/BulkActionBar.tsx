"use client";
/* ─── Locus · floating bulk action bar (shown while issues are selected) ─── */

import { useEffect, type ReactNode } from "react";
import {
  Archive, ArrowRightLeft, CalendarDays, Copy, Hexagon, Link2, ListTree, MoreHorizontal, RefreshCw, Tag, Trash2, Triangle,
  UserMinus, UserRound, UserRoundCheck, X,
} from "lucide-react";
import { ui, useUI, type PickerKind } from "@/lib/ui";
import { useSync } from "@/lib/sync/store";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import { Kbd, Tooltip } from "@/components/primitives/controls";
import { PriorityIcon, StateIcon } from "@/components/primitives/icons";
import {
  allAssignedToMe, archiveTargets, confirmDeleteIssues, copyIssueIds, copyIssueLinks, keys, liveIds, toggleAssignToMe,
} from "./commands";

/** ids of the selection that still exist, read at action time */
const selection = () => liveIds(useUI.getState().selected);

export default function BulkActionBar() {
  const selected = useUI((s) => s.selected);
  const live = useSync((s) => {
    let n = 0;
    for (const id of selected) if (s.issues[id]) n++;
    return n;
  });

  // prune ids deleted elsewhere (realtime) so counts and actions stay honest
  useEffect(() => {
    if (live !== selected.length) ui.setSelected(liveIds(selected));
  }, [live, selected]);

  if (!live) return null;

  const shift = keys.shift();
  const mod = keys.mod();
  const pick = (kind: PickerKind) => () => {
    const ids = selection();
    if (ids.length) ui.openPicker(kind, ids);
  };

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-4 z-[65] flex justify-center sm:inset-x-6 md:bottom-6">
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="anim-toast pointer-events-auto flex h-12 w-full max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-surface px-1.5 shadow-pop sm:w-auto md:overflow-visible"
      >
        <div className="flex shrink-0 items-center gap-1 pl-1.5 pr-0.5">
          <span className="whitespace-nowrap text-[12.5px] font-medium tabular-nums text-ink">{live} selected</span>
          <Tooltip label="Clear selection" shortcut={["Esc"]} side="top">
            <button
              type="button"
              aria-label="Clear selection"
              onClick={ui.clearSelection}
              className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-faint transition-colors hover:bg-wash hover:text-ink"
            >
              <X size={14} />
            </button>
          </Tooltip>
          <Kbd className="hidden lg:inline-flex">Esc</Kbd>
        </div>
        <span className="mx-1 h-5 w-px shrink-0 bg-line" />

        <BarButton label="Status" shortcut={["S"]} icon={<StateIcon type="started" color="var(--dim)" fraction={0.5} size={14} />} onClick={pick("status")} />
        <BarButton label="Priority" shortcut={["P"]} icon={<PriorityIcon priority={2} className="text-dim" />} onClick={pick("priority")} />
        <BarButton label="Assignee" shortcut={["A"]} icon={<UserRound size={14} />} onClick={pick("assignee")} />
        <BarButton label="Labels" shortcut={["L"]} icon={<Tag size={14} />} onClick={pick("labels")} />
        <BarButton label="Project" shortcut={[shift, "P"]} icon={<Hexagon size={14} />} onClick={pick("project")} />
        <BarButton label="Cycle" shortcut={[shift, "C"]} icon={<RefreshCw size={13} />} onClick={pick("cycle")} />

        <span className="mx-1 h-5 w-px shrink-0 bg-line" />

        <BarButton label="Archive" icon={<Archive size={14} />} iconOnly onClick={() => archiveTargets(selection())} />
        <BarButton label="Delete" shortcut={[mod, keys.backspace()]} icon={<Trash2 size={14} />} iconOnly danger onClick={() => confirmDeleteIssues(selection())} />

        <Dropdown
          side="top"
          align="end"
          width={240}
          trigger={(p) => (
            <Tooltip label="More actions" side="top">
              <button
                type="button"
                ref={p.ref}
                onClick={p.onClick}
                aria-expanded={p["aria-expanded"]}
                aria-label="More actions"
                className={`focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-dim transition-colors hover:bg-wash hover:text-ink ${p.open ? "bg-wash text-ink" : ""}`}
              >
                <MoreHorizontal size={15} />
              </button>
            </Tooltip>
          )}
        >
          {(close) => {
            // read when the menu renders (it re-renders on open), so the toggle label matches the selection now
            const mine = allAssignedToMe(selection());
            return (
              <ActionMenu
                onDone={close}
                items={[
                  mine
                    ? { id: "assign-me", label: "Unassign from me", icon: <UserMinus size={14} />, hint: "I", onSelect: () => toggleAssignToMe(selection()) }
                    : { id: "assign-me", label: "Assign to me", icon: <UserRoundCheck size={14} />, hint: "I", onSelect: () => toggleAssignToMe(selection()) },
                  { id: "estimate", label: "Set estimate…", icon: <Triangle size={13} />, hint: keys.combo(shift, "E"), onSelect: pick("estimate") },
                  { id: "due", label: "Set due date…", icon: <CalendarDays size={14} />, hint: keys.combo(shift, "D"), onSelect: pick("due") },
                  { id: "team", label: "Move to team…", icon: <ArrowRightLeft size={14} />, hint: keys.combo(shift, "M"), onSelect: pick("team") },
                  { id: "parent", label: "Set parent issue…", icon: <ListTree size={14} />, onSelect: pick("parent") },
                  { id: "copy-ids", divider: true, label: "Copy IDs", icon: <Copy size={14} />, hint: keys.combo(mod, "."), onSelect: () => copyIssueIds(selection()) },
                  { id: "copy-links", label: "Copy links", icon: <Link2 size={14} />, hint: keys.combo(mod, shift, ","), onSelect: () => copyIssueLinks(selection()) },
                ]}
              />
            );
          }}
        </Dropdown>
      </div>
    </div>
  );
}

function BarButton({
  label, icon, shortcut, onClick, iconOnly, danger,
}: { label: string; icon: ReactNode; shortcut?: string[]; onClick: () => void; iconOnly?: boolean; danger?: boolean }) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="top">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={`focus-ring flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors hover:bg-wash ${
          danger ? "text-dim hover:text-danger" : "text-dim hover:text-ink"
        }`}
      >
        <span className="flex shrink-0 items-center">{icon}</span>
        {!iconOnly && <span className="hidden whitespace-nowrap lg:inline">{label}</span>}
      </button>
    </Tooltip>
  );
}
