/* ─── Locus · database row types (mirror supabase/migrations) ─── */

export type UUID = string;
export type ISODate = string; // timestamptz as ISO string
export type DateOnly = string; // date as YYYY-MM-DD

export type Role = "admin" | "member";
export type StateType = "backlog" | "unstarted" | "started" | "completed" | "canceled";
export type Priority = 0 | 1 | 2 | 3 | 4; // 0 none · 1 urgent · 2 high · 3 medium · 4 low
export type ProjectStatus = "backlog" | "planned" | "started" | "paused" | "completed" | "canceled";
export type Health = "on_track" | "at_risk" | "off_track";
export type RelationType = "blocks" | "related" | "duplicate";
export type FavoriteKind = "issue" | "project" | "cycle" | "view" | "team";
export type NotificationType =
  | "assigned" | "unassigned" | "comment" | "mention" | "status" | "priority" | "project_update";

export interface Profile {
  id: UUID; email: string; name: string; display_name: string; avatar_url: string | null;
  created_at: ISODate; updated_at: ISODate;
}

export interface Workspace {
  id: UUID; name: string; slug: string; logo_url: string | null; created_by: UUID | null;
  created_at: ISODate; updated_at: ISODate;
}

/* Membership-style rows are keyed by their natural key in the client; `id` is an opaque
   database key (it keeps realtime DELETE payloads from revealing who belongs where). */
export interface WorkspaceMember {
  id?: UUID; workspace_id: UUID; user_id: UUID; role: Role; created_at: ISODate;
}

export interface WorkspaceInvite {
  id: UUID; workspace_id: UUID; email: string | null; role: Role; token: string;
  invited_by: UUID | null; created_at: ISODate; expires_at: ISODate | null;
  accepted_at: ISODate | null; accepted_by: UUID | null;
}

export interface Team {
  id: UUID; workspace_id: UUID; name: string; key: string; color: string; icon: string | null;
  description: string; issue_count: number; cycles_enabled: boolean; cycle_duration_weeks: number;
  created_at: ISODate; updated_at: ISODate; archived_at: ISODate | null;
}

export interface TeamMember { id?: UUID; team_id: UUID; user_id: UUID; workspace_id: UUID; created_at: ISODate; }

export interface WorkflowState {
  id: UUID; workspace_id: UUID; team_id: UUID; name: string; type: StateType; color: string;
  description: string; position: number; created_at: ISODate; updated_at: ISODate;
}

export interface Label {
  id: UUID; workspace_id: UUID; team_id: UUID | null; name: string; color: string; description: string;
  created_at: ISODate; updated_at: ISODate;
}

export interface Project {
  id: UUID; workspace_id: UUID; name: string; summary: string; description: string;
  icon: string | null; color: string; status: ProjectStatus; health: Health | null; priority: Priority;
  lead_id: UUID | null; member_ids: UUID[]; team_ids: UUID[];
  start_date: DateOnly | null; target_date: DateOnly | null; sort_order: number;
  created_by: UUID | null; created_at: ISODate; updated_at: ISODate;
  started_at: ISODate | null; completed_at: ISODate | null; canceled_at: ISODate | null; archived_at: ISODate | null;
}

export interface Milestone {
  id: UUID; workspace_id: UUID; project_id: UUID; name: string; description: string;
  target_date: DateOnly | null; sort_order: number; created_at: ISODate; updated_at: ISODate;
}

export interface ProjectUpdate {
  id: UUID; workspace_id: UUID; project_id: UUID; user_id: UUID | null; health: Health; body: string;
  created_at: ISODate; updated_at: ISODate;
}

export interface Cycle {
  id: UUID; workspace_id: UUID; team_id: UUID; number: number; name: string; description: string;
  starts_at: DateOnly; ends_at: DateOnly; completed_at: ISODate | null; created_at: ISODate; updated_at: ISODate;
}

export interface Issue {
  id: UUID; workspace_id: UUID; team_id: UUID; number: number; title: string; description: string;
  state_id: UUID; priority: Priority; assignee_id: UUID | null; creator_id: UUID | null;
  project_id: UUID | null; milestone_id: UUID | null; cycle_id: UUID | null; parent_id: UUID | null;
  estimate: number | null; due_date: DateOnly | null; label_ids: UUID[]; sort_order: number;
  created_at: ISODate; updated_at: ISODate; started_at: ISODate | null; completed_at: ISODate | null;
  canceled_at: ISODate | null; archived_at: ISODate | null;
}

export interface IssueRelation {
  id: UUID; workspace_id: UUID; issue_id: UUID; related_issue_id: UUID; type: RelationType;
  created_by: UUID | null; created_at: ISODate;
}

export interface IssueSubscriber { id?: UUID; issue_id: UUID; user_id: UUID; workspace_id: UUID; created_at: ISODate; }

export interface Comment {
  id: UUID; workspace_id: UUID; issue_id: UUID; parent_id: UUID | null; user_id: UUID | null; body: string;
  created_at: ISODate; updated_at: ISODate; edited_at: ISODate | null;
}

export interface Reaction {
  id: UUID; workspace_id: UUID; comment_id: UUID; user_id: UUID; emoji: string; created_at: ISODate;
}

export interface HistoryEntry {
  id: UUID; workspace_id: UUID; issue_id: UUID; actor_id: UUID | null; field: string;
  from_value: unknown; to_value: unknown; created_at: ISODate;
}

export interface Notification {
  id: UUID; workspace_id: UUID; user_id: UUID; actor_id: UUID | null; type: NotificationType;
  issue_id: UUID | null; project_id: UUID | null; comment_id: UUID | null; data: Record<string, unknown>;
  read_at: ISODate | null; snoozed_until: ISODate | null; archived_at: ISODate | null; created_at: ISODate;
}

export interface Favorite {
  id: UUID; workspace_id: UUID; user_id: UUID; kind: FavoriteKind; target_id: UUID; sort_order: number;
  created_at: ISODate;
}

/* ─── filters & display options (saved in views.filters / views.display) ─── */

export type FilterField =
  | "status" | "state_type" | "assignee" | "creator" | "priority" | "label"
  | "project" | "cycle" | "team" | "estimate" | "due";
export type FilterOp = "is" | "is_not";
/** values are entity ids, or tokens: "none" (null), "me" (current user),
 *  for due: "overdue" | "today" | "week" | "none"; for state_type: StateType */
export interface Filter { id: string; field: FilterField; op: FilterOp; values: string[]; }

export type Grouping = "status" | "assignee" | "project" | "priority" | "cycle" | "label" | "team" | "none";
export type Ordering = "manual" | "priority" | "updated" | "created" | "due" | "title" | "estimate";
export type CompletedWindow = "all" | "day" | "week" | "month" | "none";
export type DisplayProperty =
  | "id" | "status" | "priority" | "assignee" | "labels" | "project" | "cycle"
  | "estimate" | "due" | "created" | "updated" | "milestone" | "subIssues";

export interface DisplayOptions {
  layout: "list" | "board";
  grouping: Grouping;
  ordering: Ordering;
  completed: CompletedWindow;
  showEmptyGroups: boolean;
  showSubIssues: boolean;
  properties: Record<DisplayProperty, boolean>;
}

export interface View {
  id: UUID; workspace_id: UUID; team_id: UUID | null; owner_id: UUID | null; name: string;
  description: string; icon: string | null; color: string; filters: Filter[];
  display: Partial<DisplayOptions>; shared: boolean; created_at: ISODate; updated_at: ISODate;
}

/* ─── table registry ─── */
export interface Tables {
  profiles: Profile;
  workspaces: Workspace;
  workspace_members: WorkspaceMember;
  workspace_invites: WorkspaceInvite;
  teams: Team;
  team_members: TeamMember;
  workflow_states: WorkflowState;
  labels: Label;
  projects: Project;
  project_milestones: Milestone;
  project_updates: ProjectUpdate;
  cycles: Cycle;
  issues: Issue;
  issue_relations: IssueRelation;
  issue_subscribers: IssueSubscriber;
  comments: Comment;
  reactions: Reaction;
  issue_history: HistoryEntry;
  notifications: Notification;
  favorites: Favorite;
  views: View;
}
export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T];
