"use client";
/* ─── Locus · domain actions (every write the UI performs goes through here) ─── */

import { supabase } from "@/lib/supabase/client";
import {
  deferRemove, expectWorkspaceExit, insert, mergeRows, dropRows, remove, rpc, update, updateMany, useSync, uuid,
} from "@/lib/sync/store";
import { toast } from "@/lib/ui";
import { navigate } from "@/lib/router";
import { between, defaultStateFor, issueKey, todayISO } from "@/lib/model";
import type {
  Cycle, FavoriteKind, Health, Issue, Label, Milestone, Profile, Project, RelationType, Role, StateType, Team,
  View, WorkflowState, Workspace, WorkspaceInvite,
} from "@/lib/types";

const S = () => useSync.getState();

/* ═══ issues ═══ */

export interface NewIssue extends Partial<Issue> {
  title: string;
  team_id: string;
}

export async function createIssue(input: NewIssue, opts: { silent?: boolean } = {}): Promise<Issue | null> {
  const s = S();
  const state = input.state_id ? s.workflow_states[input.state_id] : defaultStateFor(input.team_id, s.workflow_states);
  if (!state) { toast.error("This team has no workflow states."); return null; }
  const siblings = Object.values(s.issues).filter((i) => i.state_id === state.id);
  const top = siblings.reduce((m, i) => Math.min(m, i.sort_order), Infinity);
  const issue = await insert("issues", {
    priority: 0,
    label_ids: [],
    description: "",
    ...input,
    title: input.title.trim(),
    state_id: state.id,
    creator_id: s.userId,
    sort_order: input.sort_order ?? (Number.isFinite(top) ? top - 1 : 0),
  }, "Couldn't create issue");
  if (issue && !opts.silent) {
    toast.success(`Created ${issueKey(issue)}`, {
      label: "View",
      run: () => navigate({ kind: "issue", identifier: issueKey(issue) }),
    });
  }
  return issue;
}

export const updateIssue = (id: string, patch: Partial<Issue>) => update("issues", id, patch, "Couldn't update issue");

export function updateIssues(ids: string[], patch: Partial<Issue>) {
  if (ids.length === 1) return updateIssue(ids[0], patch);
  return updateMany("issues", ids, patch, "Couldn't update issues");
}

/** Set a workflow state on issues that may belong to different teams (maps by state type). */
export function setIssuesState(ids: string[], stateId: string) {
  const s = S();
  const target = s.workflow_states[stateId];
  if (!target) return;
  const byState = new Map<string, string[]>();
  for (const id of ids) {
    const issue = s.issues[id];
    if (!issue) continue;
    const st = issue.team_id === target.team_id ? target : defaultStateFor(issue.team_id, s.workflow_states, target.type);
    if (!st) continue;
    byState.set(st.id, [...(byState.get(st.id) ?? []), id]);
  }
  for (const [sid, list] of byState) updateIssues(list, { state_id: sid });
}

export function setIssuesStateType(ids: string[], type: StateType) {
  const s = S();
  for (const id of ids) {
    const issue = s.issues[id];
    const st = issue && defaultStateFor(issue.team_id, s.workflow_states, type);
    if (st) updateIssue(id, { state_id: st.id });
  }
}

export function toggleIssueLabel(ids: string[], labelId: string) {
  const s = S();
  const all = ids.every((id) => s.issues[id]?.label_ids.includes(labelId));
  for (const id of ids) {
    const issue = s.issues[id];
    if (!issue) continue;
    const label_ids = all ? issue.label_ids.filter((l) => l !== labelId) : Array.from(new Set([...issue.label_ids, labelId]));
    updateIssue(id, { label_ids });
  }
}

/**
 * Move issues to another team. Until the server hands out the new team's number the local row
 * shows KEY-… (number 0), so the old number never reads as another issue's identifier or URL.
 * The state is mapped by type locally, as the server does.
 */
export function moveIssuesToTeam(ids: string[], teamId: string) {
  const s = S();
  return Promise.all(ids.map((id) => {
    const issue = s.issues[id];
    if (!issue || issue.team_id === teamId) return Promise.resolve(true);
    const st = defaultStateFor(teamId, s.workflow_states, s.workflow_states[issue.state_id]?.type);
    return updateIssue(id, { team_id: teamId, cycle_id: null, number: 0, ...(st ? { state_id: st.id } : {}) });
  }));
}

export function moveIssue(id: string, patch: Partial<Issue>, neighbours: { prev?: number; next?: number }) {
  return updateIssue(id, { ...patch, sort_order: between(neighbours.prev, neighbours.next) });
}

/** Undo window of a delete; a little longer than the toast that offers it (7s). */
const DELETE_UNDO_MS = 7500;

/**
 * Delete issues with a real undo: the issues disappear at once, but the server delete is only
 * sent when the undo window closes (or the page is hidden / closed). Undo therefore restores
 * everything — comments, history, relations, sub-issue links, favorites — untouched.
 */
export async function deleteIssues(ids: string[]) {
  const s = S();
  const rows = ids.map((id) => s.issues[id]).filter(Boolean) as Issue[];
  if (!rows.length) return;
  const gone = new Set(rows.map((r) => r.id));
  const label = rows.length === 1 ? `Deleted ${issueKey(rows[0])}` : `Deleted ${rows.length} issues`;
  const handle = deferRemove("issues", rows.map((r) => r.id), DELETE_UNDO_MS, {
    what: "Couldn't delete",
    onCommitted: () => {
      // sub-issues lose their parent server-side (FK set null); mirror locally
      const cur = S();
      mergeRows("issues", Object.values(cur.issues).filter((i) => i.parent_id && gone.has(i.parent_id)).map((i) => ({ ...i, parent_id: null })));
    },
  });
  if (!handle) return;
  toast(label, {
    label: "Undo",
    run: () => {
      if (!handle.undo()) toast.error("Too late to undo — the delete already went through.");
    },
  });
}

export async function archiveIssues(ids: string[], archived = true) {
  const ok = await updateIssues(ids, { archived_at: archived ? new Date().toISOString() : null });
  if (ok && archived) toast(`Archived ${ids.length === 1 ? "issue" : `${ids.length} issues`}`, { label: "Undo", run: () => archiveIssues(ids, false) });
}

export async function duplicateIssue(id: string) {
  const src = S().issues[id];
  if (!src) return null;
  return createIssue({
    team_id: src.team_id, title: `${src.title} (copy)`, description: src.description, state_id: src.state_id,
    priority: src.priority, assignee_id: src.assignee_id, label_ids: src.label_ids, project_id: src.project_id,
    cycle_id: src.cycle_id, parent_id: src.parent_id, estimate: src.estimate, due_date: src.due_date,
  });
}

export function copyText(text: string, what = "Copied to clipboard") {
  navigator.clipboard?.writeText(text).then(() => toast.success(what), () => toast.error("Clipboard unavailable"));
}

export function issueUrl(issue: Issue) {
  return `${window.location.origin}/${window.location.pathname.split("/")[1]}/issue/${issueKey(issue)}`;
}

/* ═══ subscriptions & relations ═══ */

export const subscribe = (issueId: string) =>
  insert("issue_subscribers", { issue_id: issueId, user_id: S().userId }, "Couldn't subscribe");
export const unsubscribe = (issueId: string) =>
  remove("issue_subscribers", `${issueId}:${S().userId}`, "Couldn't unsubscribe");

export async function addRelation(issueId: string, relatedId: string, type: RelationType) {
  if (issueId === relatedId) return null;
  return insert("issue_relations", { issue_id: issueId, related_issue_id: relatedId, type, created_by: S().userId }, "Couldn't link issues");
}
export const removeRelation = (id: string) => remove("issue_relations", id, "Couldn't remove relation");

/* ═══ comments & reactions ═══ */

export const addComment = (issueId: string, body: string, parentId: string | null = null) =>
  insert("comments", { issue_id: issueId, body, parent_id: parentId, user_id: S().userId }, "Couldn't post comment");
export const editComment = (id: string, body: string) => update("comments", id, { body }, "Couldn't edit comment");
export const deleteComment = (id: string) => remove("comments", id, "Couldn't delete comment");

export async function toggleReaction(commentId: string, emoji: string) {
  const s = S();
  const mine = Object.values(s.reactions).find((r) => r.comment_id === commentId && r.user_id === s.userId && r.emoji === emoji);
  if (mine) return remove("reactions", mine.id, "Couldn't remove reaction");
  return insert("reactions", { comment_id: commentId, user_id: s.userId, emoji }, "Couldn't react");
}

/* ═══ projects ═══ */

export async function createProject(input: Partial<Project> & { name: string }) {
  const s = S();
  const min = Object.values(s.projects).reduce((m, p) => Math.min(m, p.sort_order), 0);
  const p = await insert("projects", {
    status: "planned", priority: 0, member_ids: [], team_ids: [], summary: "", description: "", color: "#5e6ad2",
    lead_id: s.userId, sort_order: min - 1, ...input,
  }, "Couldn't create project");
  if (p) toast.success(`Created project ${p.name}`, { label: "Open", run: () => navigate({ kind: "project", id: p.id, tab: "overview" }) });
  return p;
}
export const updateProject = (id: string, patch: Partial<Project>) => update("projects", id, patch, "Couldn't update project");
export async function deleteProject(id: string) {
  const ok = await remove("projects", id, "Couldn't delete project");
  if (ok) {
    // issues lose their project server-side (FK set null); mirror locally
    const s = S();
    mergeRows("issues", Object.values(s.issues).filter((i) => i.project_id === id).map((i) => ({ ...i, project_id: null, milestone_id: null })));
  }
  return ok;
}
export async function postProjectUpdate(projectId: string, health: Health, body: string) {
  const row = await insert("project_updates", { project_id: projectId, health, body, user_id: S().userId }, "Couldn't post update");
  // the DB trigger sets projects.health; mirror it locally so the UI never waits on realtime
  const project = S().projects[projectId];
  if (row && project) mergeRows("projects", [{ ...project, health }]);
  return row;
}
export const deleteProjectUpdate = (id: string) => remove("project_updates", id);

export const createMilestone = (projectId: string, name: string, target_date: string | null = null) => {
  const max = Object.values(S().project_milestones).filter((m) => m.project_id === projectId).reduce((m, x) => Math.max(m, x.sort_order), 0);
  return insert("project_milestones", { project_id: projectId, name, target_date, sort_order: max + 1 }, "Couldn't add milestone");
};
export const updateMilestone = (id: string, patch: Partial<Milestone>) => update("project_milestones", id, patch);
export const deleteMilestone = (id: string) => remove("project_milestones", id);

/* ═══ cycles ═══ */

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const createCycle = (teamId: string, starts_at: string, ends_at: string, name = "") =>
  insert("cycles", { team_id: teamId, starts_at, ends_at, name }, "Couldn't create cycle");
export const updateCycle = (id: string, patch: Partial<Cycle>) => update("cycles", id, patch, "Couldn't update cycle");
export async function deleteCycle(id: string) {
  const ok = await remove("cycles", id, "Couldn't delete cycle");
  if (ok) {
    // issues lose their cycle server-side (FK set null); mirror locally
    const s = S();
    mergeRows("issues", Object.values(s.issues).filter((i) => i.cycle_id === id).map((i) => ({ ...i, cycle_id: null })));
  }
  return ok;
}

/** Create the next cycle for a team, starting where the latest one ends (or today). */
export async function createNextCycle(teamId: string) {
  const s = S();
  const team = s.teams[teamId];
  const latest = Object.values(s.cycles).filter((c) => c.team_id === teamId).sort((a, b) => b.ends_at.localeCompare(a.ends_at))[0];
  const today = todayISO();
  const start = latest && latest.ends_at > today ? latest.ends_at : today;
  return createCycle(teamId, start, addDays(start, 7 * (team?.cycle_duration_weeks ?? 2)));
}

/** Move unfinished issues of a cycle into another cycle (or none). */
export function rolloverCycle(fromId: string, toId: string | null) {
  const s = S();
  const ids = Object.values(s.issues)
    .filter((i) => i.cycle_id === fromId && !["completed", "canceled"].includes(s.workflow_states[i.state_id]?.type ?? ""))
    .map((i) => i.id);
  if (ids.length) updateIssues(ids, { cycle_id: toId });
  return ids.length;
}

/* ═══ labels ═══ */

export const createLabel = (name: string, color: string, teamId: string | null = null) =>
  insert("labels", { name, color, team_id: teamId }, "Couldn't create label");
export const updateLabel = (id: string, patch: Partial<Label>) => update("labels", id, patch, "Couldn't update label");
export async function deleteLabel(id: string) {
  const ok = await remove("labels", id, "Couldn't delete label");
  if (ok) {
    const s = S();
    mergeRows("issues", Object.values(s.issues).filter((i) => i.label_ids.includes(id)).map((i) => ({ ...i, label_ids: i.label_ids.filter((l) => l !== id) })));
  }
  return ok;
}

/* ═══ teams & workflow ═══ */

export async function createTeam(name: string, key: string, color = "#5e6ad2"): Promise<Team | null> {
  const team = await rpc<Team>("create_team", { p_workspace_id: S().workspaceId, p_name: name, p_key: key, p_color: color }, "Couldn't create team");
  if (!team) return null;
  const sb = supabase();
  const [{ data: states }, { data: tm }] = await Promise.all([
    sb.from("workflow_states").select("*").eq("team_id", team.id),
    sb.from("team_members").select("*").eq("team_id", team.id),
  ]);
  mergeRows("teams", [team]);
  mergeRows("workflow_states", (states ?? []) as WorkflowState[]);
  mergeRows("team_members", (tm ?? []) as never);
  toast.success(`Created team ${team.name}`);
  return team;
}
export const updateTeam = (id: string, patch: Partial<Team>) => update("teams", id, patch, "Couldn't update team");
export async function deleteTeam(id: string) {
  const ok = await remove("teams", id, "Couldn't delete team");
  if (ok) {
    const s = S();
    dropRows("issues", Object.values(s.issues).filter((i) => i.team_id === id).map((i) => i.id));
    dropRows("workflow_states", Object.values(s.workflow_states).filter((x) => x.team_id === id).map((x) => x.id));
    dropRows("cycles", Object.values(s.cycles).filter((x) => x.team_id === id).map((x) => x.id));
    dropRows("labels", Object.values(s.labels).filter((x) => x.team_id === id).map((x) => x.id));
    dropRows("team_members", Object.keys(s.team_members).filter((k) => k.startsWith(`${id}:`)));
    dropRows("views", Object.values(s.views).filter((x) => x.team_id === id).map((x) => x.id));
  }
  return ok;
}
export const joinTeam = (teamId: string, userId = S().userId) =>
  insert("team_members", { team_id: teamId, user_id: userId }, "Couldn't join team");
export const leaveTeam = (teamId: string, userId = S().userId) =>
  remove("team_members", `${teamId}:${userId}`, "Couldn't leave team");

export function createState(teamId: string, name: string, type: StateType, color: string) {
  const max = Object.values(S().workflow_states).filter((s) => s.team_id === teamId).reduce((m, s) => Math.max(m, s.position), 0);
  return insert("workflow_states", { team_id: teamId, name, type, color, position: max + 1 }, "Couldn't add status");
}
export const updateState = (id: string, patch: Partial<WorkflowState>) => update("workflow_states", id, patch, "Couldn't update status");
export async function deleteState(id: string, replacementId: string) {
  const { error } = await supabase().rpc("delete_workflow_state", { p_state_id: id, p_replacement_id: replacementId });
  if (error) { toast.error(`Couldn't delete status: ${error.message}`); return false; }
  const s = S();
  mergeRows("issues", Object.values(s.issues).filter((i) => i.state_id === id).map((i) => ({ ...i, state_id: replacementId })));
  dropRows("workflow_states", [id]);
  return true;
}

/* ═══ views & favorites ═══ */

export const createView = (input: Partial<View> & { name: string }) =>
  insert("views", { filters: [], display: {}, shared: true, color: "#5e6ad2", owner_id: S().userId, ...input }, "Couldn't save view");
export const updateView = (id: string, patch: Partial<View>) => update("views", id, patch, "Couldn't update view");
export const deleteView = (id: string) => remove("views", id, "Couldn't delete view");

export function isFavorite(kind: FavoriteKind, targetId: string) {
  return Object.values(S().favorites).some((f) => f.kind === kind && f.target_id === targetId && f.user_id === S().userId);
}
export async function toggleFavorite(kind: FavoriteKind, targetId: string) {
  const s = S();
  const existing = Object.values(s.favorites).find((f) => f.kind === kind && f.target_id === targetId && f.user_id === s.userId);
  if (existing) return remove("favorites", existing.id, "Couldn't update favorites");
  const max = Object.values(s.favorites).reduce((m, f) => Math.max(m, f.sort_order), 0);
  return insert("favorites", { kind, target_id: targetId, user_id: s.userId, sort_order: max + 1 }, "Couldn't update favorites");
}

/* ═══ notifications ═══ */

export function markNotificationsRead(ids: string[], read = true) {
  const at = read ? new Date().toISOString() : null;
  const targets = ids.filter((id) => Boolean(S().notifications[id]?.read_at) !== read);
  if (targets.length) updateMany("notifications", targets, { read_at: at });
}
export function markAllNotificationsRead() {
  const s = S();
  const now = Date.now();
  // still-snoozed reminders stay unread so they resurface as new
  markNotificationsRead(Object.values(s.notifications)
    .filter((n) => !n.read_at && !(n.snoozed_until && Date.parse(n.snoozed_until) > now))
    .map((n) => n.id));
}
export async function archiveNotifications(ids: string[]): Promise<boolean> {
  const ok = await updateMany("notifications", ids, { archived_at: new Date().toISOString(), read_at: new Date().toISOString() });
  if (ok) dropRows("notifications", ids);
  return ok;
}
/** Snoozed items come back unread when the snooze ends (like Linear), so the reminder is noticed. */
export function snoozeNotifications(ids: string[], until: Date) {
  return updateMany("notifications", ids, { snoozed_until: until.toISOString(), read_at: null });
}
export function unsnoozeNotifications(ids: string[]) {
  return updateMany("notifications", ids, { snoozed_until: null });
}

/* ═══ profile & workspace ═══ */

export const updateProfile = (patch: Partial<Profile>) => update("profiles", S().userId, patch, "Couldn't update profile");

/** Raster images only — the storage buckets refuse anything else (SVG / HTML would be served as active content). */
export const UPLOAD_IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];

async function upload(bucket: "avatars" | "attachments", folder: string, file: File): Promise<string | null> {
  if (!UPLOAD_IMAGE_TYPES.includes(file.type)) {
    toast.error("Only PNG, JPEG, GIF, WebP or AVIF images can be uploaded.");
    return null;
  }
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${uuid()}.${ext}`;
  const { error } = await supabase().storage.from(bucket).upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type });
  if (error) { toast.error(`Upload failed: ${error.message}`); return null; }
  return supabase().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
export async function uploadAvatar(file: File) {
  const url = await upload("avatars", S().userId, file);
  if (url) await updateProfile({ avatar_url: url });
  return url;
}
export const uploadAttachment = (file: File) => upload("attachments", S().workspaceId, file);

export const updateWorkspace = (patch: Partial<Workspace>) => update("workspaces", S().workspaceId, patch, "Couldn't update workspace");
export async function uploadWorkspaceLogo(file: File) {
  const url = await uploadAttachment(file);
  if (url) await updateWorkspace({ logo_url: url });
  return url;
}
export async function deleteWorkspace() {
  const id = S().workspaceId;
  expectWorkspaceExit(true); // our own membership disappears with it: not a "you were removed"
  const { error } = await supabase().from("workspaces").delete().eq("id", id);
  if (error) { expectWorkspaceExit(false); toast.error(`Couldn't delete workspace: ${error.message}`); return false; }
  window.location.assign("/");
  return true;
}

export async function createInvite(email: string | null, role: Role = "member"): Promise<WorkspaceInvite | null> {
  return insert("workspace_invites", { email: email?.trim().toLowerCase() || null, role, invited_by: S().userId }, "Couldn't create invite");
}
export const revokeInvite = (id: string) => remove("workspace_invites", id, "Couldn't revoke invite");
export const inviteLink = (token: string) => `${window.location.origin}/join/${token}`;

export const setMemberRole = (userId: string, role: Role) => update("workspace_members", userId, { role }, "Couldn't change role");
export const removeMember = (userId: string) => remove("workspace_members", userId, "Couldn't remove member");
export async function leaveWorkspace() {
  expectWorkspaceExit(true);
  const ok = await remove("workspace_members", S().userId, "Couldn't leave workspace");
  if (!ok) { expectWorkspaceExit(false); return; }
  window.location.assign("/");
}

/** Create a workspace (onboarding / workspace switcher). Returns the slug. */
export async function createWorkspace(name: string, slug: string, teamName = "Engineering", teamKey = "ENG") {
  const { data, error } = await supabase().rpc("create_workspace", { p_name: name, p_slug: slug, p_team_name: teamName, p_team_key: teamKey });
  if (error) throw error;
  return (data as Workspace).slug;
}
