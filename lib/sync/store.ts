"use client";
/* ─── Locus · sync engine ────────────────────────────────────────────────────
   The whole workspace lives in memory as normalised entity maps (one map per
   table, keyed by primary key). Reads are synchronous; writes are optimistic:
   the change is applied locally first, sent to Postgres (RLS-protected), then
   reconciled with the row the server returns. Supabase Realtime streams every
   other client's changes into the same maps, and an IndexedDB snapshot makes
   cold starts instant.
   ──────────────────────────────────────────────────────────────────────────── */

import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";
import { supabase } from "@/lib/supabase/client";
import { toast } from "@/lib/ui";
import type { Profile, Row, TableName, Workspace } from "@/lib/types";

type Rec<T> = Record<string, T>;
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

/* ─── table metadata ─── */

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

export function pkOf(table: TableName, row: Record<string, unknown>): string {
  if (table === "workspace_members") return String(row.user_id);
  const cols = COMPOSITE[table];
  if (cols) return cols.map((c) => String(row[c])).join(":");
  return String(row.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchPk(q: any, table: TableName, row: Record<string, unknown>): any {
  const cols = COMPOSITE[table] ?? ["id"];
  return cols.reduce((acc, c) => acc.eq(c, row[c]), q);
}

/* ─── local entity writes ─── */

function setRows<T extends TableName>(table: T, rows: Row<T>[]) {
  if (!rows.length) return;
  useSync.setState((s) => {
    const next = { ...s[table] } as Rec<Row<T>>;
    for (const r of rows) next[pkOf(table, r as Record<string, unknown>)] = r;
    return { [table]: next } as Partial<SyncState>;
  });
}
const setRow = <T extends TableName>(table: T, row: Row<T>) => setRows(table, [row]);

function deleteRows(table: TableName, keys: string[]) {
  useSync.setState((s) => {
    const next = { ...s[table] } as Rec<unknown>;
    let changed = false;
    for (const k of keys) if (k in next) { delete next[k]; changed = true; }
    return changed ? ({ [table]: next } as Partial<SyncState>) : {};
  });
}

/* ─── pending-mutation bookkeeping (suppresses realtime echoes mid-flight) ─── */

const pending = new Map<string, number>();
const pkey = (t: TableName, k: string) => `${t}:${k}`;
const bump = (t: TableName, k: string, d: 1 | -1) => {
  const n = (pending.get(pkey(t, k)) ?? 0) + d;
  if (n <= 0) pending.delete(pkey(t, k)); else pending.set(pkey(t, k), n);
};
const isPending = (t: TableName, k: string) => pending.has(pkey(t, k));

/* ─── errors ─── */

interface PgError { message?: string; code?: string; details?: string; hint?: string }

export function friendlyError(e: unknown): string {
  const err = (e ?? {}) as PgError;
  const msg = err.message ?? String(e);
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) return "You're offline — the change wasn't saved.";
  if (err.code === "23505") return "That name is already taken.";
  if (err.code === "42501" || /row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (err.code === "23514") return msg.includes("reserved") ? "That URL is reserved." : "Some values aren't valid.";
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
  const payload: Record<string, unknown> = { ...values };
  if (!COMPOSITE[table] && !payload.id) payload.id = uuid();
  if (!NOT_WS_SCOPED.has(table) && !payload.workspace_id) payload.workspace_id = S().workspaceId;
  const optimistic = {
    created_at: nowIso(),
    ...(HAS_UPDATED_AT.has(table) ? { updated_at: nowIso() } : {}),
    ...payload,
  } as unknown as Row<T>;
  const key = pkOf(table, payload);
  bump(table, key, 1);
  setRow(table, optimistic);
  const { data, error } = await supabase().from(table).insert(payload).select().single();
  bump(table, key, -1);
  if (error) {
    deleteRows(table, [key]);
    fail(error, what);
    return null;
  }
  if (!isPending(table, key)) setRow(table, data as Row<T>);
  return data as Row<T>;
}

/** Patch a row optimistically. Returns false on failure (patched fields reverted + toasted). */
export async function update<T extends TableName>(table: T, key: string, patch: Partial<Row<T>>, what = "Couldn't update"): Promise<boolean> {
  const before = S()[table][key] as Row<T> | undefined;
  if (!before) return false;
  const local = { ...before, ...patch, ...(HAS_UPDATED_AT.has(table) ? { updated_at: nowIso() } : {}) } as Row<T>;
  bump(table, key, 1);
  setRow(table, local);
  const q: QB = matchPk(supabase().from(table).update(patch as never) as QB, table, before as Record<string, unknown>);
  const { data, error } = await q.select().maybeSingle();
  bump(table, key, -1);
  if (error) {
    const current = S()[table][key] as Row<T> | undefined;
    if (current) {
      const revert = { ...current } as Record<string, unknown>;
      for (const f of Object.keys(patch)) revert[f] = (before as Record<string, unknown>)[f];
      setRow(table, revert as Row<T>);
    }
    fail(error, what);
    return false;
  }
  if (data && !isPending(table, key)) setRow(table, data as Row<T>);
  return true;
}

/** Patch many rows of the same table with one request (bulk actions). */
export async function updateMany<T extends TableName>(table: T, keys: string[], patch: Partial<Row<T>>, what = "Couldn't update"): Promise<boolean> {
  if (COMPOSITE[table]) throw new Error("updateMany needs an id-keyed table");
  const befores = keys.map((k) => S()[table][k] as Row<T> | undefined).filter(Boolean) as Row<T>[];
  if (!befores.length) return false;
  keys.forEach((k) => bump(table, k, 1));
  setRows(table, befores.map((b) => ({ ...b, ...patch, ...(HAS_UPDATED_AT.has(table) ? { updated_at: nowIso() } : {}) }) as Row<T>));
  const { data, error } = await supabase().from(table).update(patch as never).in("id", keys).select();
  keys.forEach((k) => bump(table, k, -1));
  if (error) {
    setRows(table, befores);
    fail(error, what);
    return false;
  }
  setRows(table, ((data ?? []) as Row<T>[]).filter((r) => !isPending(table, pkOf(table, r as Record<string, unknown>))));
  return true;
}

/** Delete a row optimistically. Returns false on failure (row restored + toasted). */
export async function remove<T extends TableName>(table: T, key: string, what = "Couldn't delete"): Promise<boolean> {
  const before = S()[table][key] as Row<T> | undefined;
  if (!before) return false;
  bump(table, key, 1);
  deleteRows(table, [key]);
  const { error } = await (matchPk(supabase().from(table).delete() as QB, table, before as Record<string, unknown>) as Promise<{ error: PgError | null }>);
  bump(table, key, -1);
  if (error) {
    setRow(table, before);
    fail(error, what);
    return false;
  }
  return true;
}

export async function removeMany<T extends TableName>(table: T, keys: string[], what = "Couldn't delete"): Promise<boolean> {
  const befores = keys.map((k) => S()[table][k] as Row<T> | undefined).filter(Boolean) as Row<T>[];
  if (!befores.length) return false;
  keys.forEach((k) => bump(table, k, 1));
  deleteRows(table, keys);
  const { error } = await supabase().from(table).delete().in("id", keys);
  keys.forEach((k) => bump(table, k, -1));
  if (error) {
    setRows(table, befores);
    fail(error, what);
    return false;
  }
  return true;
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

/* ─── bootstrap ─── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QB = any;

async function fetchAll<T extends TableName>(table: T, scope: (q: QB) => QB = (q) => q): Promise<Row<T>[]> {
  const PAGE = 1000;
  const rows: Row<T>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await scope(supabase().from(table).select("*"))
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Row<T>[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const toRec = <T extends TableName>(table: T, rows: Row<T>[]) => {
  const r: Rec<Row<T>> = {};
  for (const row of rows) r[pkOf(table, row as Record<string, unknown>)] = row;
  return r;
};

const CACHE_VERSION = 3;
const cacheKey = () => `locus:v${CACHE_VERSION}:${S().userId}:${S().workspaceId}`;
const CACHED_TABLES: TableName[] = [
  "profiles", "workspaces", "workspace_members", "workspace_invites", "teams", "team_members", "workflow_states",
  "labels", "projects", "project_milestones", "project_updates", "cycles", "issues", "issue_relations",
  "issue_subscribers", "notifications", "favorites", "views",
];

async function refresh(): Promise<void> {
  const ws = S().workspaceId;
  const me = S().userId;
  const byWs = (q: QB) => q.eq("workspace_id", ws);
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

  if (S().workspaceId !== ws) return; // switched workspace mid-flight

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

  // Keep local versions of rows with writes still in flight.
  for (const [table, rec] of Object.entries(fresh) as [TableName, Rec<unknown>][]) {
    const local = S()[table] as Rec<unknown>;
    for (const k of Object.keys(local)) if (isPending(table, k)) rec[k] = local[k];
  }

  useSync.setState({ ...fresh, status: "ready", error: null, lastSyncedAt: Date.now() } as Partial<SyncState>);
}

let channel: RealtimeChannel | null = null;
let wasOffline = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeSave: (() => void) | null = null;
let hiddenAt = 0;

export async function bootstrap(opts: { workspace: Workspace; profile: Profile }) {
  teardown();
  pending.clear();
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
  });

  // 1 · instant start from the local snapshot
  try {
    const cached = (await idbGet(cacheKey())) as Partial<Entities> | undefined;
    if (cached && S().workspaceId === opts.workspace.id) {
      useSync.setState({ ...cached, status: "ready" } as Partial<SyncState>);
    }
  } catch { /* storage unavailable (private mode) — fine */ }

  // 2 · authoritative fetch
  try {
    await refresh();
  } catch (e) {
    console.error("[locus] bootstrap", e);
    if (S().status !== "ready") useSync.setState({ status: "error", error: friendlyError(e) });
    else toast.error("Couldn't sync — showing your last saved data.");
  }

  // 3 · realtime + persistence
  connect();
  unsubscribeSave = useSync.subscribe(scheduleSave);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
}

export function teardown() {
  if (channel) { supabase().removeChannel(channel); channel = null; }
  unsubscribeSave?.();
  unsubscribeSave = null;
  if (saveTimer) clearTimeout(saveTimer);
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
}

function onVisibility() {
  if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 60_000) refresh().catch(() => {});
  hiddenAt = 0;
}
function onOnline() { refresh().catch(() => {}); }

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = S();
    if (s.status !== "ready") return;
    const snap: Partial<Entities> = {};
    for (const t of CACHED_TABLES) (snap as Record<string, unknown>)[t] = s[t];
    idbSet(cacheKey(), snap).catch(() => {});
  }, 1200);
}

export async function clearLocalCache() {
  try {
    const all = await idbKeys();
    await Promise.all(all.filter((k) => String(k).startsWith("locus:")).map((k) => idbDel(k)));
  } catch { /* ignore */ }
}

/* ─── realtime ─── */

type Change = { table: TableName; type: "INSERT" | "UPDATE" | "DELETE"; row: Record<string, unknown>; old: Record<string, unknown> };
let queue: Change[] = [];
let flushScheduled = false;

function connect() {
  const ws = S().workspaceId;
  useSync.setState({ connection: "connecting" });
  channel = supabase()
    .channel(`locus:${ws}:${uuid().slice(0, 8)}`)
    .on("postgres_changes", { event: "*", schema: "public" }, (p) => {
      queue.push({
        table: p.table as TableName,
        type: p.eventType as Change["type"],
        row: (p.new ?? {}) as Record<string, unknown>,
        old: (p.old ?? {}) as Record<string, unknown>,
      });
      if (!flushScheduled) {
        flushScheduled = true;
        setTimeout(flush, 24); // coalesce bursts (bulk edits) into one render
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        useSync.setState({ connection: "live" });
        if (wasOffline) { wasOffline = false; refresh().catch(() => {}); }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        useSync.setState({ connection: "offline" });
        wasOffline = true;
      }
    });
}

function flush() {
  flushScheduled = false;
  const changes = queue;
  queue = [];
  const s = S();
  const ws = s.workspaceId;
  const upserts = new Map<TableName, Record<string, unknown>[]>();
  const deletes = new Map<TableName, string[]>();
  let kicked = false;

  for (const c of changes) {
    if (!(c.table in s)) continue;
    if (c.type === "DELETE") {
      if (c.table === "workspace_members") {
        if (c.old.workspace_id !== ws) continue;
        if (c.old.user_id === s.userId) kicked = true;
      }
      const cols = COMPOSITE[c.table] ?? ["id"];
      if (cols.some((col) => c.old[col] == null)) continue;
      const key = pkOf(c.table, c.old);
      if (isPending(c.table, key)) continue;
      deletes.set(c.table, [...(deletes.get(c.table) ?? []), key]);
      continue;
    }
    const row = c.row;
    if (c.table === "workspaces") {
      if (row.id === ws || s.workspace_members[s.userId]) upserts.set("workspaces", [...(upserts.get("workspaces") ?? []), row]);
      continue;
    }
    if (!NOT_WS_SCOPED.has(c.table) && row.workspace_id !== ws) continue;
    if (c.table === "notifications" && row.user_id !== s.userId) continue;
    if (LAZY.has(c.table) && row.issue_id && !s.loadedIssues[String(row.issue_id)]) continue;
    const key = pkOf(c.table, row);
    if (isPending(c.table, key)) continue;
    upserts.set(c.table, [...(upserts.get(c.table) ?? []), row]);
    if (c.table === "workspace_members" && !s.profiles[String(row.user_id)]) fetchProfile(String(row.user_id));
  }

  for (const [t, rows] of upserts) setRows(t, rows as never);
  for (const [t, keys] of deletes) deleteRows(t, keys);
  if (kicked) {
    toast.error("You were removed from this workspace.");
    setTimeout(() => window.location.assign("/"), 1200);
  }
}

async function fetchProfile(id: string) {
  const { data } = await supabase().from("profiles").select("*").eq("id", id).maybeSingle();
  if (data) setRow("profiles", data as Profile);
}

/* ─── lazy loads ─── */

export async function loadIssueDetails(issueId: string) {
  try {
    const [comments, history, subscribers] = await Promise.all([
      fetchAll("comments", (q) => q.eq("issue_id", issueId)),
      fetchAll("issue_history", (q) => q.eq("issue_id", issueId)),
      fetchAll("issue_subscribers", (q) => q.eq("issue_id", issueId)),
    ]);
    const ids = comments.map((c) => c.id);
    const reactions = ids.length ? await fetchAll("reactions", (q) => q.in("comment_id", ids)) : [];
    setRows("comments", comments);
    setRows("issue_history", history);
    setRows("issue_subscribers", subscribers);
    setRows("reactions", reactions);
    useSync.setState((s) => ({ loadedIssues: { ...s.loadedIssues, [issueId]: true } }));
  } catch (e) {
    fail(e, "Couldn't load activity");
  }
}

export async function signOut() {
  teardown();
  await clearLocalCache();
  await supabase().auth.signOut();
  window.location.assign("/login");
}
