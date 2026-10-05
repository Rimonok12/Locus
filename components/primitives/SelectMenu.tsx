"use client";
/* ─── Locus · searchable select menu (cmdk), used by every property picker ─── */

import { Command } from "cmdk";
import { Check, Plus } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** extra text matched by search */
  keywords?: string[];
  /** right-aligned hint (shortcut digit, count, …) */
  hint?: ReactNode;
  disabled?: boolean;
  group?: string;
}

/**
 * Single- or multi-select list with type-to-filter, arrow keys, Enter, and digit
 * shortcuts (1–9 pick the nth item while the search box is empty).
 */
export function SelectMenu({
  items, selected, onSelect, placeholder = "Search…", multi = false, emptyText = "No results",
  onCreate, createLabel, autoFocus = true, maxHeight = 320, footer, digitShortcuts = true,
  shouldFilter = true, onQueryChange,
}: {
  items: MenuItem[];
  selected?: string | string[] | null;
  onSelect: (id: string) => void;
  placeholder?: string;
  multi?: boolean;
  emptyText?: string;
  /** shows "Create …" when the query matches nothing exactly */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  autoFocus?: boolean;
  maxHeight?: number;
  footer?: ReactNode;
  digitShortcuts?: boolean;
  /** false: the caller filters / ranks `items` itself (from onQueryChange) and their order is kept */
  shouldFilter?: boolean;
  /** called with the search text on every change */
  onQueryChange?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const changeQuery = (q: string) => { setQuery(q); onQueryChange?.(q); };
  const sel = new Set(Array.isArray(selected) ? selected : selected != null ? [selected] : []);
  const groups = Array.from(new Set(items.map((i) => i.group ?? "")));
  const exact = items.some((i) => i.label.toLowerCase() === query.trim().toLowerCase());

  return (
    <Command
      loop
      shouldFilter={shouldFilter}
      className="flex flex-col"
      onKeyDown={(e) => {
        if (digitShortcuts && !query && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
          const item = items.filter((i) => !i.disabled)[Number(e.key) - 1];
          if (item) { e.preventDefault(); onSelect(item.id); }
        }
      }}
    >
      <div className="border-b border-line px-3">
        <Command.Input
          autoFocus={autoFocus}
          value={query}
          onValueChange={changeQuery}
          placeholder={placeholder}
          className="h-10 w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-faint sm:h-9 sm:text-[13px]"
        />
      </div>
      <Command.List className="overflow-y-auto p-1" style={{ maxHeight }}>
        <Command.Empty>{emptyText}</Command.Empty>
        {groups.map((g) => {
          const content = items.filter((i) => (i.group ?? "") === g).map((item) => (
            <Command.Item
              key={item.id}
              value={`${item.label} ${item.keywords?.join(" ") ?? ""} ${item.id}`}
              disabled={item.disabled}
              onSelect={() => onSelect(item.id)}
              className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] text-ink sm:h-8"
            >
              {multi && (
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border ${sel.has(item.id) ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`}>
                  {sel.has(item.id) && <Check size={10} strokeWidth={3} />}
                </span>
              )}
              {item.icon && <span className="flex w-4 shrink-0 items-center justify-center">{item.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {!multi && sel.has(item.id) && <Check size={14} className="shrink-0 text-dim" />}
              {item.hint != null && <span className="ml-1 shrink-0 text-xxs text-faint">{item.hint}</span>}
            </Command.Item>
          ));
          return g ? <Command.Group key={g} heading={g}>{content}</Command.Group> : <div key="_">{content}</div>;
        })}
        {onCreate && query.trim() && !exact && (
          <Command.Item
            value={`__create ${query}`}
            onSelect={() => { onCreate(query.trim()); changeQuery(""); }}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-dim"
          >
            <Plus size={14} className="text-faint" />
            {createLabel ? createLabel(query.trim()) : `Create "${query.trim()}"`}
          </Command.Item>
        )}
      </Command.List>
      {footer && <div className="border-t border-line px-3 py-2 text-xxs text-faint">{footer}</div>}
    </Command>
  );
}

/** Plain action menu (no search) for "…" overflow menus and context menus. */
export interface ActionItem {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  divider?: boolean;
}

export function ActionMenu({ items, onDone }: { items: ActionItem[]; onDone?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]:not(:disabled)") ?? []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = buttons();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % list.length;
    else if (e.key === "ArrowUp") next = (i - 1 + list.length) % list.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    if (next >= 0) { e.preventDefault(); list[next].focus(); }
  };
  return (
    <div ref={ref} className="min-w-[200px] p-1" role="menu" onKeyDown={onKeyDown}>
      {items.map((it, idx) => (
        <div key={it.id}>
          {it.divider && <div className="my-1 h-px bg-line" />}
          <button
            role="menuitem"
            autoFocus={idx === 0}
            disabled={it.disabled}
            onClick={() => { it.onSelect(); onDone?.(); }}
            className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none transition-colors hover:bg-wash focus:bg-wash disabled:opacity-40 sm:h-8 ${it.danger ? "text-danger" : "text-ink"}`}
          >
            {it.icon && <span className={`flex w-4 shrink-0 items-center justify-center ${it.danger ? "" : "text-dim"}`}>{it.icon}</span>}
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="text-xxs text-faint">{it.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
