/* ─── Locus · read a saved view's stored filters/display defensively ───
 *
 * `views.filters` and `views.display` are jsonb columns with no shape check, and any
 * workspace member can insert a shared view through the API. Every saved-view surface reads
 * them through these helpers so a malformed row degrades to "fewer filters" instead of
 * crashing the Views list (and the view's own page, which is where it would be deleted).
 * Results are cached per stored value, so they are referentially stable across renders. */

import { DEFAULT_PROPERTIES } from "@/lib/model";
import type { CompletedWindow, DisplayOptions, DisplayProperty, Filter, FilterField, FilterOp, Grouping, Ordering, View } from "@/lib/types";

const FIELDS: Record<FilterField, true> = {
  status: true, state_type: true, assignee: true, creator: true, priority: true, label: true,
  project: true, cycle: true, team: true, estimate: true, due: true,
};
const OPS: Record<FilterOp, true> = { is: true, is_not: true };
const LAYOUTS: Record<DisplayOptions["layout"], true> = { list: true, board: true };
const GROUPINGS: Record<Grouping, true> = {
  status: true, assignee: true, project: true, priority: true, cycle: true, label: true, team: true, none: true,
};
const ORDERINGS: Record<Ordering, true> = {
  manual: true, priority: true, updated: true, created: true, due: true, title: true, estimate: true,
};
const COMPLETED: Record<CompletedWindow, true> = { all: true, day: true, week: true, month: true, none: true };

const has = (o: object, k: unknown): boolean => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const NO_FILTERS: Filter[] = [];
const NO_DISPLAY: Partial<DisplayOptions> = {};
const filterCache = new WeakMap<object, Filter[]>();
const displayCache = new WeakMap<object, Partial<DisplayOptions>>();

function cleanFilters(raw: unknown[]): Filter[] {
  const out: Filter[] = [];
  const ids = new Set<string>();
  raw.forEach((f, i) => {
    if (!isRecord(f) || !has(FIELDS, f.field) || !has(OPS, f.op) || !Array.isArray(f.values)) return;
    const values = f.values.filter((v): v is string => typeof v === "string");
    if (values.length !== f.values.length) return;
    // ids key the chips and drive "remove filter"; a missing or repeated one gets a stable stand-in
    let id = typeof f.id === "string" && f.id && !ids.has(f.id) ? f.id : `filter-${i}`;
    while (ids.has(id)) id = `${id}-${i}`;
    ids.add(id);
    out.push({ id, field: f.field as FilterField, op: f.op as FilterOp, values });
  });
  return out;
}

/** The view's stored filters, keeping only well-formed ones (known field, is/is_not, string values). */
export function viewFilters(view: Pick<View, "filters">): Filter[] {
  const raw: unknown = view.filters;
  if (!Array.isArray(raw)) return NO_FILTERS;
  let clean = filterCache.get(raw);
  if (!clean) {
    clean = cleanFilters(raw);
    filterCache.set(raw, clean);
  }
  return clean;
}

function cleanDisplay(raw: Record<string, unknown>): Partial<DisplayOptions> {
  const out: Partial<DisplayOptions> = {};
  if (has(LAYOUTS, raw.layout)) out.layout = raw.layout as DisplayOptions["layout"];
  if (has(GROUPINGS, raw.grouping)) out.grouping = raw.grouping as Grouping;
  if (has(ORDERINGS, raw.ordering)) out.ordering = raw.ordering as Ordering;
  if (has(COMPLETED, raw.completed)) out.completed = raw.completed as CompletedWindow;
  if (typeof raw.showEmptyGroups === "boolean") out.showEmptyGroups = raw.showEmptyGroups;
  if (typeof raw.showSubIssues === "boolean") out.showSubIssues = raw.showSubIssues;
  if (isRecord(raw.properties)) {
    const props: Partial<Record<DisplayProperty, boolean>> = {};
    let any = false;
    for (const k of Object.keys(DEFAULT_PROPERTIES) as DisplayProperty[]) {
      const v = raw.properties[k];
      if (typeof v === "boolean") { props[k] = v; any = true; }
    }
    if (any) out.properties = props as DisplayOptions["properties"];
  }
  return out;
}

/** The view's stored display options, keeping only recognised keys with valid values. */
export function viewDisplay(view: Pick<View, "display">): Partial<DisplayOptions> {
  const raw: unknown = view.display;
  if (!isRecord(raw)) return NO_DISPLAY;
  let clean = displayCache.get(raw);
  if (!clean) {
    clean = cleanDisplay(raw);
    displayCache.set(raw, clean);
  }
  return clean;
}
