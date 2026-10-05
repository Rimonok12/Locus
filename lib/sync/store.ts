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
     on top of it, so nothing committed in between is ever missed. Only the
     newest snapshot holds the buffer, and snapshot requests time out.
   • Rows written locally while a snapshot is in flight keep their local state
     (including being deleted) — the snapshot only fills in everything else.
   • A write to a row whose INSERT is still in flight waits for that insert; if
     the insert fails, the queued writes give up (the row never existed).
   • While a write to a row is in flight, remote changes to that row are
     stashed and reconciled with the server's response once it settles (newest
     server timestamp wins); remote deletes apply immediately.
   • A failed write puts back the last CONFIRMED value of its fields (the last
     server row seen for the key, plus the writes still in flight), never a
     value that only existed optimistically.
   • A successful delete leaves a short-lived tombstone: responses and realtime
     echoes of writes that started before it can never resurrect the row.
   • Deletes with an undo window are recorded per tab in localStorage until the
     server confirms them; records left by closed tabs (or failed sends) are
     adopted, kept hidden and retried by the next page of the same account.
   • Realtime UPDATE payloads may omit unchanged TOASTed columns, so they are
     merged onto the current row, never replace it.
   • updated_at is only ever compared between server timestamps (Date.parse).
   • Losing access (removed, workspace deleted, another account signed in)
     tears the session down and drops this workspace's local data.
   ──────────────────────────────────────────────────────────────────────────── */

import { create } from "zustand";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getMany as idbGetMany, setMany as idbSetMany, delMany as idbDelMany, keys as idbKeys } from "idb-keyval";
import { supabase } from "@/lib/supabase/client";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { toast } from "@/lib/ui";
import { sanitizeViewRow } from "@/lib/view-shape";
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
const isObject = (v: unknown): v is AnyRow => typeof v === "object" && v !== null && !Array.isArray(v);

/* ─── table metadata ─── */

/** natural keys of membership-style tables (rows are keyed by these locally; the DB key is an opaque id) */
const COMPOSITE: Partial<Record<TableName, readonly string[]>> = {
  workspace_members: ["workspace_id", "user_id"],
  team_members: ["team_id", "user_id"],
  issue_subscribers: ["issue_id", "user_id"],
};
/** unique columns of id-keyed tables: a duplicate insert means "it already exists" (another tab, a double click) */
const UNIQUE: Partial<Record<TableName, readonly string[]>> = {
  favorites: ["user_id", "kind", "target_id"],
  reactions: ["comment_id", "user_id", "emoji"],
  issue_relations: ["issue_id", "related_issue_id", "type"],
};
const HAS_UPDATED_AT = new Set<TableName>([
  "profiles", "workspaces", "teams", "workflow_states", "labels", "projects", "project_milestones",
  "project_updates", "cycles", "issues", "comments", "views",
]);
const NOT_WS_SCOPED = new Set<TableName>(["profiles", "workspaces"]);
const LAZY = new Set<TableName>(["comments", "reactions", "issue_history"]);
/** tables with long text columns: a realtime UPDATE may omit their unchanged (TOASTed) values */
const WIDE = new Set<TableName>(["issues", "projects", "project_updates", "comments", "views"]);
/** rows whose JSON any member can write: normalised before the UI ever sees them */
const FIX: Partial<Record<TableName, (r: AnyRow) => AnyRow>> = { views: sanitizeViewRow };
const fixRow = (t: TableName, r: AnyRow): AnyRow => FIX[t]?.(r) ?? r;

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

/** id lists go in the request URL: keep each request well under the gateway's URL limit */
const CHUNK = 100;
function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
/** Run `fn` over `items` with at most `limit` requests in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/* ─── session generation (bootstrap/teardown) ─── */

/** bumped by teardown(): async work started in an older session must not touch the store */
let bootGen = 0;

/* ─── pending-mutation bookkeeping ─── */

const pkey = (t: TableName, k: string) => `${t}:${k}`;
const splitPkey = (pk: string): [TableName, string] => {
  const i = pk.indexOf(":");
  return [pk.slice(0, i) as TableName, pk.slice(i + 1)];
};

/** every write gets a sequence number; tombstones compare against it */
let writeSeq = 0;
/**
 * Per key with writes in flight: how many, the last server-confirmed row (`base`), and the patches of
 * the updates still in flight (in start order). A failed write restores base + the remaining patches.
 */
interface KeyWrites { n: number; base: AnyRow | undefined; patches: { seq: number; patch: AnyRow }[] }
const writes = new Map<string, KeyWrites>();
const isPending = (t: TableName, k: string) => writes.has(pkey(t, k));

function begin(t: TableName, k: string, patch?: AnyRow): number {
  const pk = pkey(t, k);
  let w = writes.get(pk);
  if (!w) {
    w = { n: 0, base: table$(t)[k], patches: [] };
    writes.set(pk, w);
  }
  w.n++;
  const seq = ++writeSeq;
  if (patch) w.patches.push({ seq, patch });
  return seq;
}

/** What the row will be if every write still in flight succeeds (undefined: never confirmed by the server). */
function expectedOf(w: KeyWrites | undefined): AnyRow | undefined {
  if (!w?.base) return undefined;
  let row = w.base;
  for (const p of w.patches) row = { ...row, ...p.patch };
  return row;
}

/** End one write on a key; on failure, put its fields back to their expected value. */
function finish(t: TableName, k: string, seq: number, revert?: { fields: string[]; fallback: AnyRow }) {
  const pk = pkey(t, k);
  const w = writes.get(pk);
  if (!w) return;
  w.patches = w.patches.filter((p) => p.seq !== seq);
  if (revert) {
    const current = table$(t)[k];
    if (current) {
      const target = expectedOf(w) ?? revert.fallback;
      const next = { ...current };
      for (const f of revert.fields) next[f] = target[f];
      setRow(t, next as never);
    }
  }
  if (--w.n <= 0) writes.delete(pk);
}

/** A newer server version of a key with writes in flight (response or remote change). */
function confirmBase(t: TableName, k: string, row: AnyRow) {
  const w = writes.get(pkey(t, k));
  if (!w) return;
  if (w.base && HAS_UPDATED_AT.has(t) && older(row.updated_at, w.base.updated_at)) return;
  w.base = { ...(w.base ?? {}), ...row };
}

/** The row to put back after a failed delete / an undo (null: it was created locally and never existed). */
function restorable(t: TableName, k: string, before: AnyRow): AnyRow | null {
  const pk = pkey(t, k);
  if (inserting.has(pk)) return before;
  const w = writes.get(pk);
  if (w && !w.base) return null;
  return expectedOf(w) ?? before;
}

/** In-flight inserts: writes to the same key wait for them. `key` is where the row ended up. */
type InsertOutcome = { ok: true; key: string } | { ok: false };
const inserting = new Map<string, Promise<InsertOutcome>>();

/** Keys we deleted successfully a moment ago: older responses / echoes must not bring them back. */
const TOMB_MS = 60_000;
const tombstones = new Map<string, { seq: number; id: unknown; at: number }>();
function tombstone(t: TableName, k: string, row: AnyRow | null | undefined) {
  const now = Date.now();
  if (tombstones.size > 500) for (const [pk, v] of tombstones) if (now - v.at > TOMB_MS) tombstones.delete(pk);
  tombstones.set(pkey(t, k), { seq: writeSeq, id: row?.id, at: now });
}
function tombOf(t: TableName, k: string) {
  const pk = pkey(t, k);
  const v = tombstones.get(pk);
  if (v && Date.now() - v.at > TOMB_MS) {
    tombstones.delete(pk);
    return undefined;
  }
  return v;
}

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
    for (const r of rows) next[pkOf(table, r as unknown as AnyRow)] = fixRow(table, r as unknown as AnyRow) as unknown as Row<T>;
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
      next[k] = fixRow(table, prev ? { ...prev, ...r } : r);
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

/** Restore rows that are no longer in the store (failed delete / undo). */
function restoreRows(table: TableName, rows: AnyRow[]) {
  const rec = table$(table);
  setRows(table, rows.filter((b) => !rec[pkOf(table, b)]) as never);
}

/**
 * Reconcile a key once its last in-flight write has finished: a delete (ours or remote) wins;
 * otherwise the newer (by server updated_at) of the remote change and our response is applied.
 */
function settle(table: TableName, key: string) {
  if (isPending(table, key)) return;
  const pk = pkey(table, key);
  const e = stash.get(pk);
  stash.delete(pk);
  if (tombOf(table, key) || isOwed(table, key)) { deleteRows(table, [key]); return; }
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
function resolve(table: TableName, key: string, response: AnyRow, seq: number) {
  const tomb = tombOf(table, key);
  if (tomb && seq <= tomb.seq) { settle(table, key); return; } // answer to a write that started before our delete
  confirmBase(table, key, response);
  const e = stashOf(table, key);
  if (!e.response || !(HAS_UPDATED_AT.has(table) && older(response.updated_at, e.response.updated_at))) e.response = response;
  settle(table, key);
}

/** Drop stashed remote changes for a key whose row we deleted (it is gone on the server). */
const forget = (table: TableName, key: string) => { stash.delete(pkey(table, key)); };

/* ─── errors ─── */

interface PgError { message?: string; code?: string; details?: string; hint?: string }

/** tables where a unique violation is about a user-chosen name / URL */
const NAMED = new Set<TableName>(["teams", "workspaces", "labels"]);

export function friendlyError(e: unknown, table?: TableName): string {
  const err = (e ?? {}) as PgError;
  const msg = err.message ?? String(e);
  if (/fetch|network|Failed to fetch|NetworkError|AbortError/i.test(msg)) return "You're offline — the change wasn't saved.";
  if (err.code === "23505") {
    if (table && NAMED.has(table)) return /slug/i.test(msg) ? "That URL is already taken." : "That name is already taken.";
    return "That already exists.";
  }
  if (err.code === "42501" || /row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (err.code === "23514") return msg.includes("reserved") ? "That URL is reserved." : /too long/i.test(msg) ? msg : "Some values aren't valid.";
  if (err.code === "P0001" || err.code === "P0002") return msg;
  return msg.length < 140 ? msg : "Something went wrong — please try again.";
}

function fail(e: unknown, what: string, table?: TableName) {
  console.error(`[locus] ${what}`, e);
  toast.error(`${what}: ${friendlyError(e, table)}`);
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
  const pk = pkey(table, key);
  // a real row may already be stored under a natural key (e.g. created by a trigger)
  const prev = table$(table)[key];
  tombstones.delete(pk); // a natural key re-created after a delete is live again
  const seq = begin(table, key);
  let outcome: InsertOutcome = { ok: false };
  let report: (o: InsertOutcome) => void = () => {};
  const mine = new Promise<InsertOutcome>((r) => { report = r; });
  inserting.set(pk, mine);
  setRow(table, optimistic as never);
  try {
    const q = supabase().from(table);
    const { data, error } = cols
      // membership rows: an existing row (auto-subscription, double join…) counts as success
      ? await q.upsert(payload, { onConflict: cols.join(","), ignoreDuplicates: true }).select().maybeSingle()
      : await q.insert(payload).select().single();
    if (gen !== bootGen) return (data as Row<T> | null) ?? null;
    if (error) {
      const uniq = UNIQUE[table];
      if (error.code === "23505" && uniq) {
        // it already exists (starred in another tab, a double click): keep the server's row
        const { data: existing } = await uniq
          .reduce((acc: QB, c) => acc.eq(c, payload[c]), supabase().from(table).select("*") as QB)
          .maybeSingle();
        if (gen !== bootGen) return (existing as Row<T> | null) ?? null;
        if (existing) {
          const realKey = pkOf(table, existing as AnyRow);
          finish(table, key, seq);
          if (realKey !== key) {
            deleteRows(table, [key]);
            stash.delete(pk);
          }
          resolve(table, realKey, existing as AnyRow, seq);
          outcome = { ok: true, key: realKey };
          return existing as Row<T>;
        }
      }
      finish(table, key, seq);
      // writes queued behind this insert give up; put back whatever was stored under the key before
      if (prev) setRow(table, prev as never); else deleteRows(table, [key]);
      settle(table, key);
      fail(error, what, table);
      return null;
    }
    if (!data) {
      // the natural key already existed on the server: load it (with its opaque id) and keep it
      const { data: existing } = await matchPk(supabase().from(table).select("*"), table, payload).maybeSingle();
      const row = (existing as AnyRow | null) ?? prev ?? optimistic;
      if (gen !== bootGen) return row as unknown as Row<T>;
      finish(table, key, seq);
      resolve(table, key, row, seq);
      outcome = { ok: true, key };
      return row as unknown as Row<T>;
    }
    finish(table, key, seq);
    resolve(table, key, data as AnyRow, seq);
    outcome = { ok: true, key };
    return data as Row<T>;
  } finally {
    if (inserting.get(pk) === mine) inserting.delete(pk);
    report(outcome);
  }
}

/** Patch a row optimistically. Returns false on failure (patched fields reverted + toasted). */
export async function update<T extends TableName>(table: T, key: string, patch: Partial<Row<T>>, what = "Couldn't update"): Promise<boolean> {
  const gen = bootGen;
  const before = table$(table)[key];
  if (!before) return false;
  // updated_at stays the server's: a client-clock stamp would break the realtime staleness guard
  const p = patch as AnyRow;
  const fields = Object.keys(p);
  const seq = begin(table, key, p);
  setRow(table, { ...before, ...p } as never);
  const ins = inserting.get(pkey(table, key));
  if (ins) {
    const out = await ins;
    if (gen !== bootGen) return false;
    if (!out.ok || out.key !== key) {
      finish(table, key, seq);
      settle(table, key);
      // a failed insert was already reverted + toasted; a row that already existed takes the edit instead
      return out.ok ? update(table, out.key, patch, what) : false;
    }
  }
  const q = matchPk(supabase().from(table).update(p as never) as QB, table, table$(table)[key] ?? before);
  const { data, error } = await q.select().maybeSingle();
  if (gen !== bootGen) return !error && Boolean(data);
  if (error) {
    finish(table, key, seq, { fields, fallback: before });
    settle(table, key);
    fail(error, what, table);
    return false;
  }
  if (!data) {
    // no row matched: it was deleted (maybe by us, a moment ago), or RLS no longer lets us write it
    const ours = Boolean(tombOf(table, key)) || isOwed(table, key);
    const exists = Boolean(table$(table)[key]);
    finish(table, key, seq, exists ? { fields, fallback: before } : undefined);
    settle(table, key);
    if (!ours) toast.error(`${what}: ${exists ? "it was deleted or you don't have access to it." : "this item was deleted."}`);
    return false;
  }
  finish(table, key, seq);
  resolve(table, key, data as AnyRow, seq);
  return true;
}

/** Patch many rows of the same table (bulk actions), in URL-safe chunks. */
export async function updateMany<T extends TableName>(table: T, keys: string[], patch: Partial<Row<T>>, what = "Couldn't update"): Promise<boolean> {
  if (COMPOSITE[table]) throw new Error("updateMany needs an id-keyed table");
  const gen = bootGen;
  const befores = keys.map((k) => table$(table)[k]).filter(Boolean) as AnyRow[];
  if (!befores.length) return false;
  const p = patch as AnyRow;
  const fields = Object.keys(p);
  const beforeOf = new Map(befores.map((b) => [pkOf(table, b), b]));
  let ids = [...beforeOf.keys()];
  const seqOf = new Map(ids.map((k) => [k, begin(table, k, p)]));
  setRows(table, befores.map((b) => ({ ...b, ...p })) as never);

  // rows created a moment ago: their INSERT lands first (a failed one never existed)
  const waits = ids.map((k) => inserting.get(pkey(table, k)) ?? null);
  if (waits.some(Boolean)) {
    const outs = await Promise.all(waits);
    if (gen !== bootGen) return false;
    const lost = new Set(ids.filter((k, i) => { const o = outs[i]; return Boolean(o && (!o.ok || o.key !== k)); }));
    for (const k of lost) { finish(table, k, seqOf.get(k)!); settle(table, k); }
    ids = ids.filter((k) => !lost.has(k));
    if (!ids.length) return false;
  }

  let firstError: unknown = null;
  let missing = 0;
  await pool(chunked(ids), 4, async (chunk) => {
    const { data, error } = await supabase().from(table).update(p as never).in("id", chunk).select();
    if (gen !== bootGen) return;
    if (error) {
      firstError ??= error;
      for (const k of chunk) {
        finish(table, k, seqOf.get(k)!, { fields, fallback: beforeOf.get(k)! });
        settle(table, k);
      }
      return;
    }
    const returned = new Map(((data ?? []) as AnyRow[]).map((r) => [pkOf(table, r), r]));
    for (const k of chunk) {
      const seq = seqOf.get(k)!;
      const row = returned.get(k);
      if (row) { finish(table, k, seq); resolve(table, k, row, seq); continue; }
      // not updated: deleted meanwhile (maybe by us), or RLS refused this row
      const exists = Boolean(table$(table)[k]);
      const ours = Boolean(tombOf(table, k)) || isOwed(table, k);
      finish(table, k, seq, exists ? { fields, fallback: beforeOf.get(k)! } : undefined);
      settle(table, k);
      if (exists && !ours) missing++;
    }
  });
  if (gen !== bootGen) return !firstError && !missing;
  if (firstError) {
    fail(firstError, what, table);
    return false;
  }
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
  const seq = begin(table, key);
  deleteRows(table, [key]);
  const ins = inserting.get(pkey(table, key));
  if (ins) {
    const out = await ins;
    if (gen !== bootGen) return false;
    if (!out.ok || out.key !== key) {
      finish(table, key, seq);
      settle(table, key);
      // a failed insert never existed (already toasted); a row that already existed is the one to delete
      return out.ok ? remove(table, out.key, what) : false;
    }
  }
  const { data, error } = await matchPk(supabase().from(table).delete() as QB, table, before).select(keyCols(table).join(","));
  let refused = false;
  if (!error && !(data as AnyRow[] | null)?.length) refused = await stillExists(table, before);
  if (gen !== bootGen) return !error && !refused;
  if (error || refused) {
    const row = restorable(table, key, before);
    finish(table, key, seq);
    if (row) restoreRows(table, [row]);
    settle(table, key);
    if (error) fail(error, what, table);
    else toast.error(`${what}: You don't have permission to do that.`);
    return false;
  }
  tombstone(table, key, expectedOf(writes.get(pkey(table, key))) ?? before);
  finish(table, key, seq);
  forget(table, key);
  return true;
}

export async function removeMany<T extends TableName>(table: T, keys: string[], what = "Couldn't delete"): Promise<boolean> {
  if (COMPOSITE[table]) throw new Error("removeMany needs an id-keyed table");
  const gen = bootGen;
  const befores = keys.map((k) => table$(table)[k]).filter(Boolean) as AnyRow[];
  if (!befores.length) return false;
  const beforeOf = new Map(befores.map((b) => [pkOf(table, b), b]));
  let ids = [...beforeOf.keys()];
  const seqOf = new Map(ids.map((k) => [k, begin(table, k)]));
  deleteRows(table, ids);

  const waits = ids.map((k) => inserting.get(pkey(table, k)) ?? null);
  if (waits.some(Boolean)) {
    const outs = await Promise.all(waits);
    if (gen !== bootGen) return false;
    const lost = new Set(ids.filter((k, i) => { const o = outs[i]; return Boolean(o && (!o.ok || o.key !== k)); }));
    for (const k of lost) { finish(table, k, seqOf.get(k)!); settle(table, k); }
    ids = ids.filter((k) => !lost.has(k));
    if (!ids.length) return false;
  }

  let firstError: unknown = null;
  const failed: string[] = [];
  const refused: string[] = [];
  const gone: string[] = [];
  await pool(chunked(ids), 4, async (chunk) => {
    const { data, error } = await supabase().from(table).delete().in("id", chunk).select("id");
    if (error) { firstError ??= error; failed.push(...chunk); return; }
    const deleted = new Set(((data ?? []) as AnyRow[]).map((r) => String(r.id)));
    const missing = chunk.filter((k) => !deleted.has(k));
    gone.push(...chunk.filter((k) => deleted.has(k)));
    if (!missing.length) return;
    const { data: still } = await supabase().from(table).select("id").in("id", missing);
    const blocked = new Set(((still ?? []) as AnyRow[]).map((r) => String(r.id)));
    for (const k of missing) (blocked.has(k) ? refused : gone).push(k);
  });
  if (gen !== bootGen) return !firstError && !refused.length;
  const back = [...failed, ...refused];
  const rows = back.map((k) => restorable(table, k, beforeOf.get(k)!)).filter(Boolean) as AnyRow[];
  for (const k of gone) {
    tombstone(table, k, expectedOf(writes.get(pkey(table, k))) ?? beforeOf.get(k));
    finish(table, k, seqOf.get(k)!);
    forget(table, k);
  }
  for (const k of back) finish(table, k, seqOf.get(k)!);
  restoreRows(table, rows);
  back.forEach((k) => settle(table, k));
  if (firstError) { fail(firstError, what, table); return false; }
  if (refused.length) { toast.error(`${what}: You don't have permission to do that.`); return false; }
  return true;
}

/* ─── deferred deletes (undo without a lossy re-insert) ───────────────────────
   The rows vanish at once; the DELETE is sent when the undo window closes, or
   right away when the page is hidden or closed (keepalive, so it survives the
   unload). Until the server confirms it, each delete is recorded in this tab's
   own localStorage entry. Another page adopts an entry only when the owning tab
   is gone or the undo window is long over, keeps those rows hidden, and retries
   them after every successful sync. */

interface Deferred {
  table: TableName;
  keys: string[];
  befores: AnyRow[];
  seqs: number[];
  what: string;
  gen: number;
  scope: string;
  due: number;
  timer: ReturnType<typeof setTimeout> | null;
  done: boolean;
  onCommitted?: () => void;
}
const deferred = new Set<Deferred>();
const committing = new Set<Deferred>();
const DEFERRABLE = new Set<TableName>(["issues"]);
const DEFER_PREFIX = "locus:pending-deletes:";
/** how long after its undo window closed another page may take over a live tab's delete */
const DEFER_GRACE = 60_000;

let tabId = "";
const tab = () => (tabId ||= uuid());
const scopeOf = (user: string, ws: string) => `${user}:${ws}`;
const curScope = () => scopeOf(S().userId, S().workspaceId);

/** deletes this page owes the server: scope → pkey(table, id) → due (ms; 0 = overdue, retry) */
const owed = new Map<string, Map<string, number>>();
/** workspaces this page can no longer write to: nothing is recorded for them any more */
const deadScopes = new Set<string>();
let pageClosed = false;

const isOwed = (t: TableName, k: string) => Boolean(owed.get(curScope())?.has(pkey(t, k)));

function persistOwed(scope: string) {
  try {
    const key = `${DEFER_PREFIX}${scope}:${tab()}`;
    const m = owed.get(scope);
    if (!m?.size) { window.localStorage.removeItem(key); return; }
    const groups = new Map<string, { table: TableName; keys: string[]; due: number }>();
    for (const [pk, due] of m) {
      const [table, id] = splitPkey(pk);
      const g = `${table}:${due}`;
      let e = groups.get(g);
      if (!e) { e = { table, keys: [], due }; groups.set(g, e); }
      e.keys.push(id);
    }
    window.localStorage.setItem(key, JSON.stringify({ v: 2, closed: pageClosed, list: [...groups.values()] }));
  } catch { /* storage unavailable */ }
}

function owe(scope: string, table: TableName, keys: string[], due: number) {
  if (!keys.length || deadScopes.has(scope)) return;
  let m = owed.get(scope);
  if (!m) { m = new Map(); owed.set(scope, m); }
  for (const k of keys) m.set(pkey(table, k), due);
  persistOwed(scope);
}

function settleOwed(scope: string, table: TableName, keys: string[]) {
  const m = owed.get(scope);
  if (!m || !keys.length) return;
  for (const k of keys) m.delete(pkey(table, k));
  if (!m.size) owed.delete(scope);
  persistOwed(scope);
}

function markPageClosed(closed: boolean) {
  pageClosed = closed;
  for (const scope of owed.keys()) persistOwed(scope);
}

/** Take over deletes other pages accepted but may not have sent (closed tabs, failed sends, older versions). */
function adoptStoredDeletes(user: string, ws: string) {
  if (typeof window === "undefined") return;
  const scope = scopeOf(user, ws);
  const prefix = `${DEFER_PREFIX}${scope}`;
  const mine = `${prefix}:${tab()}`;
  const now = Date.now();
  let storage: Storage;
  const found: string[] = [];
  try {
    storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k !== mine && (k === prefix || k.startsWith(`${prefix}:`))) found.push(k);
    }
  } catch { return; }
  const adopted = new Map<TableName, string[]>();
  for (const k of found) {
    let rec: unknown = null;
    try { rec = JSON.parse(storage.getItem(k) || "null"); } catch { rec = null; }
    // the pre-tab format (one shared key holding [{ table, keys }]) has no undo window to respect
    const legacy = Array.isArray(rec);
    const closed = legacy || (isObject(rec) && rec.closed === true);
    const list: unknown[] = legacy ? (rec as unknown[]) : isObject(rec) && Array.isArray(rec.list) ? rec.list : [];
    const keep: { table: TableName; keys: string[]; due: number }[] = [];
    for (const item of list) {
      if (!isObject(item) || !DEFERRABLE.has(item.table as TableName) || !Array.isArray(item.keys)) continue;
      const table = item.table as TableName;
      const ids = item.keys.filter((x): x is string => typeof x === "string");
      const due = typeof item.due === "number" ? item.due : 0;
      if (closed || due + DEFER_GRACE < now) adopted.set(table, [...(adopted.get(table) ?? []), ...ids]);
      else keep.push({ table, keys: ids, due });
    }
    try {
      if (keep.length) storage.setItem(k, JSON.stringify({ v: 2, closed: false, list: keep }));
      else storage.removeItem(k);
    } catch { /* storage unavailable */ }
  }
  for (const [table, ids] of adopted) owe(scope, table, ids, 0);
}

/** Forget every recorded delete of a workspace this account can no longer access. */
function dropOwed(user: string, ws: string) {
  const scope = scopeOf(user, ws);
  deadScopes.add(scope);
  owed.delete(scope);
  try {
    const prefix = `${DEFER_PREFIX}${scope}`;
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && (k === prefix || k.startsWith(`${prefix}:`))) window.localStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
}

/** the current session's access token, for keepalive requests sent while the page unloads */
let accessToken: string | null = null;

interface DeleteResult { done: string[]; retry: string[]; failed: string[]; error: unknown }
/** network, auth and server trouble may pass; anything else (a bad request) never will */
const transient = (status: number) => status === 0 || status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;

/** DELETE by id in URL-safe chunks. `keepalive` sends every chunk at once and lets them outlive the page. */
async function deleteIds(table: TableName, ids: string[], keepalive: boolean): Promise<DeleteResult> {
  const out: DeleteResult = { done: [], retry: [], failed: [], error: null };
  const send = async (chunk: string[]) => {
    let status = 0;
    let error: unknown = null;
    if (keepalive && accessToken && SUPABASE_URL) {
      try {
        const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${table}?id=in.(${chunk.join(",")})`, {
          method: "DELETE",
          keepalive: true,
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, Prefer: "return=minimal" },
        });
        status = res.status;
        if (!res.ok) error = { message: `${res.status} ${res.statusText}`.trim(), code: "" };
      } catch (e) {
        error = e;
      }
    } else {
      try {
        ({ error, status } = await supabase().from(table).delete().in("id", chunk));
      } catch (e) {
        error = e;
        status = 0;
      }
    }
    if (!error) { out.done.push(...chunk); return; }
    out.error ??= error;
    (transient(status) ? out.retry : out.failed).push(...chunk);
  };
  const chunks = chunked(ids);
  if (keepalive) await Promise.all(chunks.map(send));
  else await pool(chunks, 4, send);
  return out;
}

async function commitDeferred(d: Deferred, opts: { keepalive?: boolean } = {}): Promise<void> {
  if (d.done) return;
  d.done = true;
  if (d.timer) clearTimeout(d.timer);
  deferred.delete(d);
  committing.add(d);
  let keys = d.keys;
  let neverExisted: string[] = [];
  if (!opts.keepalive) {
    // rows created a moment ago: their INSERT lands first (a failed one never existed)
    const outs = await Promise.all(keys.map((k) => inserting.get(pkey(d.table, k)) ?? null));
    neverExisted = keys.filter((k, i) => { const o = outs[i]; return Boolean(o && !o.ok); });
    if (neverExisted.length) keys = keys.filter((k) => !neverExisted.includes(k));
  }
  const res: DeleteResult = keys.length
    ? await deleteIds(d.table, keys, Boolean(opts.keepalive))
    : { done: [], retry: [], failed: [], error: null };
  committing.delete(d);
  // the record goes only once the server confirmed (or can never accept) the delete
  settleOwed(d.scope, d.table, [...res.done, ...res.failed, ...neverExisted]);
  if (res.retry.length) owe(d.scope, d.table, res.retry, 0);
  if (d.gen !== bootGen) return;

  const failed = new Set(res.failed);
  const restore = d.keys
    .map((k, i) => (failed.has(k) ? restorable(d.table, k, d.befores[i]) : null))
    .filter(Boolean) as AnyRow[];
  d.keys.forEach((k, i) => {
    if (res.done.includes(k)) tombstone(d.table, k, d.befores[i]);
    finish(d.table, k, d.seqs[i]);
  });
  for (const k of [...res.done, ...res.retry, ...neverExisted]) forget(d.table, k);
  if (res.failed.length) {
    restoreRows(d.table, restore);
    res.failed.forEach((k) => settle(d.table, k));
    fail(res.error, d.what, d.table);
  }
  if (res.retry.length && !opts.keepalive) {
    toast.error(`${d.what}: the server couldn't be reached — it will be retried when you're back online.`);
  }
  if (res.done.length) d.onCommitted?.();
}

function undoDeferred(d: Deferred): boolean {
  if (d.done) return false;
  d.done = true;
  if (d.timer) clearTimeout(d.timer);
  deferred.delete(d);
  settleOwed(d.scope, d.table, d.keys);
  if (d.gen !== bootGen) return false;
  // the exact rows come back (no server write) — minus any whose own INSERT failed meanwhile —
  // then whatever changed remotely while they were hidden
  const rows = d.keys.map((k, i) => restorable(d.table, k, d.befores[i])).filter(Boolean) as AnyRow[];
  d.keys.forEach((k, i) => finish(d.table, k, d.seqs[i]));
  restoreRows(d.table, rows);
  d.keys.forEach((k) => settle(d.table, k));
  return true;
}

/** Send every deferred delete now (page hide, sign-out, workspace switch). */
function commitAllDeferred(opts: { keepalive?: boolean } = {}): Promise<void> {
  return Promise.all(Array.from(deferred).map((d) => commitDeferred(d, opts))).then(() => undefined);
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
  const seqs = ids.map((k) => begin(table, k));
  deleteRows(table, ids);
  const d: Deferred = {
    table, keys: ids, befores, seqs, what: opts.what ?? "Couldn't delete", gen: bootGen, scope: curScope(),
    due: Date.now() + delayMs, timer: null, done: false, onCommitted: opts.onCommitted,
  };
  deferred.add(d);
  owe(d.scope, table, ids, d.due);
  d.timer = setTimeout(() => { void commitDeferred(d); }, delayMs);
  return { undo: () => undoDeferred(d), commit: () => commitDeferred(d) };
}

/** Send the recorded deletes this page owes for the current workspace (after each sync, on reconnect). */
let retrying = false;
async function retryOwed(gen: number): Promise<void> {
  if (retrying || typeof window === "undefined") return;
  const user = S().userId;
  const ws = S().workspaceId;
  if (!user || !ws) return;
  adoptStoredDeletes(user, ws);
  const scope = scopeOf(user, ws);
  const m = owed.get(scope);
  if (!m?.size) return;
  // never this page's own deletes still in their undo window, or already being sent
  const live = new Set([...deferred, ...committing].flatMap((d) => d.keys.map((k) => pkey(d.table, k))));
  const byTable = new Map<TableName, string[]>();
  for (const pk of m.keys()) {
    if (live.has(pk)) continue;
    const [t, id] = splitPkey(pk);
    byTable.set(t, [...(byTable.get(t) ?? []), id]);
  }
  if (!byTable.size) return;
  retrying = true;
  let resyncNeeded = false;
  try {
    for (const [table, ids] of byTable) {
      const res = await deleteIds(table, ids, false);
      settleOwed(scope, table, [...res.done, ...res.failed]);
      if (gen !== bootGen) continue;
      res.done.forEach((k) => { tombstone(table, k, null); forget(table, k); });
      deleteRows(table, res.done);
      if (res.failed.length) {
        // the server will never accept these: show them again
        fail(res.error, res.failed.length === 1 ? "Couldn't finish a delete" : `Couldn't finish ${res.failed.length} deletes`, table);
        resyncNeeded = true;
      }
    }
  } finally {
    retrying = false;
  }
  if (resyncNeeded && gen === bootGen) resync(gen).catch(() => {});
}

/** Call a Postgres function. Resolves with data, or null on failure (toasted). */
const RPC_TABLE: Record<string, TableName> = { create_team: "teams", create_workspace: "workspaces" };
export async function rpc<R = unknown>(fn: string, args: Record<string, unknown>, what = "Something went wrong"): Promise<R | null> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) {
    fail(error, what, RPC_TABLE[fn]);
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

const PAGE = 1000;
/** a stalled request (dead HTTP/2 connection after sleep) must not hold realtime hostage */
const SNAPSHOT_TIMEOUT_MS = 30_000;
function deadline(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
const quoted = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Every row matching `scope`, keyset-paginated on (created_at, id): a row deleted between two pages
 * cannot shift the next page past one that was never read (as OFFSET paging would).
 */
async function fetchAll(table: TableName, scope: (q: QB) => QB = (q) => q, select = "*"): Promise<AnyRow[]> {
  const rows: AnyRow[] = [];
  let after: AnyRow | null = null;
  for (;;) {
    let q = scope(supabase().from(table).select(select));
    if (after) {
      const at = quoted(String(after.created_at));
      q = q.or(`created_at.gt.${at},and(created_at.eq.${at},id.gt.${String(after.id)})`);
    }
    const { data, error } = await q
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PAGE)
      .abortSignal(deadline(SNAPSHOT_TIMEOUT_MS));
    if (error) throw error;
    const page = (data ?? []) as AnyRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
    after = page[page.length - 1];
  }
}

const toRec = (table: TableName, rows: AnyRow[]) => {
  const r: Rec<AnyRow> = {};
  for (const row of rows) r[pkOf(table, row)] = fixRow(table, row);
  return r;
};

/** One IndexedDB entry per table, so a change rewrites only the tables that changed. */
const CACHE_VERSION = 4;
const snapKey = (user: string, ws: string, t: TableName) => `locus:v${CACHE_VERSION}:${user}:${ws}:${t}`;
const CACHED_TABLES: TableName[] = [
  "profiles", "workspaces", "workspace_members", "workspace_invites", "teams", "team_members", "workflow_states",
  "labels", "projects", "project_milestones", "project_updates", "cycles", "issues", "issue_relations",
  "issue_subscribers", "notifications", "favorites", "views",
];

let refreshSeq = 0;
let appliedRefresh = 0;
/** snapshots in flight; realtime events are buffered while any is held */
const holds = new Set<number>();

async function refresh(gen: number, seq: number): Promise<void> {
  const ws = S().workspaceId;
  const me = S().userId;
  const isResync = S().lastSyncedAt > 0;
  const byWs = (q: QB) => q.eq("workspace_id", ws);
  // keys with writes in flight or settling: keep their local state
  const dirty = new Set<string>([...writes.keys(), ...stash.keys()]);
  activeRefreshes.add(dirty);
  let lostAccess = false;
  try {
    const [
      myMemberships, workspace_members, workspace_invites, teams, team_members, workflow_states, labels,
      projects, project_milestones, project_updates, cycles, issues, issue_relations, issue_subscribers,
      notifications, favorites, views,
    ] = await Promise.all([
      // my workspaces (the switcher lists them) through my own memberships — never a scan of every tenant
      fetchAll("workspace_members", (q) => q.eq("user_id", me), "*, workspaces(*)"),
      // this workspace's members with their profiles (only teammates' profiles are needed)
      fetchAll("workspace_members", byWs, "*, profiles(*)"),
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
      fetchAll("notifications", (q) => q.eq("user_id", me).eq("workspace_id", ws).is("archived_at", null)),
      fetchAll("favorites", (q) => q.eq("user_id", me).eq("workspace_id", ws)),
      fetchAll("views", byWs),
    ]);

    // superseded (teardown, workspace switch, or a newer snapshot already applied)
    if (gen !== bootGen || S().workspaceId !== ws || seq < appliedRefresh) return;

    const workspaces = myMemberships.map((m) => m.workspaces).filter(isObject);
    const profiles = workspace_members.map((m) => m.profiles).filter(isObject);
    const members = workspace_members.map(({ profiles: _p, ...m }) => m as AnyRow);
    // RLS answers "nothing" once we are removed (or the workspace is deleted): never apply that as an empty workspace
    if (!workspaces.some((w) => w.id === ws) || !members.some((m) => m.user_id === me)) {
      lostAccess = !leavingWorkspace;
      return; // (the finally below still runs; the exit happens there, outside the snapshot bookkeeping)
    }
    appliedRefresh = seq;

    const fresh: Partial<Record<TableName, Rec<AnyRow>>> = {
      workspaces: toRec("workspaces", workspaces), profiles: toRec("profiles", profiles),
      workspace_members: toRec("workspace_members", members), workspace_invites: toRec("workspace_invites", workspace_invites),
      teams: toRec("teams", teams), team_members: toRec("team_members", team_members),
      workflow_states: toRec("workflow_states", workflow_states), labels: toRec("labels", labels),
      projects: toRec("projects", projects), project_milestones: toRec("project_milestones", project_milestones),
      project_updates: toRec("project_updates", project_updates), cycles: toRec("cycles", cycles),
      issues: toRec("issues", issues), issue_relations: toRec("issue_relations", issue_relations),
      notifications: toRec("notifications", notifications), favorites: toRec("favorites", favorites),
      views: toRec("views", views),
    };
    // Subscribers: mine come from the snapshot; other users' only matter for issues whose details are loaded.
    const loaded = S().loadedIssues;
    const subs: Rec<AnyRow> = {};
    for (const [k, r] of Object.entries(S().issue_subscribers as unknown as Rec<AnyRow>)) {
      if (r.user_id !== me && loaded[String(r.issue_id)]) subs[k] = r;
    }
    Object.assign(subs, toRec("issue_subscribers", issue_subscribers));
    fresh.issue_subscribers = subs;

    // Rows written locally since the snapshot started keep their local state — including being deleted.
    const local = S();
    for (const pk of dirty) {
      const [t, k] = splitPkey(pk);
      const rec = fresh[t];
      if (!rec) continue;
      const mine = (local[t] as unknown as Rec<AnyRow>)[k];
      if (mine !== undefined) rec[k] = mine; else delete rec[k];
    }
    // Deletes this page still owes the server stay deleted.
    for (const pk of owed.get(scopeOf(me, ws))?.keys() ?? []) {
      const [t, k] = splitPkey(pk);
      delete fresh[t]?.[k];
    }

    useSync.setState({ ...fresh, status: "ready", error: null, lastSyncedAt: Date.now() } as Partial<SyncState>);
  } finally {
    activeRefreshes.delete(dirty);
    if (lostAccess) exitWorkspace("You no longer have access to this workspace.");
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
let hiddenAt = 0;
let unsubscribeSave: (() => void) | null = null;
let authSub: { unsubscribe(): void } | null = null;
let signedOut = false;
let leavingWorkspace = false;
let exiting = false;

/** Call before the current user deliberately leaves or deletes the workspace (false if the request fails). */
export function expectWorkspaceExit(on = true) { leavingWorkspace = on; }

/**
 * Snapshot with realtime buffered: events received meanwhile are replayed on top of it. The hold is
 * released as soon as this or any newer snapshot settles — an older one still in flight never blocks it.
 */
async function resync(gen = bootGen): Promise<void> {
  const seq = ++refreshSeq;
  holds.add(seq);
  if (!live) snapshotStale = true;
  let ok = false;
  try {
    await refresh(gen, seq);
    ok = true;
  } finally {
    if (gen === bootGen) { // teardown() already cleared the holds of a superseded session
      for (const h of holds) if (h <= seq) holds.delete(h);
      if (!holds.size && queue.length) scheduleFlush();
    }
  }
  if (ok && gen === bootGen && !exiting) void retryOwed(gen);
}

export async function bootstrap(opts: { workspace: Workspace; profile: Profile }) {
  teardown();
  const gen = bootGen; // captured after teardown() bumped it
  markPageClosed(false);
  writes.clear();
  inserting.clear();
  stash.clear();
  tombstones.clear();
  loadingIssues.clear();
  holds.clear();
  unsaved.clear();
  signedOut = false;
  leavingWorkspace = false;
  exiting = false;
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

  // another tab signed out, or signed in as someone else (auth-js broadcasts both): leave on this tab too
  authSub = supabase().auth.onAuthStateChange((event, session) => {
    if (session) accessToken = session.access_token;
    else if (event === "SIGNED_OUT") accessToken = null;
    if (signedOut) return;
    // INITIAL_SESSION comes without a session when the local read fails (a token refresh that hit the
    // network): only SIGNED_OUT means the session is gone
    if (!session && event !== "SIGNED_OUT") return;
    if (session && session.user.id === S().userId) return;
    signedOut = true;
    setTimeout(() => { // outside auth-js's notify loop
      const next = window.location.pathname + window.location.search;
      teardown();
      writes.clear();
      inserting.clear();
      stash.clear();
      useSync.setState({ ...EMPTY_ENTITIES(), status: "idle", error: null, userId: "", workspaceId: "", loadedIssues: {}, lastSyncedAt: 0 });
      void clearLocalCache().finally(() => window.location.replace(`/login?next=${encodeURIComponent(next)}`));
    }, 0);
  }).data.subscription;

  // lifecycle first: a delete made right after an instant (cached) start must still go out on page hide
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  // deletes recorded by pages that closed before the server confirmed them: hidden from the start
  adoptStoredDeletes(opts.profile.id, opts.workspace.id);
  const owedNow = owed.get(scopeOf(opts.profile.id, opts.workspace.id));

  // 1 · instant start from the local snapshot (the server's workspace row beats a cached one: slug/name may have changed)
  try {
    const vals = await idbGetMany(CACHED_TABLES.map((t) => snapKey(opts.profile.id, opts.workspace.id, t)));
    if (gen !== bootGen) return;
    if (vals.every(isObject) && S().workspaceId === opts.workspace.id) {
      const cached: Partial<Record<TableName, Rec<AnyRow>>> = {};
      CACHED_TABLES.forEach((t, i) => { cached[t] = { ...(vals[i] as Rec<AnyRow>) }; });
      for (const pk of owedNow?.keys() ?? []) {
        const [t, k] = splitPkey(pk);
        delete cached[t]?.[k];
      }
      if (cached.views) cached.views = toRec("views", Object.values(cached.views));
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
  if (gen !== bootGen || signedOut || exiting) return;

  // 3 · persistence (a complete snapshot first, then only the tables that change)
  unsubscribeSave = useSync.subscribe(onStoreChange);
  if (S().status === "ready") {
    for (const t of CACHED_TABLES) unsaved.add(t);
    scheduleSave();
  }
}

export function teardown() {
  bootGen++; // invalidates every in-flight bootstrap, snapshot, mutation and lazy load
  void commitAllDeferred();
  // nothing recorded so far can be undone any more: any page may finish it
  markPageClosed(true);
  if (channel) { const ch = channel; channel = null; void supabase().removeChannel(ch); }
  live = false;
  wasOffline = false;
  snapshotStale = false;
  onLive = null;
  queue = [];
  flushScheduled = false;
  holds.clear();
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
    window.removeEventListener("pageshow", onPageShow);
  }
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    void commitAllDeferred({ keepalive: true }); // mobile browsers may kill a hidden tab
    flushSave();
    return;
  }
  if (hiddenAt && Date.now() - hiddenAt > 60_000) resync().catch(() => {});
  hiddenAt = 0;
}
function onOnline() { resync().catch(() => {}); }
function onPageHide() {
  void commitAllDeferred({ keepalive: true }); // keepalive: the requests outlive the document
  markPageClosed(true); // what is still recorded now belongs to whichever page opens next
  flushSave();
}
function onPageShow(e: PageTransitionEvent) {
  if (e.persisted) markPageClosed(false); // back from the bfcache
}

/* ─── losing access ─── */

/** Remove this workspace's drafts from localStorage (they belong to a workspace we are leaving). */
function dropWorkspaceDrafts(s: SyncState) {
  if (typeof window === "undefined") return;
  const ids = new Set<string>([...Object.keys(s.issues), ...Object.keys(s.comments), ...Object.keys(s.projects)]);
  const slug = s.workspaces[s.workspaceId]?.slug;
  try {
    const ls = window.localStorage;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (!k) continue;
      const m = /^locus:(?:draft:(?:comment|reply):|project-update-draft:)(.+)$/.exec(k);
      if ((m && ids.has(m[1])) || k === `locus:issue-draft:${s.userId}:${s.workspaceId}`) ls.removeItem(k);
    }
    if (slug && ls.getItem("locus:last-workspace") === slug) ls.removeItem("locus:last-workspace");
  } catch { /* storage unavailable */ }
  if (slug && document.cookie.split("; ").includes(`locus_ws=${slug}`)) {
    document.cookie = "locus_ws=; path=/; max-age=0; samesite=lax";
  }
}

async function dropSnapshot(user: string, ws: string) {
  try {
    const re = new RegExp(`^locus:v\\d+:${user}:${ws}(:|$)`);
    const all = await idbKeys();
    await idbDelMany(all.filter((k) => re.test(String(k))));
  } catch { /* ignore */ }
}

/** Drop everything this browser keeps for the current workspace, stop syncing, then go home. */
function leaveForGood(message: string | null) {
  exiting = true;
  const s = S();
  const user = s.userId;
  const ws = s.workspaceId;
  if (message) toast.error(message);
  dropWorkspaceDrafts(s);
  teardown();
  dropOwed(user, ws);
  const cleared = dropSnapshot(user, ws);
  if (message) setTimeout(() => window.location.assign("/"), 1200); // long enough to read the toast
  else void cleared.finally(() => window.location.assign("/"));
}

/** Removed from the workspace, or it was deleted, while this page had it open. */
function exitWorkspace(message: string) {
  if (exiting || leavingWorkspace || signedOut || !S().workspaceId) return;
  leaveForGood(message);
}

/** The current user just left or deleted this workspace (after expectWorkspaceExit): clean up and go home. */
export function closeWorkspace() {
  if (exiting) return;
  leaveForGood(null);
}

/* ─── IndexedDB snapshot ─── */

const SAVE_DEBOUNCE = 1200;
const SAVE_MAX_WAIT = 10_000;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveDeadline = 0; // 0 = nothing unsaved
let idleHandle: number | null = null;
/** cached tables changed since the last snapshot write */
const unsaved = new Set<TableName>();

/** Only changes to cached tables need a new snapshot (not connection / lazy tables / loadedIssues). */
function onStoreChange(s: SyncState, prev: SyncState) {
  if (s.workspaceId !== prev.workspaceId) return;
  let changed = false;
  for (const t of CACHED_TABLES) if (s[t] !== prev[t]) { unsaved.add(t); changed = true; }
  if (changed) scheduleSave();
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
  if (signedOut || exiting || s.status !== "ready" || !s.workspaceId || !unsaved.size) return;
  // one transaction: the snapshot on disk is always a consistent set of tables
  const entries = [...unsaved].map((t) => [snapKey(s.userId, s.workspaceId, t), s[t]] as [string, unknown]);
  unsaved.clear();
  idbSetMany(entries).catch(() => {});
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
    await idbDelMany(all.filter((k) => { const m = /^locus:v(\d+):/.exec(String(k)); return !!m && Number(m[1]) !== CACHE_VERSION; }));
  } catch { /* ignore */ }
}

/**
 * Drop everything this browser keeps for the signed-in user (snapshots, drafts, per-viewer prefs). The theme
 * stays, and so do recorded deletes the server has not confirmed yet: they are per account and are sent the
 * next time that account opens the workspace.
 */
export async function clearLocalCache() {
  try {
    const all = await idbKeys();
    await idbDelMany(all.filter((k) => String(k).startsWith("locus:")));
  } catch { /* ignore */ }
  if (typeof window === "undefined") return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      for (let i = store.length - 1; i >= 0; i--) {
        const k = store.key(i);
        if (k && k.startsWith("locus:") && k !== "locus:theme" && !k.startsWith(DEFER_PREFIX)) store.removeItem(k);
      }
    } catch { /* storage unavailable */ }
  }
}

/* ─── realtime ─── */

type Change = { table: TableName; type: "INSERT" | "UPDATE" | "DELETE"; row: AnyRow; old: AnyRow };
let queue: Change[] = [];
let flushScheduled = false;

function scheduleFlush() {
  if (flushScheduled || holds.size) return;
  flushScheduled = true;
  setTimeout(flush, 24); // coalesce bursts (bulk edits) into one render
}

/** INSERT/UPDATE bindings filtered to this workspace (Realtime runs an RLS check per subscriber per change). */
const WS_TABLES: TableName[] = [
  "workspace_members", "workspace_invites", "teams", "team_members", "workflow_states", "labels", "projects",
  "project_milestones", "project_updates", "cycles", "issues", "issue_relations", "issue_subscribers", "comments",
  "reactions", "issue_history", "favorites", "views",
];
/** DELETE events cannot be filtered: subscribe only for tables whose deletes the client applies */
const DELETE_TABLES: TableName[] = [
  "workspaces", "workspace_members", "workspace_invites", "teams", "team_members", "workflow_states", "labels",
  "projects", "project_milestones", "project_updates", "cycles", "issues", "issue_relations", "issue_subscribers",
  "comments", "reactions", "notifications", "favorites", "views",
];

function connect() {
  const ws = S().workspaceId;
  const me = S().userId;
  useSync.setState({ connection: "connecting" });
  live = false;
  const ch = supabase().channel(`locus:${ws}:${uuid().slice(0, 8)}`, {
    // report SUBSCRIBED only once postgres_changes is actually streaming
    config: { postgres_changes_options: { wait: true } },
  });
  channel = ch;
  const onChange = (p: RealtimePostgresChangesPayload<AnyRow>) => {
    if (ch !== channel) return;
    queue.push({
      table: p.table as TableName,
      type: p.eventType as Change["type"],
      row: (p.new ?? {}) as AnyRow,
      old: (p.old ?? {}) as AnyRow,
    });
    scheduleFlush();
  };
  for (const table of WS_TABLES) {
    ch.on("postgres_changes", { event: "*", schema: "public", table, filter: `workspace_id=eq.${ws}` }, onChange);
  }
  ch.on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${me}` }, onChange);
  ch.on("postgres_changes", { event: "*", schema: "public", table: "workspaces", filter: `id=eq.${ws}` }, onChange);
  // profiles carry no workspace id; renames / avatar changes are rare, so one unfiltered binding is fine
  ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, onChange);
  for (const table of DELETE_TABLES) ch.on("postgres_changes", { event: "DELETE", schema: "public", table }, onChange);
  ch.subscribe((status) => {
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
  if (holds.size) return; // a snapshot is in flight: replay on top of it
  const changes = queue;
  queue = [];
  if (!changes.length) return;
  const s = S();
  const ws = s.workspaceId;
  const me = s.userId;
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
  let exit: string | null = null;

  for (const c of changes) {
    if (!(c.table in s)) continue;

    if (c.type === "DELETE") {
      if (c.table === "workspaces") {
        if (String(c.old.id) === ws && !leavingWorkspace) exit = "This workspace was deleted.";
        continue;
      }
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
      if (c.table === "workspace_members" && userId === me && !leavingWorkspace) exit ??= "You were removed from this workspace.";
      if (isPending(c.table, key)) stashOf(c.table, key).event = { kind: "delete" };
      if (LAZY.has(c.table)) for (const b of loadingIssues.values()) b.events.push(c);
      opsOf(c.table).set(key, null);
      continue;
    }

    const row = c.row;
    if (c.table === "workspaces") {
      if (row.id !== ws) continue;
    } else if (c.table === "profiles") {
      if (!s.profiles[String(row.id)]) continue; // only people this workspace shows
    } else {
      if (row.workspace_id !== ws) continue;
      if (c.table === "notifications" && row.user_id !== me) continue;
    }
    if (LAZY.has(c.table)) {
      const issueId = row.issue_id != null ? String(row.issue_id) : null;
      if (issueId) {
        const b = loadingIssues.get(issueId);
        if (b) { b.events.push(c); continue; } // replayed once that issue's snapshot lands
        if (!s.loadedIssues[issueId]) continue;
      } else {
        for (const b of loadingIssues.values()) b.events.push(c); // reactions: re-applied after any in-flight snapshot
        const commentId = String(row.comment_id);
        if (!s.comments[commentId] && !ops.get("comments")?.get(commentId)) continue; // a comment we don't hold
      }
    }
    const key = pkOf(c.table, row);
    const tomb = tombOf(c.table, key);
    if (tomb) {
      // a late echo of a write from before our delete; a membership re-created since carries a new id
      if (!COMPOSITE[c.table] || tomb.id == null || row.id == null || row.id === tomb.id) continue;
      tombstones.delete(pkey(c.table, key));
    }
    if (isPending(c.table, key)) {
      const e = stashOf(c.table, key);
      e.event = { kind: "row", row: e.event?.kind === "row" ? { ...e.event.row, ...row } : row };
      confirmBase(c.table, key, row);
      continue;
    }
    if (isOwed(c.table, key)) continue; // deleted here, the server just doesn't know yet
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

  if (exit) {
    exitWorkspace(exit);
    return;
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
}

async function fetchRow(table: TableName, row: AnyRow) {
  const gen = bootGen;
  const { data } = await matchPk(supabase().from(table).select("*"), table, row).maybeSingle();
  if (!data || gen !== bootGen) return;
  const k = pkOf(table, data as AnyRow);
  if (isPending(table, k) || tombOf(table, k) || isOwed(table, k)) return;
  setRow(table, data as never);
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
    for (const [k, r] of incoming) if (!keep(t, k) && !tombOf(t, k)) rec[k] = r;
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
    // comment ids go in the URL: one request per chunk
    const reactions = (await Promise.all(
      chunked(comments.map((c) => String(c.id))).map((ids) => fetchAll("reactions", (q) => q.in("comment_id", ids))),
    )).flat();
    if (gen !== bootGen) return;
    activeRefreshes.delete(dirty);
    replaceIssueDetails(issueId, { comments, issue_history: history, issue_subscribers: subscribers, reactions }, dirty);
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
  // deletes still in their undo window go out while we still have a session (keepalive: they survive the
  // navigation); whatever the server has not confirmed stays recorded and is retried on the next sign-in
  await Promise.race([commitAllDeferred({ keepalive: true }), new Promise<void>((r) => setTimeout(r, 4000))]);
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
