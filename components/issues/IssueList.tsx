"use client";
/* ─── Locus · issue list layout ──────────────────────────────────────────────
   Grouped sections with sticky headers and dense 38px rows. Built to stay smooth
   with thousands of issues:
     • rows are memoized and receive the (referentially stable) issue row + primitives
     • per-row store reads are narrow selectors; selection is an O(1) cached Set lookup
     • rows mount progressively (first screenful immediately, the rest in idle slices)
     • content-visibility:auto skips layout/paint of off-screen rows
     • interactive property pickers hydrate only for rows near the viewport
   ──────────────────────────────────────────────────────────────────────────── */

import {
  createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from "react";
import { Check, ChevronRight, Plus } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { useUI } from "@/lib/ui";
import { issueKey, type IssueGroup, type IssueQuery, type QueryCtx } from "@/lib/model";
import { hrefFor, scrollMemory } from "@/lib/router";
import { IconButton } from "@/components/primitives/controls";
import { Avatar } from "@/components/primitives/Avatar";
import { PriorityIcon } from "@/components/primitives/icons";
import { LabelPills, PropertyChip, StateGlyph } from "@/components/pickers";
import {
  AgeLabel, CycleChip, DueChip, EstimateChip, GroupIcon, MilestoneChip, ProjectChip, SubIssueChip, asSet, nudgeOpeningPopover,
  statusGroupAllowed, type SubCounts,
} from "./shared";
import { useListInteractions, type MenuRequest } from "./useListInteractions";
import type { DisplayOptions, Issue } from "@/lib/types";

type Properties = DisplayOptions["properties"];

const ROW_HEIGHT = 38;
const FIRST_BATCH = 120;
const BATCH = 400;

const ROW_STYLE: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: `auto ${ROW_HEIGHT}px`,
  WebkitTouchCallout: "none",
};

/* ═══ row-level API (stable for the lifetime of the list) ═══ */

interface RowApi {
  toggleSelect: (id: string, range: boolean) => void;
  observe: (el: Element, onVisible: () => void) => () => void;
}
const RowApiContext = createContext<RowApi | null>(null);

/* ═══ hooks ═══ */

const collapsedKey = (viewKey: string) => `locus:collapsed:${viewKey}`;
function readCollapsed(viewKey: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(collapsedKey(viewKey));
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** collapsed group keys per view, kept for the browser session */
function useCollapsedGroups(viewKey: string): [Set<string>, (groupKey: string) => void] {
  const [state, setState] = useState(() => ({ viewKey, keys: readCollapsed(viewKey) }));
  let current = state;
  if (state.viewKey !== viewKey) {
    current = { viewKey, keys: readCollapsed(viewKey) };
    setState(current);
  }
  const keys = current.keys;
  const set = useMemo(() => new Set(keys), [keys]);
  const toggle = useCallback((groupKey: string) => {
    setState((s) => {
      const next = s.keys.includes(groupKey) ? s.keys.filter((k) => k !== groupKey) : [...s.keys, groupKey];
      try { window.sessionStorage.setItem(collapsedKey(s.viewKey), JSON.stringify(next)); } catch { /* storage unavailable */ }
      return { viewKey: s.viewKey, keys: next };
    });
  }, []);
  return [set, toggle];
}

/** how many rows may be mounted right now: grows in slices until everything is rendered */
function useProgressiveBudget(total: number, initial: number) {
  const [budget, setBudget] = useState(initial);
  useEffect(() => {
    if (budget >= total) return;
    const t = window.setTimeout(() => setBudget((b) => b + BATCH), 16);
    return () => window.clearTimeout(t);
  }, [budget, total]);
  return budget;
}

/** one IntersectionObserver for every row: calls back once a row comes near the viewport */
function useHydrator(rootRef: RefObject<HTMLElement>) {
  const io = useRef<IntersectionObserver | null>(null);
  const callbacks = useRef(new Map<Element, () => void>());
  useEffect(() => () => {
    io.current?.disconnect();
    io.current = null;
    callbacks.current.clear();
  }, []);
  return useCallback((el: Element, onVisible: () => void) => {
    if (typeof IntersectionObserver === "undefined") { onVisible(); return () => {}; }
    if (!io.current) {
      io.current = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const cb = callbacks.current.get(entry.target);
          if (!cb) continue;
          callbacks.current.delete(entry.target);
          io.current?.unobserve(entry.target);
          cb();
        }
      }, { root: rootRef.current, rootMargin: "360px 0px" });
    }
    callbacks.current.set(el, onVisible);
    io.current.observe(el);
    return () => {
      callbacks.current.delete(el);
      io.current?.unobserve(el);
    };
  }, [rootRef]);
}

/* ═══ list ═══ */

export default function IssueList({
  query, viewKey, openMenu, createInGroup, subCounts,
}: {
  query: IssueQuery;
  viewKey: string;
  openMenu: (req: MenuRequest) => void;
  createInGroup: (group: IssueGroup) => void;
  subCounts: SubCounts;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { display, ctx } = query;
  // "show empty groups" never lists statuses the view's filters rule out (Backlog on an Active tab)
  const groups = useMemo(
    () => (display.grouping === "status" && display.showEmptyGroups
      ? query.groups.filter((g) => g.issues.length > 0 || statusGroupAllowed(g, query.filters, ctx))
      : query.groups),
    [query.groups, query.filters, display.grouping, display.showEmptyGroups, ctx],
  );
  const showHeaders = display.grouping !== "none";
  const [collapsed, toggleCollapsed] = useCollapsedGroups(viewKey);
  const isClosed = useCallback((g: IssueGroup) => showHeaders && collapsed.has(g.key), [showHeaders, collapsed]);

  const ids = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const g of groups) {
      if (isClosed(g)) continue;
      for (const i of g.issues) if (!seen.has(i.id)) { seen.add(i.id); out.push(i.id); }
    }
    return out;
  }, [groups, isClosed]);
  const rowCount = useMemo(() => groups.reduce((n, g) => n + (isClosed(g) ? 0 : g.issues.length), 0), [groups, isClosed]);

  // restore the scroll position when coming back to this view (e.g. after opening an issue)
  const memoryKey = `issues:${viewKey}:list`;
  const [initialBudget] = useState(() => {
    const top = scrollMemory.get(memoryKey) ?? 0;
    return Math.max(FIRST_BATCH, Math.ceil((top + 1600) / ROW_HEIGHT));
  });
  const budget = useProgressiveBudget(rowCount, initialBudget);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = scrollMemory.get(memoryKey);
    if (saved) el.scrollTop = saved;
    const onScroll = () => { scrollMemory.set(memoryKey, el.scrollTop); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [memoryKey]);

  const { handlers, toggleSelect } = useListInteractions({ ids, containerRef: ref, openMenu, longPress: true });
  const observe = useHydrator(ref);
  // selection mode reveals every checkbox through CSS, so rows don't re-render when it flips
  const selecting = useUI((s) => s.selected.length > 0);
  const api = useMemo<RowApi>(() => ({ toggleSelect, observe }), [toggleSelect, observe]);

  const sections: ReactNode[] = [];
  let remaining = budget;
  for (const g of groups) {
    const closed = isClosed(g);
    if (!closed && g.issues.length && remaining <= 0) break;
    const rows = closed ? [] : g.issues.slice(0, Math.max(0, remaining));
    remaining -= rows.length;
    sections.push(
      <section key={g.key} aria-label={showHeaders ? `${g.label} · ${g.issues.length}` : undefined}>
        {showHeaders && (
          <GroupHeader
            group={g}
            ctx={ctx}
            collapsed={closed}
            onToggle={() => toggleCollapsed(g.key)}
            onCreate={() => createInGroup(g)}
          />
        )}
        {rows.map((issue) => {
          const sc = subCounts.get(issue.id);
          return (
            <IssueRow
              key={issue.id}
              issue={issue}
              props={display.properties}
              subTotal={sc?.total ?? 0}
              subDone={sc?.done ?? 0}
            />
          );
        })}
      </section>,
    );
  }

  return (
    <RowApiContext.Provider value={api}>
      <div
        ref={ref}
        aria-label="Issues"
        data-selecting={selecting}
        className="group/list relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24"
        onClickCapture={(e) => {
          // a row property chip is opening its picker
          const trigger = (e.target as HTMLElement).closest?.("[data-issue-id] button[aria-expanded='false']");
          if (trigger && e.currentTarget.contains(trigger)) nudgeOpeningPopover();
        }}
        {...handlers}
      >
        {sections}
      </div>
    </RowApiContext.Provider>
  );
}

/* ═══ group header ═══ */

function GroupHeader({
  group, ctx, collapsed, onToggle, onCreate,
}: { group: IssueGroup; ctx: QueryCtx; collapsed: boolean; onToggle: () => void; onCreate: () => void }) {
  return (
    <div className="sticky top-0 z-[2] flex h-9 items-center gap-1 border-b border-line bg-raised pl-1.5 pr-2 md:pr-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="focus-ring group/gh flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pl-1 pr-2 text-left"
      >
        <ChevronRight size={13} className={`shrink-0 text-faint transition-transform duration-150 group-hover/gh:text-dim ${collapsed ? "" : "rotate-90"}`} />
        <span className="flex w-4 shrink-0 items-center justify-center"><GroupIcon group={group} ctx={ctx} /></span>
        <span className="truncate text-[13px] font-medium text-ink">{group.label}</span>
        <span className="shrink-0 text-[12.5px] tabular-nums text-faint">{group.issues.length}</span>
      </button>
      <IconButton label={`New issue in ${group.label}`} size={32} onClick={onCreate} className="sm:!h-7 sm:!w-7">
        <Plus size={15} />
      </IconButton>
    </div>
  );
}

/* ═══ row ═══ */

/** static stand-in with the exact footprint of PropertyChip's icon variant */
function Slot({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] [@media(hover:none)]:h-8 [@media(hover:none)]:w-8">{children}</span>;
}

const IssueRow = memo(function IssueRow({
  issue, props, subTotal, subDone,
}: { issue: Issue; props: Properties; subTotal: number; subDone: number }) {
  const api = useContext(RowApiContext);
  const id = issue.id;
  const selected = useUI((s) => asSet(s.selected).has(id));
  const focused = useUI((s) => s.focusedId === id);
  const team = useSync((s) => s.teams[issue.team_id]);
  const identifier = issueKey(issue, team ? { [team.id]: team } : {});
  const href = hrefFor({ kind: "issue", identifier });

  // interactive pickers mount once the row is near the viewport
  const ref = useRef<HTMLAnchorElement>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (live || !el || !api) return;
    return api.observe(el, () => setLive(true));
  }, [live, api]);

  return (
    <a
      ref={ref}
      href={href}
      draggable={false}
      data-issue-id={id}
      style={ROW_STYLE}
      className={`group/row relative flex h-[38px] scroll-mt-9 select-none items-center gap-1.5 pl-1 pr-3 text-[13px] outline-none md:pr-5 [@media(hover:none)]:[&_button[aria-expanded]]:h-8 [@media(hover:none)]:[&_button[aria-expanded]]:w-8 ${
        selected ? "bg-accent-soft" : focused ? "bg-wash" : ""
      }`}
    >
      {selected && focused && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-accent" />}
      <button
        type="button"
        role="checkbox"
        tabIndex={-1}
        aria-checked={selected}
        aria-label={`Select ${identifier}`}
        onMouseDown={(e) => e.preventDefault() /* keep keyboard focus where it was */}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          api?.toggleSelect(id, e.shiftKey);
        }}
        className={`flex h-8 w-7 shrink-0 items-center justify-center rounded-md transition-opacity ${
          selected
            ? "opacity-100"
            : "opacity-0 group-hover/row:opacity-100 group-data-[selecting=true]/list:opacity-100 [@media(hover:none)]:opacity-100"
        }`}
      >
        <span
          className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border transition-colors ${
            selected ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface hover:border-faint"
          }`}
        >
          {selected && <Check size={10} strokeWidth={3} />}
        </span>
      </button>

      {props.priority && (live
        ? <PropertyChip issue={issue} kind="priority" variant="icon" />
        : <Slot><PriorityIcon priority={issue.priority} className="text-dim" /></Slot>)}
      {props.id && <span className="w-[60px] shrink-0 truncate text-[12.5px] tabular-nums text-faint sm:w-[68px]">{identifier}</span>}
      {props.status && (live
        ? <PropertyChip issue={issue} kind="status" variant="icon" />
        : <Slot><StateGlyph stateId={issue.state_id} /></Slot>)}

      <span className="flex min-w-0 flex-1 items-center gap-2 pl-0.5">
        <span className="truncate font-medium text-ink">{issue.title || "Untitled"}</span>
        {props.subIssues && subTotal > 0 && <SubIssueChip done={subDone} total={subTotal} />}
      </span>

      <span className="flex shrink-0 items-center gap-1.5 pl-1">
        {props.labels && issue.label_ids.length > 0 && (
          <span className="hidden h-[22px] max-w-[240px] overflow-hidden lg:flex">
            <LabelPills issue={issue} editable={false} max={2} />
          </span>
        )}
        {props.project && <ProjectChip id={issue.project_id} display="hidden md:inline-flex" />}
        {props.milestone && <MilestoneChip id={issue.milestone_id} display="hidden xl:inline-flex" />}
        {props.cycle && <CycleChip id={issue.cycle_id} display="hidden lg:inline-flex" />}
        {props.estimate && <EstimateChip value={issue.estimate} display="hidden sm:inline-flex" />}
        {props.due && <DueChip date={issue.due_date} display="hidden sm:inline-flex" />}
        {props.created && <AgeLabel iso={issue.created_at} verb="Created" display="hidden md:inline-flex" />}
        {props.updated && <AgeLabel iso={issue.updated_at} verb="Updated" display="hidden md:inline-flex" />}
        {props.assignee && (live
          ? <PropertyChip issue={issue} kind="assignee" variant="icon" />
          : <Slot><Avatar userId={issue.assignee_id} size={16} /></Slot>)}
      </span>
    </a>
  );
});
