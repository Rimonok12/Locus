/* ─── Locus · data model + seed workspace ─── */

export type StatusId = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type Priority = 0 | 1 | 2 | 3 | 4; // 0 none · 1 urgent · 2 high · 3 medium · 4 low
export type ViewId = "inbox" | "my" | "issues" | "board" | "projects" | "cycles";

export interface User { id: string; name: string; initials: string; hue: number; }
export interface Team { id: string; name: string; key: string; hue: number; }
export interface Label { id: string; name: string; color: string; }
export interface Project {
  id: string; name: string; glyph: string; color: string;
  status: "planned" | "in_progress" | "paused" | "completed";
  health: "on_track" | "at_risk" | "off_track";
  targetDate: string; leadId: string; summary: string;
}
export interface Cycle { id: string; number: number; teamId: string; start: string; end: string; }
export interface Comment { id: string; userId: string; body: string; at: number; }
export interface Issue {
  id: string; number: number; teamId: string; title: string; description: string;
  status: StatusId; priority: Priority; assigneeId: string | null;
  labelIds: string[]; projectId: string | null; cycleId: string | null;
  estimate: number | null; createdAt: number; updatedAt: number;
  comments: Comment[];
}
export interface Notification { id: string; text: string; issueId: string; at: number; read: boolean; }

export const STATUSES: { id: StatusId; name: string; order: number }[] = [
  { id: "backlog", name: "Backlog", order: 0 },
  { id: "todo", name: "Todo", order: 1 },
  { id: "in_progress", name: "In Progress", order: 2 },
  { id: "in_review", name: "In Review", order: 3 },
  { id: "done", name: "Done", order: 4 },
  { id: "canceled", name: "Canceled", order: 5 },
];

export const PRIORITIES: { id: Priority; name: string }[] = [
  { id: 0, name: "No priority" },
  { id: 1, name: "Urgent" },
  { id: 2, name: "High" },
  { id: 3, name: "Medium" },
  { id: 4, name: "Low" },
];

export const USERS: User[] = [
  { id: "u1", name: "Rimon Debnath", initials: "RD", hue: 212 },
  { id: "u2", name: "Ayesha Rahman", initials: "AR", hue: 262 },
  { id: "u3", name: "Tanvir Hasan", initials: "TH", hue: 158 },
  { id: "u4", name: "Nusrat Jahan", initials: "NJ", hue: 338 },
  { id: "u5", name: "Sakib Chowdhury", initials: "SC", hue: 28 },
];
export const ME = "u1";

export const TEAMS: Team[] = [
  { id: "t1", name: "Engineering", key: "ENG", hue: 212 },
  { id: "t2", name: "Design", key: "DES", hue: 262 },
  { id: "t3", name: "Operations", key: "OPS", hue: 158 },
];

export const LABELS: Label[] = [
  { id: "l1", name: "Bug", color: "#e5484d" },
  { id: "l2", name: "Feature", color: "#8b5cf6" },
  { id: "l3", name: "Improvement", color: "#3f72af" },
  { id: "l4", name: "Performance", color: "#f0a000" },
  { id: "l5", name: "Design", color: "#e93d82" },
  { id: "l6", name: "Docs", color: "#30a46c" },
  { id: "l7", name: "Infra", color: "#11808c" },
  { id: "l8", name: "Mobile", color: "#6e56cf" },
];

export const PROJECTS: Project[] = [
  { id: "p1", name: "Sync Engine v2", glyph: "◆", color: "#3f72af", status: "in_progress", health: "on_track", targetDate: "2026-11-28", leadId: "u1", summary: "Delta-sync over WebSockets with offline queue and conflict resolution." },
  { id: "p2", name: "Mobile App", glyph: "●", color: "#6e56cf", status: "in_progress", health: "at_risk", targetDate: "2026-12-19", leadId: "u3", summary: "React Native client with push notifications and offline inbox." },
  { id: "p3", name: "Public API", glyph: "▲", color: "#30a46c", status: "planned", health: "on_track", targetDate: "2027-01-30", leadId: "u2", summary: "GraphQL API with per-workspace keys, webhooks and rate limits." },
  { id: "p4", name: "Design System", glyph: "■", color: "#e93d82", status: "completed", health: "on_track", targetDate: "2026-09-18", leadId: "u4", summary: "Token-driven component library powering web and mobile." },
];

export const CYCLES: Cycle[] = [
  { id: "c1", number: 7, teamId: "t1", start: "2026-09-28", end: "2026-10-11" },
  { id: "c2", number: 8, teamId: "t1", start: "2026-10-12", end: "2026-10-25" },
  { id: "c3", number: 4, teamId: "t2", start: "2026-09-28", end: "2026-10-11" },
];

let n = 0;
const mk = (
  teamId: string, title: string, status: StatusId, priority: Priority,
  assigneeId: string | null, labelIds: string[], projectId: string | null,
  cycleId: string | null, estimate: number | null, description = "", daysAgo = 3,
): Issue => ({
  id: `i${++n}`, number: n + 100, teamId, title, description, status, priority,
  assigneeId, labelIds, projectId, cycleId, estimate, comments: [],
  createdAt: Date.now() - daysAgo * 864e5, updatedAt: Date.now() - daysAgo * 432e5,
});

export const SEED_ISSUES: Issue[] = [
  mk("t1", "WebSocket reconnect drops queued mutations", "in_progress", 1, "u1", ["l1", "l7"], "p1", "c1", 3, "Steps: go offline, create 3 issues, reconnect — only the last mutation survives. The outbound queue is being truncated on socket close.", 2),
  mk("t1", "Delta packets arrive out of order under high latency", "todo", 2, "u3", ["l1"], "p1", "c1", 5, "Need a per-entity version vector before applying deltas.", 4),
  mk("t1", "Optimistic update rollback flashes stale state", "in_review", 2, "u1", ["l1", "l3"], "p1", "c1", 2, "", 1),
  mk("t1", "IndexedDB cache exceeds quota on large workspaces", "backlog", 3, null, ["l4"], "p1", null, 8, "Evict least-recently-viewed entities past 50MB.", 9),
  mk("t1", "Add keyboard shortcut reference panel (?)", "done", 3, "u2", ["l2"], null, "c1", 1, "", 6),
  mk("t1", "Command palette fuzzy match ranks archived items first", "todo", 3, "u1", ["l1"], null, "c1", 2, "", 3),
  mk("t1", "Issue list virtualization for 10k+ rows", "in_progress", 2, "u3", ["l4"], "p1", "c1", 5, "Target: 60fps scroll with 25k seeded issues.", 5),
  mk("t1", "Batch actions: multi-select with shift+arrows", "backlog", 3, null, ["l2"], null, "c2", 3, "", 7),
  mk("t1", "GraphQL rate limiting per workspace key", "todo", 2, "u5", ["l7"], "p3", "c2", 5, "", 4),
  mk("t1", "Webhook retries with exponential backoff", "backlog", 3, null, ["l7"], "p3", null, 3, "", 11),
  mk("t1", "Cycle burn-up chart mislabels cooldown week", "done", 4, "u2", ["l1"], null, "c1", 1, "", 8),
  mk("t1", "Auto-archive done issues after 60 days", "canceled", 4, null, ["l3"], null, null, 2, "Superseded by workspace retention settings.", 14),
  mk("t2", "Dark theme contrast fails WCAG on muted text", "in_progress", 2, "u4", ["l5", "l1"], "p4", "c3", 2, "dim-on-surface currently 3.9:1 — needs ≥4.5:1.", 2),
  mk("t2", "Empty states for Inbox and Cycles", "todo", 3, "u4", ["l5"], "p4", "c3", 1, "", 5),
  mk("t2", "Priority icon set — refine Urgent glyph", "in_review", 3, "u2", ["l5"], "p4", "c3", 1, "", 3),
  mk("t2", "Mobile bottom-sheet issue editor spec", "backlog", 2, "u4", ["l5", "l8"], "p2", null, 3, "", 6),
  mk("t2", "Board card density option (compact / cozy)", "done", 4, "u2", ["l5", "l2"], "p4", "c3", 2, "", 10),
  mk("t3", "Provision staging environment with seeded data", "done", 2, "u5", ["l7"], null, null, 3, "", 12),
  mk("t3", "CI: fail builds on type errors in PR branches", "in_progress", 2, "u5", ["l7"], null, null, 2, "", 2),
  mk("t3", "Incident runbook for sync outage", "todo", 1, "u5", ["l6", "l7"], "p1", null, 2, "", 1),
  mk("t3", "Cost dashboard: per-service monthly spend", "backlog", 4, null, ["l3"], null, null, 3, "", 16),
  mk("t1", "Mobile push: deep-link into triage view", "todo", 3, "u3", ["l8", "l2"], "p2", "c2", 3, "", 2),
  mk("t1", "Share filtered views via URL", "backlog", 3, null, ["l2"], null, null, 3, "", 5),
  mk("t2", "Marketing site hero — palette pass", "todo", 4, "u4", ["l5"], null, null, 1, "Apply the F9F7F7 / DBE2EF / 3F72AF / 112D4E ramp.", 4),
];

export const SEED_NOTIFICATIONS: Notification[] = [
  { id: "n1", text: "Ayesha assigned you “Optimistic update rollback flashes stale state”", issueId: "i3", at: Date.now() - 36e5, read: false },
  { id: "n2", text: "Tanvir mentioned you in “Delta packets arrive out of order”", issueId: "i2", at: Date.now() - 72e5, read: false },
  { id: "n3", text: "Sakib commented on “Incident runbook for sync outage”", issueId: "i20", at: Date.now() - 2 * 864e5, read: true },
  { id: "n4", text: "“WebSocket reconnect drops queued mutations” marked Urgent", issueId: "i1", at: Date.now() - 3 * 864e5, read: true },
];
