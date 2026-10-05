"use client";
/* ─── Locus · sync engine ────────────────────────────────────────────────────
   The whole workspace lives in memory as normalised entity maps (one map per
   table, keyed by primary key). Reads are synchronous; writes are optimistic:
   the change is applied locally first, sent to Postgres (RLS-protected), then
   reconciled with the row the server returns. Supabase Realtime streams every
   other client's changes into the same maps, and an IndexedDB snapshot makes
   cold starts instant.

   Consistency rules
   • The realtime channel is joined BEFORE the authoritative snapshot is taken;
     events that arrive while a snapshot is in flight are buffered and replayed
     on top of it, so nothing committed in between is ever missed.
   • Rows written locally while a snapshot is in flight keep their local state
     (including being deleted) — the snapshot only fills in everything else.
   • While a write to a row is in flight, remote changes to that row are
     stashed and reconciled with the server's response once it settles (newest
     server timestamp wins); remote deletes apply immediately.
   • Realtime UPDATE payloads may omit unchanged TOASTed columns, so they are
     merged onto the current row, never replace it.
   • updated_at is only ever compared between server timestamps (Date.parse).
   ──────────────────────────────────────────────────────────────────────────── */

import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";
import { supabase } from "@/lib/supabase/client";
import { toast } from "@/lib/ui";
import type { Profile, Row, TableName, Workspace } from "@/lib/types";

type Rec<T> = Record<string, T>;
type AnyRow = Record<string, unknown>;
export type Entities = { [T in TableName]: Rec<Row<T>> };

export interface SyncState extends Entities {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  connection: "connecting" | "live" | "offline";
  userId: string;
  workspaceId: string;
  /** issues whose comments/history/subscribers have been fetched */
  loadedIssues: Record<string, true>;
  lastSyncedAt: number;
}

const EMPTY_ENTITIES = (): Entities => ({
  profiles: {}, workspaces: {}, workspace_members: {}, workspace_invites: {}, teams: {}, team_members: {},
  workflow_states: {}, labels: {}, projects: {}, project_milestones: {}, project_updates: {}, cycles: {},
  issues: {}, issue_relations: {}, issue_subscribers: {}, comments: {}, reactions: {}, issue_history: {},
  notifications: {}, favorites: {}, views: {},
});

export const useSync = create<SyncState>()(() => ({
  ...EMPTY_ENTITIES(),
  status: "idle",
  error: null,
  connection: "connecting",
  userId: "",
  workspaceId: "",
  loadedIssues: {},
  lastSyncedAt: 0,
}));

const S = () => useSync.getState();
const table$ = (t: TableName) => S()[t] as unknown as Rec<AnyRow>;

/* ─── table metadata ─── */

/** natural keys of membership-style tables (rows are keyed by these locally; the DB key is an opaque id) */
const COMPOSITE: Partial<Record<TableName, readonly string[]>> = {
  workspace_members: ["workspace_id", "user_id"],
  team_members: ["team_id", "user_id"],
  issue_subscribers: ["issue_id", "user_id"],
};
const HAS_UPDATED_AT = new Set<TableName>([
  "profiles", "workspaces", "teams", "workflow_states", "labels", "projects", "project_milestones",
  "project_updates", "cycles", "issues", "comments", "views",
]);
const NOT_WS_SCOPED = new Set<TableName>(["profiles", "workspaces"]);
const LAZY = new Set<TableName>(["comments", "reactions", "issue_history"]);
/** tables with long text columns: a realtime UPDATE may omit their unchanged (TOASTed) values */
const WIDE = new Set<TableName>(["issues", "projects", "project_updates", "comments", "views"]);

const keyCols = (t: TableName): readonly string[] => COMPOSITE[t] ?? ["id"];

export function pkOf(table: TableName, row: Record<string, unknown>): string {
  if (table === "workspace_members") return String(row.user_id);
  const cols = COMPOSITE[table];
  if (cols) return cols.map((c) => String(row[c])).join(":");
  return String(row.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchPk(q: any, table: TableName, row: Record<string, unknown>): any {
  return keyCols(table).reduce((acc, c) => acc.eq(c, row[c]), q);
}

/** Server timestamps only. Unparseable values never count as older. */
const older = (a: unknown, b: unknown) => {
  const x = typeof a === "string" ? Date.parse(a) : NaN;
  const y = typeof b === "string" ? Date.parse(b) : NaN;
  return Number.isFinite(x) && Number.isFinite(y) && x < y;
};

/* ─── session generation (bootstrap/teardown) ─── */

/** bumped by teardown(): async work started in an older session must not touch the store */
let bootGen = 0;

/* ─── pending-mutation bookkeeping ─── */

const pending = new Map<string, number>();
const pendingInserts = new Map<string, number>();
const pkey = (t: TableName, k: string) => `${t}:${k}`;
const count = (m: Map<string, number>, k: string, d: 1 | -1) => {
  const n = (m.get(k) ?? 0) + d;
  if (n <= 0) m.delete(k); else m.set(k, n);
};
const bump = (t: TableName, k: string, d: 1 | -1) => count(pending, pkey(t, k), d);
const isPending = (t: TableName, k: string) => pending.has(pkey(t, k));

/** Remote changes (and overlapping responses) for keys with a write in flight, reconciled by settle(). */
type Cand = { kind: "row"; row: AnyRow } | { kind: "delete" };
const stash = new Map<string, { event?: Cand; response?: AnyRow }>();
const stashOf = (t: TableName, k: string) => {
  const pk = pkey(t, k);
  let e = stash.get(pk);
  if (!e) { e = {}; stash.set(pk, e); }
  return e;
};

/* ─── local entity writes ─── */

/** keys written locally while a snapshot (refresh / issue details) is in flight: local state wins for them */
const activeRefreshes = new Set<Set<string>>();
function touch(t: TableName, keys: Iterable<string>) {
  if (!activeRefreshes.size) return;
  for (const k of keys) for (const d of activeRefreshes) d.add(pkey(t, k));
}

function setRows<T extends TableName>(table: T, rows: Row<T>[]) {
  if (!rows.length) return;
  touch(table, rows.map((r) => pkOf(table, r as unknown as AnyRow)));
  useSync.setState((s) => {
    const next = { ...s[table] } as Rec<Row<T>>;
    for (const r of rows) next[pkOf(table, r as unknown as AnyRow)] = r;
    return { [table]: next } as Partial<SyncState>;
  });
}
const setRow = <T extends TableName>(table: T, row: Row<T>) => setRows(table, [row]);

/** Overlay (possibly partial) rows on the current ones, in order. */
function patchRows(table: TableName, rows: AnyRow[]) {
  if (!rows.length) return;
  touch(table, rows.map((r) => pkOf(table, r)));
  useSync.setState((s) => {
    const next = { ...s[table] } as unknown as Rec<AnyRow>;
    for (const r of rows) {
      const k = pkOf(table, r);
      const prev = next[k];
      next[k] = prev ? { ...prev, ...r } : r;
    }
    return { [table]: next } as Partial<SyncState>;
  });
}

function deleteRows(table: TableName, keys: string[]) {
  if (!keys.length) return;
  touch(table, keys); // also a tombstone for an in-flight snapshot
  useSync.setState((s) => {
    const next = { ...s[table] } as Rec<unknown>;
    let changed = false;
    for (const k of keys) if (k in next) { delete next[k]; changed = true; }
    return changed ? ({ [table]: next } as Partial<SyncState>) : {};
  });
}

/** Put back the patched fields of a row (only those), keeping whatever else changed meanwhile. */
function revertFields(table: TableName, key: string, fields: string[], before: AnyRow) {
  const current = table$(table)[key];
  if (!current) return;
  const revert = { ...current };
  for (const f of fields) revert[f] = before[f];
  setRow(table, revert as never);
}

/** Restore rows that are no longer in the store (failed delete). */
function restoreRows(table: TableName, befores: AnyRow[]) {
  const rec = table$(table);
  setRows(table, befores.filter((b) => !rec[pkOf(table, b)]) as never);
}

/**
 * Reconcile a key once its last in-flight write has finished: a remote delete wins;
 * otherwise the newer (by server updated_at) of the remote change and our response is applied.
 */
function settle(table: TableName, key: string) {
  if (isPending(table, key)) return;
  const pk = pkey(table, key);
  const e = stash.get(pk);
  stash.delete(pk);
  if (!e) return;
  if (e.event?.kind === "delete") { deleteRows(table, [key]); return; }
  const remote = e.event?.kind === "row" ? e.event.row : undefined;
  const resp = e.response;
  if (resp && remote) {
    const remoteWins = HAS_UPDATED_AT.has(table) && older(resp.updated_at, remote.updated_at);
    setRow(table, (remoteWins ? { ...resp, ...remote } : resp) as never);
  } else if (resp) {
    setRow(table, resp as never);
  } else if (remote) {
    patchRows(table, [remote]);
  }
}

/** Record a server response for a key, then settle it if nothing else is in flight. */
function resolve(table: TableName, key: string, response: AnyRow) {
  const e = stashOf(table, key);
  if (!e.response || !(HAS_UPDATED_AT.has(table) && older(response.updated_at, e.response.updated_at))) e.response = response;
  settle(table, key);
}

/** Drop stashed remote changes for a key whose row we deleted (it is gone on the server). */
const forget = (table: TableName, key: string) => { if (!isPending(table, key)) stash.delete(pkey(table, key)); };

/* ─── errors ─── */

interface PgError { message?: string; code?: string; details?: string; hint?: string }

export function friendlyError(e: unknown): string {
  const err = (e ?? {}) as PgError;
  const msg = err.message ?? String(e);
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) return "You're offline — the change wasn't saved.";
  if (err.code === "23505") return "That name is already taken.";
  if (err.code === "42501" || /row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (err.code === "23514") return msg.includes("reserved") ? "That URL is reserved." : /too long/i.test(msg) ? msg : "Some values aren't valid.";
  if (err.code === "P0001" || err.code === "P0002") return msg;
  return msg.length < 140 ? msg : "Something went wrong — please try again.";
}

function fail(e: unknown, what: string) {
  console.error(`[locus] ${what}`, e);
  toast.error(`${what}: ${friendlyError(e)}`);
}

/* ─── generic optimistic mutations ─── */

const nowIso = () => new Date().toISOString();
export const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (+c ^ (Math.random() * 16) >> (+c / 4)).toString(16));

type Insertable<T extends TableName> = Partial<Row<T>>;

/** Insert a row optimistically. Resolves with the server row, or null on failure (already reverted + toasted). */
export async function insert<T extends TableName>(table: T, values: Insertable<T>, what = "Couldn't save"): Promise<Row<T> | null> {
  const gen = bootGen;
  const payload: AnyRow = { ...values };
  const cols = COMPOSITE[table];
  if (!cols && !payload.id) payload.id = uuid();
  if (!NOT_WS_SCOPED.has(table) && !payload.workspace_id) payload.workspace_id = S().workspaceId;
  const optimistic = {
    created_at: nowIso(),
    ...(HAS_UPDATED_AT.has(table) ? { updated_at: nowIso() } : {}),
    ...payload,
  } as AnyRow;
  const key = pkOf(table, payload);
  // a real row may already be stored under a natural key (e.g. created by a trigger)
  const prev = table$(table)[key];
  bump(table, key, 1);
  count(pendingInserts, pkey(table, key), 1);
  setRow(table, optimistic as never);
  const q = supabase().from(table);
  const { data, error } = cols
    // membership rows: an existing row (auto-subscription, double join…) counts as success
    ? await q.upsert(payload, { onConflict: cols.join(","), ignoreDuplicates: true }).select().maybeSingle()
    : await q.insert(payload).select().single();
  if (gen !== bootGen) return (data as Row<T> | null) ?? null;
  bump(table, key, -1);
  count(pendingInserts, pkey(table, key), -1);
  if (error) {
    if (!isPending(table, key)) {
      if (prev) setRow(table, prev as never); else deleteRows(table, [key]);
    }
    settle(table, key);
    fail(error, what);
    return null;
  }
  if (!data) {
    // the natural key already existed on the server: load it (with its opaque id) and keep it
    const { data: existing } = await matchPk(supabase().from(table).select("*"), table, payload).maybeSingle();
    const row = (existing as AnyRow | null) ?? prev ?? optimistic;
    if (gen === bootGen) resolve(table, key, row);
    return row as unknown as Row<T>;
  }
  resolve(table, key, data as AnyRow);
  return data as Row<T>;
}

/** Patch a row optimistically. Returns false on failure (patched fields reverted + toasted). */
export async function update<T extends TableName>(table: T, key: string, patch: Partial<Row<T>>, what = "Couldn't update"): Promise<boolean> {
  const gen = bootGen;
  const before = table$(table)[key];
  if (!before) return false;
  // updated_at stays the server's: a client-clock stamp would break the realtime staleness guard
  const local = { ...before, ...(patch as AnyRow) };
  const fields = Object.keys(patch);
  bump(table, key, 1);
  setRow(table, local as never);
  const q = matchPk(supabase().from(table).update(patch as never) as QB, table, before);
  const { data, error } = await q.select().maybeSingle();
  if (gen !== bootGen) return !error && Boolean(data);
  bump(table, key, -1);
  if (error) {
    revertFields(table, key, fields, before);
    settle(table, key);
    fail(error, what);
    return false;
  }
  if (!data) {
    // no row matched: it was deleted, or RLS no longer lets us write it
    const exists = Boolean(table$(table)[key]);
    if (exists) revertFields(table, key, fields, before);
    settle(table, key);
    toast.error(`${what}: ${exists ? "it was deleted or you don't have access to it." : "this item was deleted."}`);
    return false;
  }
  resolve(table, key, data as AnyRow);
  return true;
}

/** Patch many rows of the same table with one request (bulk actions). */
export async function updateMany<T extends TableName>(table: T, keys: string[], patch: Partial<Row<T>>, what = "Couldn't update"): Promise<boolean> {
  if (COMPOSITE[table]) throw new Error("updateMany needs an id-keyed table");
  const gen = bootGen;
  const befores = keys.map((k) => table$(table)[k]).filter(Boolean) as AnyRow[];
  if (!befores.length) return false;
  const ids = befores.map((b) => pkOf(table, b));
  const fields = Object.keys(patch);
  ids.forEach((k) => bump(table, k, 1));
  setRows(table, befores.map((b) => ({ ...b, ...(patch as AnyRow) })) as never);
  const { data, error } = await supabase().from(table).update(patch as never).in("id", ids).select();
  if (gen !== bootGen) return !error;
  ids.forEach((k) => bump(table, k, -1));
  if (error) {
    befores.forEach((b, i) => revertFields(table, ids[i], fields, b));
    ids.forEach((k) => settle(table, k));
    fail(error, what);
    return false;
  }
  const returned = new Map(((data ?? []) as AnyRow[]).map((r) => [pkOf(table, r), r]));
  let missing = 0;
  befores.forEach((b, i) => {
    const k = ids[i];
    const row = returned.get(k);
    if (row) { resolve(table, k, row); return; }
    // not updated: deleted meanwhile, or RLS refused this row
    if (table$(table)[k]) { revertFields(table, k, fields, b); missing++; }
    settle(table, k);
  });
  if (missing) {
    toast.error(`${what}: ${missing === 1 ? "one item was" : `${missing} items were`} deleted or you don't have access.`);
    return false;
  }
  return true;
}

/** After a DELETE that returned nothing: does the row still exist (RLS refused) or was it already gone? */
async function stillExists(table: TableName, row: AnyRow): Promise<boolean> {
  const { data } = await matchPk(supabase().from(table).select(keyCols(table).join(",")), table, row).maybeSingle();
  return Boolean(data);
}

/** Delete a row optimistically. Returns false on failure (row restored + toasted). */
export async function remove<T extends TableName>(table: T, key: string, what = "Couldn't delete"): Promise<boolean> {
  const gen = bootGen;
  const before = table$(table)[key];
  if (!before) return false;
  bump(table, key, 1);
  deleteRows(table, [key]);
  const { data, error } = await matchPk(supabase().from(table).delete() as QB, table, before).select(keyCols(table).join(","));
  let refused = false;
  if (!error && !(data as AnyRow[] | null)?.length) refused = await stillExists(table, before);
  if (gen !== bootGen) return !error && !refused;
  bump(table, key, -1);
  if (error || refused) {
    if (!isPending(table, key)) restoreRows(table, [before]);
    settle(table, key);
    if (error) fail(error, what);
    else toast.error(`${what}: You don't have permission to do that.`);
    return false;
  }
  forget(table, key);
  return true;
}

export async function removeMany<T extends TableName>(table: T, keys: string[], what = "Couldn't delete"): Promise<boolean> {
  if (COMPOSITE[table]) throw new Error("removeMany needs an id-keyed table");
  const gen = bootGen;
  const befores = keys.map((k) => table$(table)[k]).filter(Boolean) as AnyRow[];
  if (!befores.length) return false;
  const ids = befores.map((b) => pkOf(table, b));
  ids.forEach((k) => bump(table, k, 1));
  deleteRows(table, ids);
  const { data, error } = await supabase().from(table).delete().in("id", ids).select("id");
  let refused: string[] = [];
  if (!error) {
    const gone = new Set(((data ?? []) as AnyRow[]).map((r) => String(r.id)));
    const missing = ids.filter((k) => !gone.has(k));
    if (missing.length) {
      const { data: still } = await supabase().from(table).select("id").in("id", missing);
      refused = ((still ?? []) as AnyRow[]).map((r) => String(r.id));
    }
  }
  if (gen !== bootGen) return !error && !refused.length;
  ids.forEach((k) => bump(table, k, -1));
  if (error) {
    restoreRows(table, befores.filter((b, i) => !isPending(table, ids[i])));
    ids.forEach((k) => settle(table, k));
    fail(error, what);
    return false;
  }
  const blocked = new Set(refused);
  ids.forEach((k) => (blocked.has(k) ? undefined : forget(table, k)));
  if (blocked.size) {
    restoreRows(table, befores.filter((b, i) => blocked.has(ids[i]) && !isPending(table, ids[i])));
    refused.forEach((k) => settle(table, k));
    toast.error(`${what}: You don't have permission to do that.`);
    return false;
  }
  return true;
}

/* ─── deferred deletes (undo without a lossy re-insert) ─── */

interface Deferred {
  table: TableName;
  keys: string[];
  befores: AnyRow[];
  what: string;
  gen: number;
  storeKey: string;
  timer: ReturnType<typeof setTimeout> | null;
  done: boolean;
  onCommitted?: () => void;
}
const deferred = new Set<Deferred>();
const committing = new Set<Deferred>();
const DEFERRABLE = new Set<TableName>(["issues"]);
const deferKey = () => `locus:pending-deletes:${S().userId}:${S().workspaceId}`;

/** Remember deletes that have not reached the server yet, so a closed tab still completes them next time. */
function persistDeferred(storeKey: string) {
  try {
    const list = [...deferred, ...committing].filter((d) => d.storeKey === storeKey).map((d) => ({ table: d.table, keys: d.keys }));
    if (list.length) window.localStorage.setItem(storeKey, JSON.stringify(list));
    else window.localStorage.removeItem(storeKey);
  } catch { /* storage unavailable */ }
}

async function commitDeferred(d: Deferred): Promise<void> {
  if (d.done) return;
  d.done = true;
  if (d.timer) clearTimeout(d.timer);
  deferred.delete(d);
  committing.add(d);
  let error: unknown = null;
  try {
    ({ error } = await supabase().from(d.table).delete().in("id", d.keys));
  } catch (e) {
    error = e;
  }
  committing.delete(d);
  persistDeferred(d.storeKey);
  if (d.gen !== bootGen) return;
  d.keys.forEach((k) => bump(d.table, k, -1));
  if (error) {
    restoreRows(d.table, d.befores);
    d.keys.forEach((k) => settle(d.table, k));
    fail(error, d.what);
    return;
  }
  d.keys.forEach((k) => forget(d.table, k));
  d.onCommitted?.();
}

function undoDeferred(d: Deferred): boolean {
  if (d.done) return false;
  d.done = true;
  if (d.timer) clearTimeout(d.timer);
  deferred.delete(d);
  persistDeferred(d.storeKey);
  if (d.gen !== bootGen) return false;
  d.keys.forEach((k) => bump(d.table, k, -1));
  // the exact original rows come back (no server write), then anything that changed remotely meanwhile
  restoreRows(d.table, d.befores);
  d.keys.forEach((k) => settle(d.table, k));
  return true;
}

/** Send every deferred delete now (page hide, sign-out, workspace switch). */
function commitAllDeferred(): Promise<void> {
  return Promise.all(Array.from(deferred).map(commitDeferred)).then(() => undefined);
}

/**
 * Remove rows locally now and on the server after `delayMs`, unless undone first.
 * Remote changes to the rows while they are hidden are stashed and re-applied on undo.
 */
export function deferRemove<T extends TableName>(
  table: T, keys: string[], delayMs: number,
  opts: { what?: string; onCommitted?: () => void } = {},
): { undo: () => boolean; commit: () => Promise<void> } | null {
  if (!DEFERRABLE.has(table)) throw new Error(`deferRemove is not enabled for ${table}`);
  const befores = keys.map((k) => table$(table)[k]).filter(Boolean) as AnyRow[];
  if (!befores.length) return null;
  const ids = befores.map((b) => pkOf(table, b));
  ids.forEach((k) => bump(table, k, 1));
  deleteRows(table, ids);
  const d: Deferred = {
    table, keys: ids, befores, what: opts.what ?? "Couldn't delete", gen: bootGen, storeKey: deferKey(),
    timer: null, done: false, onCommitted: opts.onCommitted,
  };
  deferred.add(d);
  persistDeferred(d.storeKey);
  d.timer = setTimeout(() => { void commitDeferred(d); }, delayMs);
  return { undo: () => undoDeferred(d), commit: () => commitDeferred(d) };
}

/** Deletes a previous page accepted but may not have sent (closed mid-request). */
function commitStoredDeletes(gen: number) {
  const storeKey = deferKey();
  let list: { table: TableName; keys: string[] }[] = [];
  try { list = JSON.parse(window.localStorage.getItem(storeKey) || "[]"); } catch { return; }
  // never this page's own deletes: those still in their undo window, or already being sent
  const own = new Set([...deferred, ...committing].flatMap((d) => d.keys));
  const todo = (Array.isArray(list) ? list : [])
    .filter((x) => x && DEFERRABLE.has(x.table) && Array.isArray(x.keys))
    .map((x) => ({ table: x.table, keys: x.keys.filter((k) => typeof k === "string" && !own.has(k)) }))
    .filter((x) => x.keys.length);
  if (!todo.length) return;
  Promise.all(todo.map(async (x) => {
    const { error } = await supabase().from(x.table).delete().in("id", x.keys);
    if (error) throw error;
    if (gen === bootGen) deleteRows(x.table, x.keys);
  })).then(() => persistDeferred(storeKey), () => { /* keep them for the next start */ });
}

/** Call a Postgres function. Resolves with data, or null on failure (toasted). */
export async function rpc<R = unknown>(fn: string, args: Record<string, unknown>, what = "Something went wrong"): Promise<R | null> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) {
    fail(error, what);
    return null;
  }
  return data as R;
}

/** Merge rows fetched out-of-band (e.g. after an RPC) into the store. */
export const mergeRows = setRows;
export const dropRows = deleteRows;

/* ─── snapshot ─── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QB = any;

async function fetchAll<T extends TableName>(table: T, scope: (q: QB) => QB = (q) => q): Promise<Row<T>[]> {
  const PAGE = 1000;
  const rows: Row<T>[] = [];
  for (let from = 0; ; from += PAGE) {
    // created_at alone is not unique (rows written in one transaction share it): add the key for a total order
    let q = scope(supabase().from(table).select("*")).order("created_at", { ascending: true });
    for (const c of keyCols(table)) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Row<T>[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const toRec = <T extends TableName>(table: T, rows: Row<T>[]) => {
  const r: Rec<Row<T>> = {};
  for (const row of rows) r[pkOf(table, row as unknown as AnyRow)] = row;
  return r;
};

const CACHE_VERSION = 3;
const cacheKey = () => `locus:v${CACHE_VERSION}:${S().userId}:${S().workspaceId}`;
const CACHED_TABLES: TableName[] = [
  "profiles", "workspaces", "workspace_members", "workspace_invites", "teams", "team_members", "workflow_states",
  "labels", "projects", "project_milestones", "project_updates", "cycles", "issues", "issue_relations",
  "issue_subscribers", "notifications", "favorites", "views",
];

let refreshSeq = 0;
let appliedRefresh = 0;

async function refresh(gen = bootGen): Promise<void> {
  const seq = ++refreshSeq;
  const ws = S().workspaceId;
  const me = S().userId;
  const isResync = S().lastSyncedAt > 0;
  const byWs = (q: QB) => q.eq("workspace_id", ws);
  // keys with writes in flight or settling: keep their local state
  const dirty = new Set<string>([...pending.keys(), ...stash.keys()]);
  activeRefreshes.add(dirty);
  try {
    const [
      workspaces, profiles, workspace_members, workspace_invites, teams, team_members, workflow_states, labels,
      projects, project_milestones, project_updates, cycles, issues, issue_relations, issue_subscribers,
      notifications, favorites, views,
    ] = await Promise.all([
      fetchAll("workspaces"),
      fetchAll("profiles"),
      fetchAll("workspace_members", byWs),
      fetchAll("workspace_invites", byWs),
      fetchAll("teams", byWs),
      fetchAll("team_members", byWs),
      fetchAll("workflow_states", byWs),
      fetchAll("labels", byWs),
      fetchAll("projects", byWs),
      fetchAll("project_milestones", byWs),
      fetchAll("project_updates", byWs),
      fetchAll("cycles", byWs),
      fetchAll("issues", byWs),
      fetchAll("issue_relations", byWs),
      fetchAll("issue_subscribers", (q) => q.eq("workspace_id", ws).eq("user_id", me)),
      fetchAll("notifications", (q) => q.eq("workspace_id", ws).is("archived_at", null)),
      fetchAll("favorites", byWs),
      fetchAll("views", byWs),
    ]);

    // superseded (teardown, workspace switch, or a newer snapshot already applied)
    if (gen !== bootGen || S().workspaceId !== ws || seq < appliedRefresh) return;
    appliedRefresh = seq;

    const fresh: Partial<Entities> = {
      workspaces: toRec("workspaces", workspaces), profiles: toRec("profiles", profiles),
      workspace_members: toRec("workspace_members", workspace_members), workspace_invites: toRec("workspace_invites", workspace_invites),
      teams: toRec("teams", teams), team_members: toRec("team_members", team_members),
      workflow_states: toRec("workflow_states", workflow_states), labels: toRec("labels", labels),
      projects: toRec("projects", projects), project_milestones: toRec("project_milestones", project_milestones),
      project_updates: toRec("project_updates", project_updates), cycles: toRec("cycles", cycles),
      issues: toRec("issues", issues), issue_relations: toRec("issue_relations", issue_relations),
      notifications: toRec("notifications", notifications), favorites: toRec("favorites", favorites),
      views: toRec("views", views),
    };
    // Subscribers: keep other users' rows already loaded for open issues; replace mine.
    const subs = { ...S().issue_subscribers };
    for (const k of Object.keys(subs)) if (k.endsWith(`:${me}`)) delete subs[k];
    Object.assign(subs, toRec("issue_subscribers", issue_subscribers));
    fresh.issue_subscribers = subs;

    // Rows written locally since the snapshot started keep their local state — including being deleted.
    const local = S();
    for (const pk of dirty) {
      const i = pk.indexOf(":");
      const t = pk.slice(0, i) as TableName;
      const k = pk.slice(i + 1);
      const rec = fresh[t] as Rec<unknown> | undefined;
      if (!rec) continue;
      const mine = (local[t] as Rec<unknown>)[k];
      if (mine !== undefined) rec[k] = mine; else delete rec[k];
    }

    useSync.setState({ ...fresh, status: "ready", error: null, lastSyncedAt: Date.now() } as Partial<SyncState>);
  } finally {
    activeRefreshes.delete(dirty);
  }
  // after a gap, open issue pages need their comments / history / reactions again
  if (isResync && gen === bootGen) reloadIssueDetails();
}

/* ─── realtime + lifecycle state ─── */

let channel: RealtimeChannel | null = null;
let live = false;
let wasOffline = false;
/** a snapshot was taken while the channel was not live: take another once it is */
let snapshotStale = false;
let onLive: (() => void) | null = null;
let buffering = 0;
let hiddenAt = 0;
let unsubscribeSave: (() => void) | null = null;
let authSub: { unsubscribe(): void } | null = null;
let signedOut = false;
let leavingWorkspace = false;

/** Call before the current user deliberately leaves or deletes the workspace (false if the request fails). */
export function expectWorkspaceExit(on = true) { leavingWorkspace = on; }

/** Snapshot with realtime buffered: events received meanwhile are replayed on top of it. */
async function resync(gen = bootGen): Promise<void> {
  buffering++;
  if (!live) snapshotStale = true;
  try {
    await refresh(gen);
  } finally {
    if (gen === bootGen) { // teardown() already reset the counter for a superseded session
      buffering = Math.max(0, buffering - 1);
      if (!buffering && queue.length) scheduleFlush();
    }
  }
}

export async function bootstrap(opts: { workspace: Workspace; profile: Profile }) {
  teardown();
  const gen = bootGen; // captured after teardown() bumped it
  pending.clear();
  pendingInserts.clear();
  stash.clear();
  loadingIssues.clear();
  signedOut = false;
  leavingWorkspace = false;
  useSync.setState({
    ...EMPTY_ENTITIES(),
    workspaces: { [opts.workspace.id]: opts.workspace },
    profiles: { [opts.profile.id]: opts.profile },
    status: "loading",
    error: null,
    connection: "connecting",
    userId: opts.profile.id,
    workspaceId: opts.workspace.id,
    loadedIssues: {},
    lastSyncedAt: 0,
  });

  // another tab signed out (auth-js broadcasts it): leave the workspace on this one too
  authSub = supabase().auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_OUT" || signedOut) return;
    signedOut = true;
    setTimeout(() => { // outside auth-js's notify loop
      const next = window.location.pathname + window.location.search;
      teardown();
      pending.clear();
      pendingInserts.clear();
      stash.clear();
      useSync.setState({ ...EMPTY_ENTITIES(), status: "idle", error: null, userId: "", workspaceId: "", loadedIssues: {}, lastSyncedAt: 0 });
      void clearLocalCache().finally(() => window.location.replace(`/login?next=${encodeURIComponent(next)}`));
    }, 0);
  }).data.subscription;

  // 1 · instant start from the local snapshot (the server's workspace row beats a cached one: slug/name may have changed)
  try {
    const cached = (await idbGet(cacheKey())) as Partial<Entities> | undefined;
    if (gen !== bootGen) return;
    if (cached && S().workspaceId === opts.workspace.id) {
      useSync.setState({
        ...cached,
        workspaces: { ...(cached.workspaces ?? {}), [opts.workspace.id]: opts.workspace },
        status: "ready",
      } as Partial<SyncState>);
    }
  } catch { /* storage unavailable (private mode) — fine */ }
  if (gen !== bootGen || signedOut) return;
  void purgeOldSnapshots();

  // 2 · join the channel first (events buffer), then take the authoritative snapshot
  const liveSoon = new Promise<void>((r) => { onLive = r; });
  connect();
  await Promise.race([liveSoon, new Promise<void>((r) => setTimeout(r, 3000))]);
  if (gen !== bootGen || signedOut) return;
  try {
    await resync(gen);
  } catch (e) {
    if (gen !== bootGen) return;
    console.error("[locus] bootstrap", e);
    if (S().status !== "ready") useSync.setState({ status: "error", error: friendlyError(e) });
    else toast.error("Couldn't sync — showing your last saved data.");
  }
  if (gen !== bootGen || signedOut) return;

  // 3 · persistence + lifecycle
  unsubscribeSave = useSync.subscribe(onStoreChange);
  if (S().status === "ready") scheduleSave();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);
  commitStoredDeletes(gen);
}

export function teardown() {
  bootGen++; // invalidates every in-flight bootstrap, snapshot, mutation and lazy load
  void commitAllDeferred();
  if (channel) { const ch = channel; channel = null; void supabase().removeChannel(ch); }
  live = false;
  wasOffline = false;
  snapshotStale = false;
  onLive = null;
  queue = [];
  flushScheduled = false;
  buffering = 0;
  hiddenAt = 0;
  unsubscribeSave?.();
  unsubscribeSave = null;
  cancelSave();
  authSub?.unsubscribe();
  authSub = null;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  if (typeof window !== "undefined") {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pagehide", onPageHide);
  }
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    void commitAllDeferred(); // mobile browsers may kill a hidden tab
    flushSave();
    return;
  }
  if (hiddenAt && Date.now() - hiddenAt > 60_000) resync().catch(() => {});
  hiddenAt = 0;
}
function onOnline() { resync().catch(() => {}); }
function onPageHide() {
  void commitAllDeferred();
  flushSave();
}

/* ─── IndexedDB snapshot ─── */

const SAVE_DEBOUNCE = 1200;
const SAVE_MAX_WAIT = 10_000;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveDeadline = 0; // 0 = nothing unsaved
let idleHandle: number | null = null;

/** Only changes to cached tables need a new snapshot (not connection / lazy tables / loadedIssues). */
function onStoreChange(s: SyncState, prev: SyncState) {
  if (s.workspaceId !== prev.workspaceId) return;
  if (!CACHED_TABLES.some((t) => s[t] !== prev[t])) return;
  scheduleSave();
}

/** Debounced, but never postponed past SAVE_MAX_WAIT under steady realtime traffic. */
function scheduleSave() {
  const now = Date.now();
  if (!saveDeadline) saveDeadline = now + SAVE_MAX_WAIT;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(queueSnapshot, Math.max(0, Math.min(SAVE_DEBOUNCE, saveDeadline - now)));
}

function writeSnapshot() {
  idleHandle = null;
  saveDeadline = 0;
  const s = S();
  if (signedOut || s.status !== "ready" || !s.workspaceId) return;
  const snap: Partial<Entities> = {};
  for (const t of CACHED_TABLES) (snap as unknown as Record<string, unknown>)[t] = s[t];
  idbSet(cacheKey(), snap).catch(() => {});
}

/** The structured clone is main-thread work: do it when the page is idle. */
function queueSnapshot() {
  saveTimer = null;
  if (idleHandle != null) return;
  if (typeof window !== "undefined" && "requestIdleCallback" in window) idleHandle = window.requestIdleCallback(writeSnapshot, { timeout: 2000 });
  else writeSnapshot();
}

/** Write a pending snapshot right away (page is going away). */
function flushSave() {
  if (!saveDeadline) return;
  cancelSave();
  writeSnapshot();
}

function cancelSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (idleHandle != null && typeof window !== "undefined" && "cancelIdleCallback" in window) window.cancelIdleCallback(idleHandle);
  idleHandle = null;
  saveDeadline = 0;
}

async function purgeOldSnapshots() {
  try {
    const all = await idbKeys();
    await Promise.all(all
      .filter((k) => { const m = /^locus:v(\d+):/.exec(String(k)); return !!m && Number(m[1]) !== CACHE_VERSION; })
      .map((k) => idbDel(k)));
  } catch { /* ignore */ }
}

/** Drop everything this browser keeps for the signed-in user (snapshots, drafts, per-viewer prefs). The theme stays. */
export async function clearLocalCache() {
  try {
    const all = await idbKeys();
    await Promise.all(all.filter((k) => String(k).startsWith("locus:")).map((k) => idbDel(k)));
  } catch { /* ignore */ }
  if (typeof window === "undefined") return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      for (let i = store.length - 1; i >= 0; i--) {
        const k = store.key(i);
        if (k && k.startsWith("locus:") && k !== "locus:theme") store.removeItem(k);
      }
    } catch { /* storage unavailable */ }
  }
}

/* ─── realtime ─── */

type Change = { table: TableName; type: "INSERT" | "UPDATE" | "DELETE"; row: AnyRow; old: AnyRow };
let queue: Change[] = [];
let flushScheduled = false;

function scheduleFlush() {
  if (flushScheduled || buffering) return;
  flushScheduled = true;
  setTimeout(flush, 24); // coalesce bursts (bulk edits) into one render
}

function connect() {
  const ws = S().workspaceId;
  useSync.setState({ connection: "connecting" });
  live = false;
  const ch = supabase().channel(`locus:${ws}:${uuid().slice(0, 8)}`, {
    // report SUBSCRIBED only once postgres_changes is actually streaming
    config: { postgres_changes_options: { wait: true } },
  });
  channel = ch;
  ch.on("postgres_changes", { event: "*", schema: "public" }, (p) => {
    if (ch !== channel) return;
    queue.push({
      table: p.table as TableName,
      type: p.eventType as Change["type"],
      row: (p.new ?? {}) as AnyRow,
      old: (p.old ?? {}) as AnyRow,
    });
    scheduleFlush();
  }).subscribe((status) => {
    if (ch !== channel) return; // a removed channel's CLOSED must not flip state
    if (status === "SUBSCRIBED") {
      live = true;
      useSync.setState({ connection: "live" });
      const resolveLive = onLive;
      onLive = null;
      resolveLive?.();
      if (wasOffline || snapshotStale) {
        wasOffline = false;
        snapshotStale = false;
        resync().catch(() => {});
      }
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      live = false;
      useSync.setState({ connection: "offline" });
      wasOffline = true;
      // don't hold the first snapshot hostage: take it now, and again once the channel is live
      const resolveLive = onLive;
      onLive = null;
      resolveLive?.();
    }
  });
}

type Op = { row: AnyRow; replace: boolean } | null;

function flush() {
  flushScheduled = false;
  if (buffering) return; // a snapshot is in flight: replay on top of it
  const changes = queue;
  queue = [];
  if (!changes.length) return;
  const s = S();
  const ws = s.workspaceId;
  const ops = new Map<TableName, Map<string, Op>>();
  const opsOf = (t: TableName) => { let m = ops.get(t); if (!m) { m = new Map(); ops.set(t, m); } return m; };
  const byId = new Map<TableName, Map<string, AnyRow>>();
  const localById = (t: TableName, id: string) => {
    let m = byId.get(t);
    if (!m) {
      m = new Map();
      for (const r of Object.values(s[t] as unknown as Rec<AnyRow>)) if (r.id != null) m.set(String(r.id), r);
      byId.set(t, m);
    }
    const hit = m.get(id);
    if (hit) return hit;
    for (const op of ops.get(t)?.values() ?? []) if (op && String(op.row.id) === id) return op.row; // inserted earlier in this batch
    return undefined;
  };
  let kicked = false;

  for (const c of changes) {
    if (!(c.table in s)) continue;

    if (c.type === "DELETE") {
      let key: string;
      let userId: unknown = c.old.user_id;
      if (keyCols(c.table).every((col) => c.old[col] != null)) {
        if (c.table === "workspace_members" && c.old.workspace_id !== ws) continue;
        key = pkOf(c.table, c.old);
      } else if (COMPOSITE[c.table] && c.old.id != null) {
        // opaque key (only the id is sent): resolve through the local row; unknown ids belong to other tenants
        const local = localById(c.table, String(c.old.id));
        if (!local) continue;
        key = pkOf(c.table, local);
        userId = local.user_id;
      } else continue;
      // late echo of an earlier delete while the same key is being re-created
      if (pendingInserts.has(pkey(c.table, key))) continue;
      if (c.table === "workspace_members" && userId === s.userId && !leavingWorkspace) kicked = true;
      if (isPending(c.table, key)) stashOf(c.table, key).event = { kind: "delete" };
      if (LAZY.has(c.table)) for (const b of loadingIssues.values()) b.events.push(c);
      opsOf(c.table).set(key, null);
      continue;
    }

    const row = c.row;
    if (c.table === "workspaces") {
      if (!(row.id === ws || s.workspace_members[s.userId])) continue;
    } else {
      if (!NOT_WS_SCOPED.has(c.table) && row.workspace_id !== ws) continue;
      if (c.table === "notifications" && row.user_id !== s.userId) continue;
    }
    if (LAZY.has(c.table)) {
      const issueId = row.issue_id != null ? String(row.issue_id) : null;
      if (issueId) {
        const b = loadingIssues.get(issueId);
        if (b) { b.events.push(c); continue; } // replayed once that issue's snapshot lands
        if (!s.loadedIssues[issueId]) continue;
      } else {
        for (const b of loadingIssues.values()) b.events.push(c); // reactions: re-applied after any in-flight snapshot
      }
    }
    const key = pkOf(c.table, row);
    if (isPending(c.table, key)) {
      const e = stashOf(c.table, key);
      e.event = { kind: "row", row: e.event?.kind === "row" ? { ...e.event.row, ...row } : row };
      continue;
    }
    const tops = opsOf(c.table);
    const prevOp = tops.get(key);
    const base = prevOp === undefined ? (s[c.table] as unknown as Rec<AnyRow>)[key] : prevOp?.row;
    // a late echo of an older write must not overwrite a newer row
    if (HAS_UPDATED_AT.has(c.table) && base && older(row.updated_at, base.updated_at)) continue;
    if (!base && c.type === "UPDATE" && WIDE.has(c.table)) {
      // unknown row and possibly partial payload: fetch the whole row instead
      void fetchRow(c.table, row);
      continue;
    }
    if (prevOp) tops.set(key, { row: { ...prevOp.row, ...row }, replace: prevOp.replace });
    else tops.set(key, { row, replace: c.type === "INSERT" || prevOp === null });
    if (c.table === "workspace_members" && !s.profiles[String(row.user_id)]) void fetchProfile(String(row.user_id));
  }

  for (const [t, m] of ops) {
    const del: string[] = [];
    const replace: AnyRow[] = [];
    const patch: AnyRow[] = [];
    for (const [k, op] of m) {
      if (op === null) del.push(k);
      else (op.replace ? replace : patch).push(op.row);
    }
    deleteRows(t, del);
    setRows(t, replace as never);
    patchRows(t, patch);
  }
  if (kicked) {
    toast.error("You were removed from this workspace.");
    setTimeout(() => window.location.assign("/"), 1200);
  }
}

async function fetchRow(table: TableName, row: AnyRow) {
  const gen = bootGen;
  const { data } = await matchPk(supabase().from(table).select("*"), table, row).maybeSingle();
  if (data && gen === bootGen && !isPending(table, pkOf(table, data as AnyRow))) setRow(table, data as never);
}

async function fetchProfile(id: string) {
  const gen = bootGen;
  const { data } = await supabase().from("profiles").select("*").eq("id", id).maybeSingle();
  if (data && gen === bootGen) setRow("profiles", data as Profile);
}

/* ─── lazy loads (comments / history / subscribers / reactions per issue) ─── */

/** issues whose details are being fetched; their realtime events are buffered and replayed after */
const loadingIssues = new Map<string, { refs: number; events: Change[] }>();
/** issue detail views currently mounted (see watchIssueDetails) */
const watchedIssues = new Map<string, number>();
/** most recently opened issues: refreshed after a gap even when the view did not register as watched */
let recentIssues: string[] = [];

/**
 * Load an issue's details and keep them fresh while the caller is mounted: after a
 * reconnect / long background they are refetched. Returns the cleanup function.
 */
export function watchIssueDetails(issueId: string): () => void {
  watchedIssues.set(issueId, (watchedIssues.get(issueId) ?? 0) + 1);
  void loadIssueDetails(issueId);
  return () => {
    const n = (watchedIssues.get(issueId) ?? 1) - 1;
    if (n > 0) watchedIssues.set(issueId, n); else watchedIssues.delete(issueId);
  };
}

function reloadIssueDetails() {
  const s = S();
  for (const id of new Set([...watchedIssues.keys(), ...recentIssues])) {
    if (s.loadedIssues[id] && s.issues[id]) void loadIssueDetails(id);
  }
}

/**
 * Replace this issue's lazy rows with a fresh fetch. Rows with writes in flight, and rows written
 * locally (or by realtime) since the fetch started, keep their local state.
 */
function replaceIssueDetails(
  issueId: string,
  fetched: { comments: AnyRow[]; issue_history: AnyRow[]; issue_subscribers: AnyRow[]; reactions: AnyRow[] },
  dirty: Set<string>,
) {
  const keep = (t: TableName, k: string) => isPending(t, k) || stash.has(pkey(t, k)) || dirty.has(pkey(t, k));
  const s = S();
  const commentIds = new Set<string>(fetched.comments.map((c) => String(c.id)));
  for (const c of Object.values(s.comments)) if (c.issue_id === issueId) commentIds.add(c.id);
  const belongs: Record<"comments" | "issue_history" | "issue_subscribers" | "reactions", (r: AnyRow) => boolean> = {
    comments: (r) => r.issue_id === issueId,
    issue_history: (r) => r.issue_id === issueId,
    issue_subscribers: (r) => r.issue_id === issueId,
    reactions: (r) => commentIds.has(String(r.comment_id)),
  };
  const patch: Partial<SyncState> = {};
  for (const t of Object.keys(belongs) as (keyof typeof belongs)[]) {
    const rec = { ...(s[t] as unknown as Rec<AnyRow>) };
    const incoming = new Map(fetched[t].map((r) => [pkOf(t, r), r]));
    const dropped: string[] = [];
    for (const [k, r] of Object.entries(rec)) {
      if (belongs[t](r) && !incoming.has(k) && !keep(t, k)) { delete rec[k]; dropped.push(k); }
    }
    for (const [k, r] of incoming) if (!keep(t, k)) rec[k] = r;
    touch(t, [...incoming.keys(), ...dropped]);
    (patch as Record<string, unknown>)[t] = rec;
  }
  useSync.setState({ ...patch, loadedIssues: { ...s.loadedIssues, [issueId]: true } });
}

export async function loadIssueDetails(issueId: string) {
  const gen = bootGen;
  recentIssues = [issueId, ...recentIssues.filter((x) => x !== issueId)].slice(0, 3);
  const buf = loadingIssues.get(issueId);
  if (buf) buf.refs++; else loadingIssues.set(issueId, { refs: 1, events: [] });
  const dirty = new Set<string>();
  activeRefreshes.add(dirty);
  try {
    const [comments, history, subscribers] = await Promise.all([
      fetchAll("comments", (q) => q.eq("issue_id", issueId)),
      fetchAll("issue_history", (q) => q.eq("issue_id", issueId)),
      fetchAll("issue_subscribers", (q) => q.eq("issue_id", issueId)),
    ]);
    const ids = comments.map((c) => c.id);
    const reactions = ids.length ? await fetchAll("reactions", (q) => q.in("comment_id", ids)) : [];
    if (gen !== bootGen) return;
    activeRefreshes.delete(dirty);
    replaceIssueDetails(issueId, {
      comments: comments as unknown as AnyRow[],
      issue_history: history as unknown as AnyRow[],
      issue_subscribers: subscribers as unknown as AnyRow[],
      reactions: reactions as unknown as AnyRow[],
    }, dirty);
  } catch (e) {
    if (gen === bootGen) fail(e, "Couldn't load activity");
  } finally {
    activeRefreshes.delete(dirty);
    const b = loadingIssues.get(issueId);
    if (b && gen === bootGen) {
      b.refs--;
      if (b.refs <= 0) {
        loadingIssues.delete(issueId);
        if (b.events.length) {
          // these arrived before anything still queued: replay them first
          queue = [...b.events, ...queue];
          scheduleFlush();
        }
      }
    }
  }
}

/* ─── sign out ─── */

export async function signOut() {
  signedOut = true;
  // deletes still waiting for their undo window must reach the server while we still have a session
  await Promise.race([commitAllDeferred(), new Promise<void>((r) => setTimeout(r, 2000))]);
  teardown();
  await clearLocalCache();
  let ok = false;
  try {
    // this device only: "Log out" must not end the user's sessions elsewhere
    ok = !(await supabase().auth.signOut({ scope: "local" })).error;
  } catch { /* fall back to the server route */ }
  if (ok) { window.location.assign("/login"); return; }
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/auth/signout";
  form.hidden = true;
  document.body.appendChild(form);
  form.submit();
}
