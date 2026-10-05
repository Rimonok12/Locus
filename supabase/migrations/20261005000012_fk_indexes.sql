-- ════════════════════════════════════════════════════════════════════════════
--  Locus · indexes for cascade paths and snapshot paging
--  Every issue / comment / project / milestone / team delete follows these
--  foreign keys (ON DELETE CASCADE / SET NULL) or trigger lookups. Without an
--  index each of them is a sequential scan of the whole table across every
--  tenant, once per deleted row — a bulk delete of 100 issues then holds locks
--  for seconds or hits the statement timeout.
--  Nullable columns get partial indexes: the lookups are always `col = $1`,
--  which implies `col is not null`.
--  Plain CREATE INDEX (not CONCURRENTLY): the migration runner wraps each file
--  in a transaction.
-- ════════════════════════════════════════════════════════════════════════════

-- comments.parent_id → comments (on delete cascade): replies of a deleted comment
create index if not exists comments_parent_idx on public.comments (parent_id) where parent_id is not null;

-- notifications → issues / comments / projects (on delete cascade)
create index if not exists notifications_issue_idx on public.notifications (issue_id) where issue_id is not null;
create index if not exists notifications_comment_idx on public.notifications (comment_id) where comment_id is not null;
create index if not exists notifications_project_idx on public.notifications (project_id) where project_id is not null;

-- issues.milestone_id → project_milestones (on delete set null)
create index if not exists issues_milestone_idx on public.issues (milestone_id) where milestone_id is not null;

-- favorites_cleanup(): `where target_id = old.id and kind = …` on every issue / project / cycle / view / team delete
create index if not exists favorites_target_idx on public.favorites (target_id, kind);

-- team delete: team-scoped labels and views (on delete cascade)
create index if not exists labels_team_idx on public.labels (team_id) where team_id is not null;
create index if not exists views_team_idx on public.views (team_id) where team_id is not null;

-- the client snapshot pages issues by (created_at, id) within a workspace (keyset pagination)
create index if not exists issues_ws_created_idx on public.issues (workspace_id, created_at, id);
