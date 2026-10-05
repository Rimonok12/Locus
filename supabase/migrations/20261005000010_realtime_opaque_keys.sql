-- ════════════════════════════════════════════════════════════════════════════
--  Locus · opaque primary keys for membership-style tables
--  Supabase Realtime cannot apply RLS to DELETE events, and a DELETE payload
--  carries the row's primary key. With composite keys that leaked
--  (workspace_id, user_id), (team_id, user_id) and (issue_id, user_id) pairs to
--  every signed-in socket. A surrogate uuid key makes DELETE payloads opaque;
--  the natural keys stay unique (every `on conflict do nothing` in the schema
--  has no conflict target, and the client upserts on the natural key).
--  The client keeps keying these rows by their natural key and resolves DELETE
--  events by `id` (lib/sync/store.ts).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.workspace_members add column id uuid not null default gen_random_uuid();
alter table public.workspace_members drop constraint workspace_members_pkey;
alter table public.workspace_members add primary key (id);
alter table public.workspace_members add constraint workspace_members_natural_key unique (workspace_id, user_id);

alter table public.team_members add column id uuid not null default gen_random_uuid();
alter table public.team_members drop constraint team_members_pkey;
alter table public.team_members add primary key (id);
alter table public.team_members add constraint team_members_natural_key unique (team_id, user_id);

alter table public.issue_subscribers add column id uuid not null default gen_random_uuid();
alter table public.issue_subscribers drop constraint issue_subscribers_pkey;
alter table public.issue_subscribers add primary key (id);
alter table public.issue_subscribers add constraint issue_subscribers_natural_key unique (issue_id, user_id);
