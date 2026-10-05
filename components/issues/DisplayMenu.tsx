"use client";
/* ─── Locus · display options popover: layout, grouping, ordering, completed window, properties ─── */

import { type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Columns3, LayoutList, RotateCcw, SlidersHorizontal } from "lucide-react";
import { ui, useUI } from "@/lib/ui";
import { PROPERTY_LABEL, type IssueQuery } from "@/lib/model";
import { Dropdown } from "@/components/primitives/overlay";
import { Switch } from "@/components/primitives/controls";
import { ToolbarButton } from "./shared";
import type { CompletedWindow, DisplayOptions, DisplayProperty, Grouping, Ordering } from "@/lib/types";

const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "assignee", label: "Assignee" },
  { value: "project", label: "Project" },
  { value: "priority", label: "Priority" },
  { value: "cycle", label: "Cycle" },
  { value: "label", label: "Label" },
  { value: "team", label: "Team" },
  { value: "none", label: "No grouping" },
];

const ORDERINGS: { value: Ordering; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "priority", label: "Priority" },
  { value: "updated", label: "Last updated" },
  { value: "created", label: "Last created" },
  { value: "due", label: "Due date" },
  { value: "title", label: "Title" },
  { value: "estimate", label: "Estimate" },
];

const COMPLETED: { value: CompletedWindow; label: string }[] = [
  { value: "all", label: "All" },
  { value: "day", label: "Past day" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "none", label: "None" },
];

const PROPERTIES = Object.keys(PROPERTY_LABEL) as DisplayProperty[];

const LAYOUTS: { value: DisplayOptions["layout"]; label: string; icon: ReactNode }[] = [
  { value: "list", label: "List", icon: <LayoutList size={16} /> },
  { value: "board", label: "Board", icon: <Columns3 size={16} /> },
];

export function DisplayMenu({ viewKey, query, groupings }: { viewKey: string; query: IssueQuery; groupings?: Grouping[] }) {
  return (
    <Dropdown
      width={320}
      align="end"
      trigger={(p) => (
        <ToolbarButton
          ref={p.ref}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup="dialog"
          active={p.open}
          bordered
          icon={<SlidersHorizontal size={14} />}
          label="Display"
        />
      )}
    >
      {() => <DisplayPanel viewKey={viewKey} display={query.display} groupings={groupings} />}
    </Dropdown>
  );
}

function DisplayPanel({ viewKey, display, groupings }: { viewKey: string; display: DisplayOptions; groupings?: Grouping[] }) {
  const customized = useUI((u) => Boolean(u.display[viewKey]));
  const set = (patch: Partial<DisplayOptions>) => ui.setDisplay(viewKey, patch);
  const groupingOptions = GROUPINGS.filter((g) => !groupings || groupings.includes(g.value) || g.value === display.grouping);

  // radio-group keys: arrows switch the layout and carry focus along (the checked radio is the tab stop)
  const onLayoutKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = LAYOUTS.findIndex((l) => l.value === display.layout);
    const next = LAYOUTS[(i + dir + LAYOUTS.length) % LAYOUTS.length];
    set({ layout: next.value });
    e.currentTarget.querySelector<HTMLElement>(`[data-layout="${next.value}"]`)?.focus();
  };

  return (
    <div className="max-h-[min(80vh,560px)] overflow-y-auto text-[13px]">
      <div role="radiogroup" aria-label="Layout" onKeyDown={onLayoutKey} className="grid grid-cols-2 gap-1.5 border-b border-line p-2.5">
        {LAYOUTS.map((l) => {
          const on = display.layout === l.value;
          return (
            <button
              key={l.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-layout={l.value}
              tabIndex={on ? 0 : -1}
              // the panel is portaled: start keyboard focus inside it so Tab walks its controls
              autoFocus={on}
              onClick={() => set({ layout: l.value })}
              className={`focus-ring flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[12.5px] font-medium transition-colors ${
                on ? "border-line-strong bg-wash text-ink" : "border-line text-faint hover:border-line-strong hover:text-dim"
              }`}
            >
              {l.icon}
              {l.label}
            </button>
          );
        })}
      </div>

      <div className="border-b border-line px-3 py-1.5">
        <Row label={display.layout === "board" ? "Columns" : "Grouping"}>
          <Select label="Grouping" value={display.grouping} options={groupingOptions} onChange={(grouping) => set({ grouping })} />
        </Row>
        <Row label="Ordering">
          <Select label="Ordering" value={display.ordering} options={ORDERINGS} onChange={(ordering) => set({ ordering })} />
        </Row>
        <Row label="Completed issues">
          <Select label="Completed issues" value={display.completed} options={COMPLETED} onChange={(completed) => set({ completed })} />
        </Row>
      </div>

      <div className="border-b border-line px-3 py-1.5">
        {/* <label> rows: the whole line toggles the switch (comfortable touch target) */}
        <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3">
          <span className="text-dim">Show sub-issues</span>
          <Switch label="Show sub-issues" checked={display.showSubIssues} onChange={(showSubIssues) => set({ showSubIssues })} />
        </label>
        <label className={`flex min-h-9 items-center justify-between gap-3 ${display.grouping === "none" ? "opacity-50" : "cursor-pointer"}`}>
          <span className="text-dim">Show empty groups</span>
          <Switch
            label="Show empty groups"
            checked={display.showEmptyGroups}
            disabled={display.grouping === "none"}
            onChange={(showEmptyGroups) => set({ showEmptyGroups })}
          />
        </label>
      </div>

      <div className="border-b border-line px-3 py-2.5">
        <div className="mb-2 text-xxs font-medium text-faint">Display properties</div>
        <div className="flex flex-wrap gap-1.5">
          {PROPERTIES.map((p) => {
            const on = display.properties[p];
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => set({ properties: { ...display.properties, [p]: !on } })}
                className={`focus-ring h-8 rounded-md border px-2 text-[12px] font-medium transition-colors sm:h-6 ${
                  on ? "border-line-strong bg-wash text-ink" : "border-line text-faint hover:border-line-strong hover:text-dim"
                }`}
              >
                {PROPERTY_LABEL[p]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end px-2 py-1.5">
        <button
          type="button"
          disabled={!customized}
          onClick={() => ui.resetDisplay(viewKey)}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-dim transition-colors hover:bg-wash hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent sm:h-7"
        >
          <RotateCcw size={12} />
          Reset to default
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <span className="text-dim">{label}</span>
      {children}
    </div>
  );
}

/** compact native select — reliable inside popovers and great on touch devices */
function Select<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span className="relative inline-flex">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="focus-ring h-8 min-w-[132px] cursor-pointer appearance-none rounded-md border border-line-strong bg-surface pl-2.5 pr-7 text-[12.5px] text-ink outline-none transition-colors hover:bg-wash sm:h-7"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-faint" />
    </span>
  );
}
