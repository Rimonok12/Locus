"use client";
/* ─── Locus · issue board layout ─────────────────────────────────────────────
   One column per group (every workflow state when grouped by status), cards
   dragged with @dnd-kit: drop into another column applies the group's patch,
   drop within a column re-orders (switching the view to manual ordering).
   The board renders from local state while a drag is in flight, then writes
   optimistically so the card never flickers back.
   ──────────────────────────────────────────────────────────────────────────── */

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragOverEvent, type DragStartEvent, type DropAnimation, type MeasuringConfiguration,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui, useUI } from "@/lib/ui";
import {
  STATE_TYPES, STATE_TYPE_COLOR, STATE_TYPE_LABEL, defaultStateFor, issueKey, patchForGroup, sortStates,
  type IssueGroup, type IssueQuery, type QueryCtx,
} from "@/lib/model";
import { moveIssue } from "@/lib/sync/actions";
import { hrefFor } from "@/lib/router";
import { IconButton } from "@/components/primitives/controls";
import { Avatar } from "@/components/primitives/Avatar";
import { PriorityIcon } from "@/components/primitives/icons";
import { LabelPills, StateGlyph } from "@/components/pickers";
import {
  CycleChip, DueChip, EstimateChip, GroupIcon, MilestoneChip, ProjectChip, SubIssueChip, asSet, statusGroupAllowed, type SubCounts,
} from "./shared";
import { useListInteractions, type MenuRequest } from "./useListInteractions";
import type { DisplayOptions, Grouping, Issue } from "@/lib/types";

type Properties = DisplayOptions["properties"];

const PAGE = 50;
const EMPTY: string[] = [];
const COLUMN_PREFIX = "column:";

/* ═══ dnd-kit configuration ═══ */

/** Pointer sensor for mouse/pen only — touch goes through the long-press TouchSensor so columns keep scrolling. */
class MousePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent) => {
        if (event.pointerType === "touch" || !event.isPrimary || event.button !== 0) return false;
        // let buttons inside a card keep their own click
        const t = event.target as HTMLElement | null;
        if (t?.closest?.("button")) return false;
        return true;
      },
    },
  ];
}

const POINTER_OPTIONS = { activationConstraint: { distance: 5 } };
const TOUCH_OPTIONS = { activationConstraint: { delay: 200, tolerance: 6 } };
const KEYBOARD_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
};
const MEASURING: MeasuringConfiguration = { droppable: { strategy: MeasuringStrategy.Always } };
const DROP_ANIMATION: DropAnimation = { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" };

/* ═══ ids: label boards can show one issue in several columns, so sortable ids are per column there ═══ */

const sidOf = (perColumn: boolean, colKey: string, issueId: string) => (perColumn ? `${colKey}::${issueId}` : issueId);
const issueOf = (perColumn: boolean, sid: string) => (perColumn ? sid.slice(sid.lastIndexOf("::") + 2) : sid);
const columnId = (key: string) => `${COLUMN_PREFIX}${key}`;
const isColumnId = (id: string) => id.startsWith(COLUMN_PREFIX);

function findColumn(items: Record<string, string[]>, id: string): string | undefined {
  if (isColumnId(id)) {
    const key = id.slice(COLUMN_PREFIX.length);
    return key in items ? key : undefined;
  }
  for (const key of Object.keys(items)) if (items[key].includes(id)) return key;
  return undefined;
}

/* ═══ columns ═══ */

/**
 * Status boards show every workflow state, except completed/canceled when the completed
 * window is "None" and states the view's status filters rule out (a team's Active tab has
 * no Backlog or Done column). A column that holds issues is always shown.
 */
function boardColumns(query: IssueQuery): IssueGroup[] {
  const { groups, display, ctx, filters } = query;
  if (display.grouping !== "status") return groups;
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const hideDone = display.completed === "none";
  const keep = (g: IssueGroup, type: string) =>
    g.issues.length > 0 || (!(hideDone && (type === "completed" || type === "canceled")) && statusGroupAllowed(g, filters, ctx));
  const stateGroup = groups.find((g) => g.value && ctx.states[g.value]);
  const teamId = stateGroup?.value ? ctx.states[stateGroup.value].team_id : undefined;
  if (teamId) {
    return sortStates(Object.values(ctx.states).filter((s) => s.team_id === teamId))
      .map((s) => ({ type: s.type as string, g: byKey.get(s.id) ?? { key: s.id, grouping: "status" as Grouping, value: s.id, label: s.name, color: s.color, issues: [] } }))
      .filter(({ type, g }) => keep(g, type))
      .map(({ g }) => g);
  }
  return STATE_TYPES
    .map((t) => ({ type: t as string, g: byKey.get(t) ?? { key: t, grouping: "status" as Grouping, value: t, label: STATE_TYPE_LABEL[t], color: STATE_TYPE_COLOR[t], issues: [] } }))
    .filter(({ type, g }) => keep(g, type))
    .map(({ g }) => g);
}

/** The patch that moves `issue` from `source` into `target` (null = not allowed). */
function dropPatch(target: IssueGroup, source: IssueGroup | undefined, issue: Issue, ctx: QueryCtx): Partial<Issue> | null {
  switch (target.grouping) {
    case "label": {
      // move between labels (not "add another label"); "No labels" clears them
      if (!target.value) return { label_ids: [] };
      const kept = source?.value ? issue.label_ids.filter((l) => l !== source.value) : issue.label_ids;
      return { label_ids: Array.from(new Set([...kept, target.value])) };
    }
    case "project": {
      const p = patchForGroup(target, issue, ctx);
      return p ? { ...p, milestone_id: null } : null;
    }
    case "team": {
      const p = patchForGroup(target, issue, ctx);
      if (!p || !target.value) return null;
      const type = ctx.states[issue.state_id]?.type;
      const state = defaultStateFor(target.value, ctx.states, type);
      return { ...p, cycle_id: null, ...(state ? { state_id: state.id } : {}) };
    }
    default:
      return patchForGroup(target, issue, ctx);
  }
}

interface DragState {
  activeId: string;
  fromCol: string;
  fromIndex: number;
  items: Record<string, string[]>;
}

/* ═══ board ═══ */

export default function IssueBoard({
  query, viewKey, openMenu, createInGroup, subCounts,
}: {
  query: IssueQuery;
  viewKey: string;
  openMenu: (req: MenuRequest) => void;
  createInGroup: (group: IssueGroup) => void;
  subCounts: SubCounts;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { display, ctx } = query;
  const perColumn = display.grouping === "label";
  const columns = useMemo(() => boardColumns(query), [query]);
  const byId = useMemo(() => new Map(query.flat.map((i) => [i.id, i])), [query.flat]);
  const [limits, setLimits] = useState<Record<string, number>>({});

  const baseItems = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) out[c.key] = c.issues.slice(0, limits[c.key] ?? PAGE).map((i) => sidOf(perColumn, c.key, i.id));
    return out;
  }, [columns, limits, perColumn]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const setDragState = useCallback((d: DragState | null) => { dragRef.current = d; setDrag(d); }, []);

  const latest = useRef({ baseItems, columns, ctx, ordering: display.ordering, perColumn, viewKey, byId });
  useLayoutEffect(() => {
    latest.current = { baseItems, columns, ctx, ordering: display.ordering, perColumn, viewKey, byId };
  });

  // keyboard order: column by column, rendered cards only
  const ids = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of columns) for (const sid of baseItems[c.key] ?? EMPTY) {
      const id = issueOf(perColumn, sid);
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out;
  }, [columns, baseItems, perColumn]);

  const isDragging = useCallback(() => dragRef.current !== null, []);
  // a touch long-press starts a drag; never pop the context menu over it
  const menuUnlessDragging = useCallback((req: MenuRequest) => { if (!dragRef.current) openMenu(req); }, [openMenu]);
  const { handlers, suppressClicks } = useListInteractions({ ids, containerRef, openMenu: menuUnlessDragging, suspended: isDragging });

  const sensors = useSensors(
    useSensor(MousePointerSensor, POINTER_OPTIONS),
    useSensor(TouchSensor, TOUCH_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_OPTIONS),
  );

  const onDragStart = useCallback(({ active }: DragStartEvent) => {
    const sid = String(active.id);
    const items = latest.current.baseItems;
    const col = findColumn(items, sid);
    if (!col) return;
    setDragState({ activeId: sid, fromCol: col, fromIndex: items[col].indexOf(sid), items });
    ui.setFocused(issueOf(latest.current.perColumn, sid));
  }, [setDragState]);

  const onDragOver = useCallback(({ active, over }: DragOverEvent) => {
    const d = dragRef.current;
    if (!d || !over) return;
    const activeSid = String(active.id);
    const overId = String(over.id);
    const from = findColumn(d.items, activeSid);
    const to = findColumn(d.items, overId);
    if (!from || !to || from === to) return;
    const fromItems = d.items[from].filter((x) => x !== activeSid);
    const toItems = d.items[to].filter((x) => x !== activeSid);
    let index = toItems.length;
    if (!isColumnId(overId)) {
      const overIndex = toItems.indexOf(overId);
      if (overIndex >= 0) {
        const r = active.rect.current.translated;
        const below = r ? r.top > over.rect.top + over.rect.height / 2 : false;
        index = overIndex + (below ? 1 : 0);
      }
    }
    setDragState({
      ...d,
      items: { ...d.items, [from]: fromItems, [to]: [...toItems.slice(0, index), activeSid, ...toItems.slice(index)] },
    });
  }, [setDragState]);

  const onDragCancel = useCallback(() => {
    setDragState(null);
    suppressClicks(250);
  }, [setDragState, suppressClicks]);

  const onDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    const d = dragRef.current;
    setDragState(null);
    suppressClicks(250);
    if (!d || !over) return;
    const L = latest.current;
    const activeSid = String(active.id);
    const overId = String(over.id);
    const toCol = findColumn(d.items, activeSid);
    if (!toCol) return;

    let list = d.items[toCol];
    if (!isColumnId(overId) && findColumn(d.items, overId) === toCol) {
      const a = list.indexOf(activeSid);
      const b = list.indexOf(overId);
      if (a >= 0 && b >= 0 && a !== b) list = arrayMove(list, a, b);
    }
    const index = list.indexOf(activeSid);
    const changedColumn = toCol !== d.fromCol;
    if (!changedColumn && index === d.fromIndex) return;

    const issueId = issueOf(L.perColumn, activeSid);
    const issue = useSync.getState().issues[issueId];
    const target = L.columns.find((c) => c.key === toCol);
    if (!issue || !target) return;

    let patch: Partial<Issue> = {};
    if (changedColumn) {
      const source = L.columns.find((c) => c.key === d.fromCol);
      const p = dropPatch(target, source, issue, L.ctx);
      if (!p) {
        toast.error(target.grouping === "cycle"
          ? `${issueKey(issue)} can only join cycles of its own team`
          : `${issueKey(issue)} can’t be moved to ${target.label}`);
        return;
      }
      patch = p;
    }

    // neighbours in the full (not just rendered) target column, skipping the dragged issue itself
    let k = index - 1;
    while (k >= 0 && issueOf(L.perColumn, list[k]) === issueId) k--;
    const prevId = k >= 0 ? issueOf(L.perColumn, list[k]) : undefined;
    const full = target.issues.filter((i) => i.id !== issueId);
    const at = prevId ? full.findIndex((i) => i.id === prevId) + 1 : 0;
    const pos = prevId && at === 0 ? full.length : at;
    moveIssue(issueId, patch, { prev: full[pos - 1]?.sort_order, next: full[pos]?.sort_order });

    if (!changedColumn && L.ordering !== "manual") {
      ui.setDisplay(L.viewKey, { ordering: "manual" });
      toast("Ordering switched to manual");
    }
  }, [setDragState, suppressClicks]);

  const announcements = useMemo((): Announcements => {
    const name = (id: UniqueIdentifier) => {
      const L = latest.current;
      const issue = L.byId.get(issueOf(L.perColumn, String(id)));
      return issue ? issueKey(issue) : "issue";
    };
    const place = (id: UniqueIdentifier) => {
      const L = latest.current;
      const s = String(id);
      const key = isColumnId(s) ? s.slice(COLUMN_PREFIX.length) : findColumn(dragRef.current?.items ?? L.baseItems, s);
      return L.columns.find((c) => c.key === key)?.label ?? "the board";
    };
    return {
      onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
      onDragOver: ({ active, over }) => (over ? `${name(active.id)} is over ${place(over.id)}.` : `${name(active.id)} is outside the board.`),
      onDragEnd: ({ active, over }) => (over ? `${name(active.id)} was dropped in ${place(over.id)}.` : `${name(active.id)} was dropped.`),
      onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
    };
  }, []);

  const showMore = useCallback((key: string) => {
    setLimits((l) => ({ ...l, [key]: (l[key] ?? PAGE) + PAGE * 2 }));
  }, []);

  const activeIssue = drag ? byId.get(issueOf(perColumn, drag.activeId)) : undefined;
  const activeSub = activeIssue ? subCounts.get(activeIssue.id) : undefined;

  return (
    <DndContext
      id={`board:${viewKey}`}
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={MEASURING}
      accessibility={{ announcements }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div
        ref={containerRef}
        aria-label="Issue board"
        className={`flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-px-3 px-3 py-3 md:px-4 ${
          drag ? "" : "snap-x snap-mandatory sm:snap-none"
        }`}
        {...handlers}
      >
        {columns.map((col) => {
          const items = (drag ? drag.items[col.key] : baseItems[col.key]) ?? EMPTY;
          return (
            <BoardColumn
              key={col.key}
              group={col}
              ctx={ctx}
              items={items}
              perColumn={perColumn}
              byId={byId}
              props={display.properties}
              subCounts={subCounts}
              hidden={Math.max(0, col.issues.length - (limits[col.key] ?? PAGE))}
              dragging={Boolean(drag)}
              receiving={Boolean(drag && drag.fromCol !== col.key && items.includes(drag.activeId))}
              onMore={showMore}
              onCreate={createInGroup}
            />
          );
        })}
        <span aria-hidden className="w-px shrink-0" />
      </div>
      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {activeIssue ? (
          <div className="rotate-[2.5deg] cursor-grabbing rounded-lg border border-line-strong bg-surface p-3 shadow-pop">
            <CardBody
              issue={activeIssue}
              props={display.properties}
              grouping={display.grouping}
              subTotal={activeSub?.total ?? 0}
              subDone={activeSub?.done ?? 0}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/* ═══ column ═══ */

const BoardColumn = memo(function BoardColumn({
  group, ctx, items, perColumn, byId, props, subCounts, hidden, dragging, receiving, onMore, onCreate,
}: {
  group: IssueGroup;
  ctx: QueryCtx;
  items: string[];
  perColumn: boolean;
  byId: Map<string, Issue>;
  props: Properties;
  subCounts: SubCounts;
  hidden: number;
  dragging: boolean;
  receiving: boolean;
  onMore: (key: string) => void;
  onCreate: (group: IssueGroup) => void;
}) {
  const { setNodeRef } = useDroppable({ id: columnId(group.key) });
  const isEmpty = items.length === 0;
  return (
    <div
      ref={setNodeRef}
      aria-label={`${group.label} · ${group.issues.length}`}
      className={`flex h-full w-[85vw] shrink-0 snap-start flex-col rounded-lg bg-raised transition-shadow sm:w-[300px] ${
        receiving ? "ring-1 ring-accent" : ""
      }`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 pl-3 pr-1">
        {group.grouping !== "none" && <span className="flex w-4 shrink-0 items-center justify-center"><GroupIcon group={group} ctx={ctx} /></span>}
        <span className="truncate text-[13px] font-medium text-ink">{group.label}</span>
        <span className="shrink-0 text-[12.5px] tabular-nums text-faint">{group.issues.length}</span>
        <span className="flex-1" />
        <IconButton label={`New issue in ${group.label}`} size={32} onClick={() => onCreate(group)} className="sm:!h-7 sm:!w-7">
          <Plus size={15} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-12">
        <SortableContext id={group.key} items={items} strategy={verticalListSortingStrategy}>
          <div className="flex min-h-[72px] flex-col gap-2">
            {items.map((sid) => {
              const issue = byId.get(issueOf(perColumn, sid));
              if (!issue) return null;
              const sc = subCounts.get(issue.id);
              return (
                <BoardCard
                  key={sid}
                  sid={sid}
                  issue={issue}
                  props={props}
                  grouping={group.grouping}
                  subTotal={sc?.total ?? 0}
                  subDone={sc?.done ?? 0}
                />
              );
            })}
            {isEmpty && (
              <div className={`flex h-[72px] items-center justify-center rounded-lg border border-dashed text-xxs transition-colors ${
                dragging ? "border-accent text-accent" : "border-line-strong text-faint"
              }`}>
                {dragging ? "Drop here" : "No issues"}
              </div>
            )}
          </div>
        </SortableContext>
        {hidden > 0 && !dragging && (
          <button
            type="button"
            onClick={() => onMore(group.key)}
            className="focus-ring mt-2 h-8 w-full rounded-md text-[12.5px] text-faint transition-colors hover:bg-wash hover:text-ink"
          >
            Show {Math.min(hidden, PAGE * 2)} more
          </button>
        )}
      </div>
    </div>
  );
});

/* ═══ card ═══ */

const BoardCard = memo(function BoardCard({
  sid, issue, props, grouping, subTotal, subDone,
}: { sid: string; issue: Issue; props: Properties; grouping: Grouping; subTotal: number; subDone: number }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: sid });
  const focused = useUI((s) => s.focusedId === issue.id);
  const selected = useUI((s) => asSet(s.selected).has(issue.id));
  const team = useSync((s) => s.teams[issue.team_id]);
  const href = hrefFor({ kind: "issue", identifier: issueKey(issue, team ? { [team.id]: team } : {}) });
  // keep link semantics (no role="button"): Enter opens the issue, Space starts a keyboard drag
  const { role: _role, ...a11y } = attributes;
  void _role;

  return (
    <a
      ref={setNodeRef}
      href={href}
      draggable={false}
      data-issue-id={issue.id}
      {...a11y}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform), transition, WebkitTouchCallout: "none" }}
      className={`block touch-manipulation select-none rounded-lg border p-3 shadow-card outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
        isDragging ? "opacity-40" : ""
      } ${selected ? "border-accent bg-accent-soft" : focused ? "border-line-strong bg-surface" : "border-line bg-surface"}`}
    >
      <CardBody issue={issue} props={props} grouping={grouping} subTotal={subTotal} subDone={subDone} />
    </a>
  );
});

const CardBody = memo(function CardBody({
  issue, props, grouping, subTotal, subDone,
}: { issue: Issue; props: Properties; grouping: Grouping; subTotal: number; subDone: number }) {
  const team = useSync((s) => s.teams[issue.team_id]);
  const identifier = issueKey(issue, team ? { [team.id]: team } : {});
  const showStatus = props.status && grouping !== "status";
  const showPriority = props.priority && grouping !== "priority" && issue.priority !== 0;
  return (
    <>
      {(props.id || props.assignee) && (
        <div className="mb-1 flex h-[18px] items-center gap-2">
          {props.id && <span className="truncate text-xxs tabular-nums text-faint">{identifier}</span>}
          <span className="flex-1" />
          {props.assignee && <Avatar userId={issue.assignee_id} size={18} />}
        </div>
      )}
      <div className="flex items-start gap-1.5">
        {showStatus && <span className="mt-[2px] flex shrink-0"><StateGlyph stateId={issue.state_id} /></span>}
        <p className="line-clamp-2 min-w-0 break-words text-[13px] font-medium leading-[18px] text-ink">{issue.title || "Untitled"}</p>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 empty:hidden">
        {showPriority && (
          <span title={`Priority`} className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md border border-line-strong text-dim">
            <PriorityIcon priority={issue.priority} size={13} />
          </span>
        )}
        {props.labels && issue.label_ids.length > 0 && <LabelPills issue={issue} editable={false} max={2} />}
        {props.due && <DueChip date={issue.due_date} />}
        {props.estimate && <EstimateChip value={issue.estimate} />}
        {props.project && grouping !== "project" && <ProjectChip id={issue.project_id} />}
        {props.cycle && grouping !== "cycle" && <CycleChip id={issue.cycle_id} />}
        {props.milestone && <MilestoneChip id={issue.milestone_id} />}
        {props.subIssues && subTotal > 0 && <SubIssueChip done={subDone} total={subTotal} />}
      </div>
    </>
  );
});
