/* ─── Locus · shape guards for saved-view JSON (views.filters / views.display, per-viewer prefs) ───
   Any member can write a shared view, and per-viewer display prefs live in localStorage, so neither
   is trusted: everything that reaches the query engine passes through here first. Unknown fields
   and values are dropped (never thrown on), so one malformed row cannot crash a surface. */

import type { CompletedWindow, DisplayOptions, DisplayProperty, Filter, FilterField, Grouping, Ordering } from "@/lib/types";

export const FILTER_FIELDS: readonly FilterField[] = [
  "status", "state_type", "assignee", "creator", "priority", "label", "project", "cycle", "team", "estimate", "due",
];
const FIELD_SET = new Set<string>(FILTER_FIELDS);

const GROUPINGS = new Set<Grouping>(["status", "assignee", "project", "priority", "cycle", "label", "team", "none"]);
const ORDERINGS = new Set<Ordering>(["manual", "priority", "updated", "created", "due", "title", "estimate"]);
const COMPLETED = new Set<CompletedWindow>(["all", "day", "week", "month", "none"]);
const PROPERTIES = new Set<DisplayProperty>([
  "id", "status", "priority", "assignee", "labels", "project", "cycle", "estimate", "due", "created", "updated",
  "milestone", "subIssues",
]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One filter, or null when it cannot be applied (unknown field, no values array). */
export function sanitizeFilter(v: unknown, index = 0): Filter | null {
  if (!isObject(v) || typeof v.field !== "string" || !FIELD_SET.has(v.field) || !Array.isArray(v.values)) return null;
  return {
    id: typeof v.id === "string" && v.id ? v.id : `filter-${index}`,
    field: v.field as FilterField,
    op: v.op === "is_not" ? "is_not" : "is",
    values: v.values.filter((x): x is string => typeof x === "string"),
  };
}

export function sanitizeFilters(v: unknown): Filter[] {
  if (!Array.isArray(v)) return [];
  const out: Filter[] = [];
  v.forEach((f, i) => {
    const ok = sanitizeFilter(f, i);
    if (ok) out.push(ok);
  });
  return out;
}

/** Keep only the display options this version understands; invalid values fall back to the defaults. */
export function sanitizeDisplay(v: unknown): Partial<DisplayOptions> {
  if (!isObject(v)) return {};
  const out: Partial<DisplayOptions> = {};
  if (v.layout === "list" || v.layout === "board") out.layout = v.layout;
  if (typeof v.grouping === "string" && GROUPINGS.has(v.grouping as Grouping)) out.grouping = v.grouping as Grouping;
  if (typeof v.ordering === "string" && ORDERINGS.has(v.ordering as Ordering)) out.ordering = v.ordering as Ordering;
  if (typeof v.completed === "string" && COMPLETED.has(v.completed as CompletedWindow)) out.completed = v.completed as CompletedWindow;
  if (typeof v.showEmptyGroups === "boolean") out.showEmptyGroups = v.showEmptyGroups;
  if (typeof v.showSubIssues === "boolean") out.showSubIssues = v.showSubIssues;
  if (isObject(v.properties)) {
    const props: Partial<Record<DisplayProperty, boolean>> = {};
    for (const [k, on] of Object.entries(v.properties)) {
      if (PROPERTIES.has(k as DisplayProperty) && typeof on === "boolean") props[k as DisplayProperty] = on;
    }
    out.properties = props as Record<DisplayProperty, boolean>;
  }
  return out;
}

/** A views row as the client may rely on it: filters is a Filter[], display a plain object. */
export function sanitizeViewRow<T extends Record<string, unknown>>(row: T): T {
  const hasFilters = "filters" in row;
  const hasDisplay = "display" in row;
  if (!hasFilters && !hasDisplay) return row;
  const next: Record<string, unknown> = { ...row };
  if (hasFilters) next.filters = sanitizeFilters(row.filters);
  if (hasDisplay) next.display = sanitizeDisplay(row.display);
  return next as T;
}
