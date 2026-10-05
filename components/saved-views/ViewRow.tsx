"use client";
/* ─── Locus · one row in the saved views list ─── */

import { memo, useRef, useState } from "react";
import { ArrowUpRight, Copy, Globe, Layers, Link2, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { hrefFor, linkProps, navigate } from "@/lib/router";
import { copyText, updateView } from "@/lib/sync/actions";
import { Avatar } from "@/components/primitives/Avatar";
import { IconButton } from "@/components/primitives/controls";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu, type ActionItem } from "@/components/primitives/SelectMenu";
import { TeamIcon } from "@/components/primitives/icons";
import type { View } from "@/lib/types";
import { useFilterText } from "./filterText";
import { FavoriteButton, VIEW_NAME_MAX, confirmDeleteView, duplicateView, useCanEditView } from "./viewActions";
import { displayName } from "@/lib/model";

export function PersonalBadge() {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full border border-line-strong px-1.5 text-[10.5px] font-medium text-faint">
      <Lock size={9} strokeWidth={2.5} />Personal
    </span>
  );
}

/** Inline name editor shared by the list row and the view header. */
export function RenameInput({ initial, onDone, className = "" }: { initial: string; onDone: (name: string | null) => void; className?: string }) {
  const [value, setValue] = useState(initial);
  const settled = useRef(false);
  const finish = (name: string | null) => {
    if (settled.current) return; // blur after Enter / Escape
    settled.current = true;
    onDone(name);
  };
  const commit = () => {
    const v = value.trim();
    finish(v && v !== initial ? v : null);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={VIEW_NAME_MAX}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
      }}
      aria-label="View name"
      className={`h-7 min-w-0 rounded-md border border-accent bg-surface px-2 text-[13px] font-medium text-ink outline-none ring-2 ring-accent-soft ${className}`}
    />
  );
}

function ViewRowImpl({ view }: { view: View }) {
  const team = useSync((s) => (view.team_id ? s.teams[view.team_id] : undefined));
  const owner = useSync((s) => (view.owner_id ? s.profiles[view.owner_id] : undefined));
  const canEdit = useCanEditView(view);
  const { summarize } = useFilterText();
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const summary = summarize(view.filters);

  const items: ActionItem[] = [
    { id: "open", label: "Open", icon: <ArrowUpRight size={14} />, onSelect: () => navigate({ kind: "view", id: view.id }) },
    ...(canEdit ? [
      { id: "rename", label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
      {
        id: "visibility",
        label: view.shared ? "Make personal" : "Share with workspace",
        icon: view.shared ? <Lock size={14} /> : <Globe size={14} />,
        onSelect: () => updateView(view.id, { shared: !view.shared }),
      },
    ] : []),
    { id: "duplicate", label: "Duplicate", icon: <Copy size={14} />, onSelect: () => duplicateView(view) },
    { id: "link", label: "Copy link", icon: <Link2 size={14} />, onSelect: () => copyText(`${window.location.origin}${hrefFor({ kind: "view", id: view.id })}`, "Link copied") },
    ...(canEdit ? [{ id: "delete", label: "Delete", icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => confirmDeleteView(view) }] : []),
  ];

  return (
    <div className="group relative flex min-h-[52px] items-center gap-3 border-b border-line px-4 transition-colors hover:bg-wash md:h-10 md:min-h-0 md:px-6">
      {!renaming && <a {...linkProps({ kind: "view", id: view.id })} aria-label={view.name} className="focus-ring absolute inset-0" />}

      <span className="pointer-events-none flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-raised">
        <Layers size={14} style={{ color: view.color }} />
      </span>

      <div className="pointer-events-none min-w-0 flex-1 md:flex md:items-center md:gap-4">
        <div className="flex min-w-0 items-center gap-2 md:w-[36%] md:shrink-0">
          {renaming ? (
            <RenameInput
              initial={view.name}
              className="pointer-events-auto relative z-[1] w-full max-w-[320px]"
              onDone={(name) => { setRenaming(false); if (name) updateView(view.id, { name }); }}
            />
          ) : (
            <span className="truncate text-[13px] font-medium text-ink">{view.name}</span>
          )}
          {!view.shared && !renaming && <PersonalBadge />}
        </div>
        <div className={`mt-0.5 truncate text-[12px] md:mt-0 md:flex-1 md:text-[12.5px] ${summary ? "text-dim" : "text-faint"}`} title={summary || undefined}>
          {team && <span className="text-faint lg:hidden">{team.key} · </span>}
          {summary || "No filters"}
        </div>
      </div>

      <div className="pointer-events-none hidden w-[140px] shrink-0 items-center gap-1.5 text-[12.5px] text-dim lg:flex">
        {team ? <><TeamIcon team={team} size={14} /><span className="truncate">{team.name}</span></> : <span className="text-faint">All teams</span>}
      </div>
      <span className="pointer-events-none hidden w-6 shrink-0 justify-center sm:flex" title={owner ? `Created by ${displayName(owner)}` : undefined}>
        <Avatar profile={owner ?? null} size={20} />
      </span>

      <div className="relative z-[1] flex shrink-0 items-center gap-0.5">
        <FavoriteButton kind="view" id={view.id} subtle />
        <Dropdown
          align="end"
          width={220}
          onOpenChange={setMenuOpen}
          trigger={(p) => (
            <IconButton
              ref={p.ref}
              onClick={p.onClick}
              aria-expanded={p["aria-expanded"]}
              active={p.open}
              size={32}
              label="View actions"
              className={menuOpen ? "" : "md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100 [@media(hover:none)]:opacity-100"}
            >
              <MoreHorizontal size={15} />
            </IconButton>
          )}
        >
          {(close) => <ActionMenu onDone={close} items={items} />}
        </Dropdown>
      </div>
    </div>
  );
}

const ViewRow = memo(ViewRowImpl);
export default ViewRow;
