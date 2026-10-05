-- ════════════════════════════════════════════════════════════════════════════
--  Locus · production schema (Supabase / Postgres 15+)
--  Multi-tenant issue tracker: workspaces → teams → issues, projects, cycles.
--  Every workspace-scoped row carries workspace_id so that RLS and Realtime
--  filters are a single indexed equality check.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── profiles (1:1 with auth.users) ─────────────────────────────────────────
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null default '',
  name         text not null default '',
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─── workspaces & membership ────────────────────────────────────────────────
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 64),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  logo_url    text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('admin', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

create table public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role         text not null default 'member' check (role in ('admin', 'member')),
  token        text not null unique
               default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  invited_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz default (now() + interval '14 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles(id) on delete set null
);
create index workspace_invites_ws_idx on public.workspace_invites(workspace_id);
create index workspace_invites_email_idx on public.workspace_invites(lower(email));

-- ─── teams ──────────────────────────────────────────────────────────────────
create table public.teams (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 64),
  key                  text not null check (key ~ '^[A-Z][A-Z0-9]{0,6}$'),
  color                text not null default '#5e6ad2',
  icon                 text,
  description          text not null default '',
  issue_count          integer not null default 0,
  cycles_enabled       boolean not null default false,
  cycle_duration_weeks integer not null default 2 check (cycle_duration_weeks between 1 and 8),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  archived_at          timestamptz,
  unique (workspace_id, key)
);

create table public.team_members (
  team_id      uuid not null references public.teams(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_ws_idx on public.team_members(workspace_id);

-- ─── workflow states (per team) ─────────────────────────────────────────────
create table public.workflow_states (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 48),
  type         text not null check (type in ('backlog', 'unstarted', 'started', 'completed', 'canceled')),
  color        text not null default '#95a2b3',
  description  text not null default '',
  position     double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index workflow_states_team_idx on public.workflow_states(team_id);
create index workflow_states_ws_idx on public.workflow_states(workspace_id);

-- ─── labels (workspace-wide when team_id is null) ───────────────────────────
create table public.labels (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id      uuid references public.teams(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 48),
  color        text not null default '#95a2b3',
  description  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index labels_ws_idx on public.labels(workspace_id);

-- ─── projects, milestones, updates ──────────────────────────────────────────
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  summary      text not null default '',
  description  text not null default '',
  icon         text,
  color        text not null default '#5e6ad2',
  status       text not null default 'planned'
               check (status in ('backlog', 'planned', 'started', 'paused', 'completed', 'canceled')),
  health       text check (health in ('on_track', 'at_risk', 'off_track')),
  priority     smallint not null default 0 check (priority between 0 and 4),
  lead_id      uuid references public.profiles(id) on delete set null,
  member_ids   uuid[] not null default '{}',
  team_ids     uuid[] not null default '{}',
  start_date   date,
  target_date  date,
  sort_order   double precision not null default 0,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz,
  canceled_at  timestamptz,
  archived_at  timestamptz
);
create index projects_ws_idx on public.projects(workspace_id);

create table public.project_milestones (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  description  text not null default '',
  target_date  date,
  sort_order   double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index project_milestones_project_idx on public.project_milestones(project_id);
create index project_milestones_ws_idx on public.project_milestones(workspace_id);

create table public.project_updates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  health       text not null check (health in ('on_track', 'at_risk', 'off_track')),
  body         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index project_updates_project_idx on public.project_updates(project_id, created_at desc);
create index project_updates_ws_idx on public.project_updates(workspace_id);

-- ─── cycles (per team, numbered) ────────────────────────────────────────────
create table public.cycles (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  number       integer not null,
  name         text not null default '',
  description  text not null default '',
  starts_at    date not null,
  ends_at      date not null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (team_id, number),
  check (ends_at > starts_at)
);
create index cycles_ws_idx on public.cycles(workspace_id);

-- ─── issues ─────────────────────────────────────────────────────────────────
create table public.issues (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  number       integer not null,
  title        text not null check (char_length(title) between 1 and 512),
  description  text not null default '',
  state_id     uuid not null references public.workflow_states(id),
  priority     smallint not null default 0 check (priority between 0 and 4),
  assignee_id  uuid references public.profiles(id) on delete set null,
  creator_id   uuid references public.profiles(id) on delete set null,
  project_id   uuid references public.projects(id) on delete set null,
  milestone_id uuid references public.project_milestones(id) on delete set null,
  cycle_id     uuid references public.cycles(id) on delete set null,
  parent_id    uuid references public.issues(id) on delete set null,
  estimate     smallint check (estimate between 0 and 64),
  due_date     date,
  label_ids    uuid[] not null default '{}',
  sort_order   double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz,
  canceled_at  timestamptz,
  archived_at  timestamptz,
  unique (team_id, number)
);
create index issues_ws_idx on public.issues(workspace_id);
create index issues_state_idx on public.issues(state_id);
create index issues_assignee_idx on public.issues(assignee_id);
create index issues_project_idx on public.issues(project_id);
create index issues_cycle_idx on public.issues(cycle_id);
create index issues_parent_idx on public.issues(parent_id);
create index issues_labels_idx on public.issues using gin(label_ids);

create table public.issue_relations (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  issue_id         uuid not null references public.issues(id) on delete cascade,
  related_issue_id uuid not null references public.issues(id) on delete cascade,
  type             text not null check (type in ('blocks', 'related', 'duplicate')),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (issue_id, related_issue_id, type),
  check (issue_id <> related_issue_id)
);
create index issue_relations_ws_idx on public.issue_relations(workspace_id);
create index issue_relations_related_idx on public.issue_relations(related_issue_id);

create table public.issue_subscribers (
  issue_id     uuid not null references public.issues(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (issue_id, user_id)
);
create index issue_subscribers_user_idx on public.issue_subscribers(user_id, workspace_id);

-- ─── comments, reactions, history ───────────────────────────────────────────
create table public.comments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  issue_id     uuid not null references public.issues(id) on delete cascade,
  parent_id    uuid references public.comments(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  body         text not null check (char_length(body) between 1 and 50000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  edited_at    timestamptz
);
create index comments_issue_idx on public.comments(issue_id, created_at);
create index comments_ws_idx on public.comments(workspace_id);

create table public.reactions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  comment_id   uuid not null references public.comments(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  emoji        text not null check (char_length(emoji) between 1 and 16),
  created_at   timestamptz not null default now(),
  unique (comment_id, user_id, emoji)
);
create index reactions_ws_idx on public.reactions(workspace_id);

create table public.issue_history (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  issue_id     uuid not null references public.issues(id) on delete cascade,
  actor_id     uuid references public.profiles(id) on delete set null,
  field        text not null,
  from_value   jsonb,
  to_value     jsonb,
  created_at   timestamptz not null default now()
);
create index issue_history_issue_idx on public.issue_history(issue_id, created_at);
create index issue_history_ws_idx on public.issue_history(workspace_id);

-- ─── notifications, favorites, saved views ──────────────────────────────────
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  actor_id      uuid references public.profiles(id) on delete set null,
  type          text not null,
  issue_id      uuid references public.issues(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete cascade,
  comment_id    uuid references public.comments(id) on delete cascade,
  data          jsonb not null default '{}'::jsonb,
  read_at       timestamptz,
  snoozed_until timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, workspace_id, created_at desc);

create table public.favorites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('issue', 'project', 'cycle', 'view', 'team')),
  target_id    uuid not null,
  sort_order   double precision not null default 0,
  created_at   timestamptz not null default now(),
  unique (user_id, kind, target_id)
);
create index favorites_user_idx on public.favorites(user_id, workspace_id);

create table public.views (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id      uuid references public.teams(id) on delete cascade,
  owner_id     uuid references public.profiles(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  description  text not null default '',
  icon         text,
  color        text not null default '#5e6ad2',
  filters      jsonb not null default '[]'::jsonb,
  display      jsonb not null default '{}'::jsonb,
  shared       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index views_ws_idx on public.views(workspace_id);

-- ════════════════════════════════════════════════════════════════════════════
--  Helper functions
-- ════════════════════════════════════════════════════════════════════════════

-- Workspaces the current user belongs to (security definer → no RLS recursion).
create or replace function public.my_workspace_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select workspace_id from public.workspace_members where user_id = auth.uid();
$$;

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.is_workspace_admin(ws uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Users who share at least one workspace with the caller (for profile visibility).
create or replace function public.shares_workspace_with(other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- Immutable author columns must still go null when the user is deleted (FK set null).
create or replace function public._keep_author(old_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select case when exists (select 1 from public.profiles where id = old_id) then old_id else null end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  Auth → profile bootstrap
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'user_name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
begin
  insert into public.profiles (id, email, name, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    v_name,
    lower(regexp_replace(split_part(v_name, ' ', 1), '[^a-zA-Z0-9_.-]', '', 'g')),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Profiles: users may change name/avatar, never id/email directly.
create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  new.id := old.id;
  if auth.uid() is not null then
    new.email := old.email;
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ════════════════════════════════════════════════════════════════════════════
--  Generic triggers: updated_at + workspace_id derivation (tenant integrity)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'workspaces', 'teams', 'workflow_states', 'labels', 'projects', 'project_milestones',
    'project_updates', 'cycles', 'comments', 'views'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end $$;

-- Rows that hang off a team inherit workspace_id from that team.
create or replace function public.derive_ws_from_team()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ws uuid;
begin
  if new.team_id is null then
    return new;
  end if;
  select workspace_id into v_ws from public.teams where id = new.team_id;
  if v_ws is null then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' and v_ws <> old.workspace_id then
    raise exception 'Cannot move rows across workspaces';
  end if;
  new.workspace_id := v_ws;
  return new;
end $$;

create trigger workflow_states_ws before insert or update of team_id on public.workflow_states
  for each row execute function public.derive_ws_from_team();
create trigger labels_ws before insert or update of team_id on public.labels
  for each row execute function public.derive_ws_from_team();
create trigger views_ws before insert or update of team_id on public.views
  for each row execute function public.derive_ws_from_team();
create trigger team_members_ws before insert on public.team_members
  for each row execute function public.derive_ws_from_team();

-- Rows that hang off a project inherit workspace_id from it.
create or replace function public.derive_ws_from_project()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.projects where id = new.project_id;
  if v_ws is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  new.workspace_id := v_ws;
  return new;
end $$;

create trigger project_milestones_ws before insert or update of project_id on public.project_milestones
  for each row execute function public.derive_ws_from_project();
create trigger project_updates_ws before insert or update of project_id on public.project_updates
  for each row execute function public.derive_ws_from_project();

-- Rows that hang off an issue inherit workspace_id from it.
create or replace function public.derive_ws_from_issue()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.issues where id = new.issue_id;
  if v_ws is null then
    raise exception 'Issue not found' using errcode = 'P0002';
  end if;
  new.workspace_id := v_ws;
  return new;
end $$;

create trigger comments_ws before insert on public.comments
  for each row execute function public.derive_ws_from_issue();
create trigger issue_subscribers_ws before insert on public.issue_subscribers
  for each row execute function public.derive_ws_from_issue();

-- Reactions inherit from their comment.
create or replace function public.reactions_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.comments where id = new.comment_id;
  if v_ws is null then
    raise exception 'Comment not found' using errcode = 'P0002';
  end if;
  new.workspace_id := v_ws;
  new.user_id := coalesce(auth.uid(), new.user_id);
  return new;
end $$;
create trigger reactions_before_insert before insert on public.reactions
  for each row execute function public.reactions_before_insert();

-- Relations: both issues must live in the same workspace.
create or replace function public.issue_relations_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_a uuid; v_b uuid;
begin
  select workspace_id into v_a from public.issues where id = new.issue_id;
  select workspace_id into v_b from public.issues where id = new.related_issue_id;
  if v_a is null or v_b is null or v_a <> v_b then
    raise exception 'Related issues must belong to the same workspace';
  end if;
  new.workspace_id := v_a;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
create trigger issue_relations_before_insert before insert on public.issue_relations
  for each row execute function public.issue_relations_before_insert();

-- Comments: author is always the caller; track edits.
create or replace function public.comments_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.edited_at := null;
  else
    new.user_id := public._keep_author(old.user_id);
    new.issue_id := old.issue_id;
    new.workspace_id := old.workspace_id;
    new.created_at := old.created_at;
    if new.body is distinct from old.body then
      new.edited_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger comments_guard before insert or update on public.comments
  for each row execute function public.comments_guard();

-- Project updates: author is the caller; the latest update sets project health.
create or replace function public.project_updates_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
  else
    new.user_id := public._keep_author(old.user_id);
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger project_updates_guard before insert or update on public.project_updates
  for each row execute function public.project_updates_guard();

-- ════════════════════════════════════════════════════════════════════════════
--  Projects: timestamps from status, validated arrays
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.projects_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.workspace_id := old.workspace_id;
    new.created_by := public._keep_author(old.created_by);
    new.created_at := old.created_at;
  end if;

  if new.lead_id is not null and not exists (
    select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = new.lead_id
  ) then
    raise exception 'Project lead must be a workspace member';
  end if;

  new.member_ids := coalesce(array(
    select distinct m from unnest(new.member_ids) m
    where exists (select 1 from public.workspace_members wm where wm.workspace_id = new.workspace_id and wm.user_id = m)
  ), '{}');
  new.team_ids := coalesce(array(
    select distinct t from unnest(new.team_ids) t
    where exists (select 1 from public.teams tm where tm.workspace_id = new.workspace_id and tm.id = t)
  ), '{}');

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'started' and new.started_at is null then new.started_at := now(); end if;
    new.completed_at := case when new.status = 'completed' then now() else null end;
    new.canceled_at := case when new.status = 'canceled' then now() else null end;
  end if;
  return new;
end $$;
create trigger projects_before_write before insert or update on public.projects
  for each row execute function public.projects_before_write();

-- ════════════════════════════════════════════════════════════════════════════
--  Cycles: per-team numbering
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cycles_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform 1 from public.teams where id = new.team_id for update;
  if new.number is null or new.number <= 0 or exists (
    select 1 from public.cycles where team_id = new.team_id and number = new.number
  ) then
    select coalesce(max(number), 0) + 1 into new.number from public.cycles where team_id = new.team_id;
  end if;
  return new;
end $$;
create trigger cycles_before_insert before insert on public.cycles
  for each row execute function public.cycles_before_insert();
create trigger cycles_ws before insert or update of team_id on public.cycles
  for each row execute function public.derive_ws_from_team();

-- ════════════════════════════════════════════════════════════════════════════
--  Issues: numbering, validation, lifecycle timestamps
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.issues_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ws         uuid;
  v_count      integer;
  v_state_type text;
  v_old_type   text;
  v_cursor     uuid;
  v_depth      integer := 0;
begin
  if tg_op = 'INSERT' or new.team_id is distinct from old.team_id then
    -- lock the team row: the per-team counter must hand out unique numbers
    select workspace_id, issue_count into v_ws, v_count from public.teams where id = new.team_id for update;
  else
    select workspace_id, issue_count into v_ws, v_count from public.teams where id = new.team_id;
  end if;
  if v_ws is null then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;

  if tg_op = 'UPDATE' then
    if v_ws <> old.workspace_id then
      raise exception 'Cannot move issues across workspaces';
    end if;
    new.creator_id := public._keep_author(old.creator_id);
    new.created_at := old.created_at;
  else
    new.creator_id := coalesce(auth.uid(), new.creator_id);
  end if;
  new.workspace_id := v_ws;

  -- Team-scoped identifier (ENG-123). Re-inserting a deleted issue (undo) may keep its number.
  if tg_op = 'INSERT' or new.team_id is distinct from old.team_id then
    if tg_op = 'INSERT' and new.number is not null and new.number between 1 and v_count
       and not exists (select 1 from public.issues where team_id = new.team_id and number = new.number) then
      null;
    else
      update public.teams set issue_count = issue_count + 1 where id = new.team_id returning issue_count into new.number;
    end if;
  else
    new.number := old.number;
  end if;

  -- Workflow state must belong to the team; when moving teams, map by state type.
  if not exists (select 1 from public.workflow_states where id = new.state_id and team_id = new.team_id) then
    if tg_op = 'UPDATE' and new.team_id is distinct from old.team_id then
      select type into v_old_type from public.workflow_states where id = new.state_id;
      select id into new.state_id from public.workflow_states
        where team_id = new.team_id and type = coalesce(v_old_type, 'unstarted')
        order by position limit 1;
      if new.state_id is null then
        select id into new.state_id from public.workflow_states where team_id = new.team_id order by position limit 1;
      end if;
    elsif tg_op = 'INSERT' and new.state_id is null then
      select id into new.state_id from public.workflow_states
        where team_id = new.team_id order by (type <> 'unstarted'), position limit 1;
    else
      raise exception 'Workflow state does not belong to this team';
    end if;
  end if;

  -- Cycles are team-scoped; drop the cycle when the issue changes team.
  if new.cycle_id is not null and not exists (
    select 1 from public.cycles where id = new.cycle_id and team_id = new.team_id
  ) then
    if tg_op = 'UPDATE' and new.team_id is distinct from old.team_id then
      new.cycle_id := null;
    else
      raise exception 'Cycle does not belong to this team';
    end if;
  end if;

  if new.assignee_id is not null and not exists (
    select 1 from public.workspace_members where workspace_id = v_ws and user_id = new.assignee_id
  ) then
    raise exception 'Assignee must be a workspace member';
  end if;

  if new.project_id is not null and not exists (
    select 1 from public.projects where id = new.project_id and workspace_id = v_ws
  ) then
    raise exception 'Project not found in this workspace';
  end if;

  if new.milestone_id is not null and not exists (
    select 1 from public.project_milestones where id = new.milestone_id and project_id = new.project_id
  ) then
    new.milestone_id := null;
  end if;

  -- Parent must be in the workspace and must not create a cycle.
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'An issue cannot be its own parent';
    end if;
    if not exists (select 1 from public.issues where id = new.parent_id and workspace_id = v_ws) then
      raise exception 'Parent issue not found in this workspace';
    end if;
    v_cursor := new.parent_id;
    while v_cursor is not null and v_depth < 50 loop
      select parent_id into v_cursor from public.issues where id = v_cursor;
      if v_cursor = new.id then
        raise exception 'Circular parent relationship';
      end if;
      v_depth := v_depth + 1;
    end loop;
  end if;

  -- Labels: dedupe and keep only labels in this workspace (team labels must match team).
  new.label_ids := coalesce(array(
    select distinct l from unnest(new.label_ids) l
    where exists (
      select 1 from public.labels lb
      where lb.id = l and lb.workspace_id = v_ws and (lb.team_id is null or lb.team_id = new.team_id)
    )
  ), '{}');

  -- Lifecycle timestamps follow the workflow state type.
  if tg_op = 'INSERT' or new.state_id is distinct from old.state_id then
    select type into v_state_type from public.workflow_states where id = new.state_id;
    if v_state_type in ('started', 'completed') and new.started_at is null then
      new.started_at := now();
    end if;
    if v_state_type in ('backlog', 'unstarted') then
      new.started_at := null;
    end if;
    new.completed_at := case when v_state_type = 'completed' then now() else null end;
    new.canceled_at := case when v_state_type = 'canceled' then now() else null end;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger issues_before_write before insert or update on public.issues
  for each row execute function public.issues_before_write();

-- Activity log + notifications + auto-subscription.
create or replace function public.notify_user(
  p_ws uuid, p_user uuid, p_actor uuid, p_type text,
  p_issue uuid, p_comment uuid, p_data jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null or p_user = p_actor then
    return;
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    return;
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_ws and user_id = p_user) then
    return;
  end if;
  insert into public.notifications (workspace_id, user_id, actor_id, type, issue_id, comment_id, data)
  values (p_ws, p_user, p_actor, p_type, p_issue, p_comment, coalesce(p_data, '{}'::jsonb));
end $$;

create or replace function public.subscribe_user(p_issue uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    return;
  end if;
  insert into public.issue_subscribers (issue_id, user_id, workspace_id)
  select p_issue, p_user, i.workspace_id from public.issues i where i.id = p_issue
  on conflict do nothing;
end $$;

create or replace function public.issues_after_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  -- null when the change is a cascade from a deleted user (or a service-role write)
  v_actor uuid := (select p.id from public.profiles p where p.id = auth.uid());
  v_sub   record;
  v_from  text;
  v_to    text;
begin
  if tg_op = 'INSERT' then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, coalesce(v_actor, new.creator_id), 'created', null, null);
    perform public.subscribe_user(new.id, new.creator_id);
    if new.assignee_id is not null then
      perform public.subscribe_user(new.id, new.assignee_id);
      perform public.notify_user(new.workspace_id, new.assignee_id, coalesce(v_actor, new.creator_id),
        'assigned', new.id, null, '{}'::jsonb);
    end if;
    return new;
  end if;

  -- UPDATE: one history row per meaningful field change.
  if new.title is distinct from old.title then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'title', to_jsonb(old.title), to_jsonb(new.title));
  end if;
  if new.state_id is distinct from old.state_id then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'state', to_jsonb(old.state_id), to_jsonb(new.state_id));
    select name into v_from from public.workflow_states where id = old.state_id;
    select name into v_to from public.workflow_states where id = new.state_id;
    for v_sub in select user_id from public.issue_subscribers where issue_id = new.id loop
      perform public.notify_user(new.workspace_id, v_sub.user_id, v_actor, 'status', new.id, null,
        jsonb_build_object('from', v_from, 'to', v_to));
    end loop;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'assignee', to_jsonb(old.assignee_id), to_jsonb(new.assignee_id));
    if new.assignee_id is not null then
      perform public.subscribe_user(new.id, new.assignee_id);
      perform public.notify_user(new.workspace_id, new.assignee_id, v_actor, 'assigned', new.id, null, '{}'::jsonb);
    end if;
    if old.assignee_id is not null then
      perform public.notify_user(new.workspace_id, old.assignee_id, v_actor, 'unassigned', new.id, null, '{}'::jsonb);
    end if;
  end if;
  if new.priority is distinct from old.priority then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'priority', to_jsonb(old.priority), to_jsonb(new.priority));
    if new.priority = 1 then
      for v_sub in select user_id from public.issue_subscribers where issue_id = new.id loop
        perform public.notify_user(new.workspace_id, v_sub.user_id, v_actor, 'priority', new.id, null,
          jsonb_build_object('to', new.priority));
      end loop;
    end if;
  end if;
  if new.project_id is distinct from old.project_id then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'project', to_jsonb(old.project_id), to_jsonb(new.project_id));
  end if;
  if new.cycle_id is distinct from old.cycle_id then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'cycle', to_jsonb(old.cycle_id), to_jsonb(new.cycle_id));
  end if;
  if new.label_ids is distinct from old.label_ids then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'labels', to_jsonb(old.label_ids), to_jsonb(new.label_ids));
  end if;
  if new.estimate is distinct from old.estimate then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'estimate', to_jsonb(old.estimate), to_jsonb(new.estimate));
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'due_date', to_jsonb(old.due_date), to_jsonb(new.due_date));
  end if;
  if new.parent_id is distinct from old.parent_id then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'parent', to_jsonb(old.parent_id), to_jsonb(new.parent_id));
  end if;
  if new.team_id is distinct from old.team_id then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'team', to_jsonb(old.team_id), to_jsonb(new.team_id));
  end if;
  if new.archived_at is distinct from old.archived_at then
    insert into public.issue_history (workspace_id, issue_id, actor_id, field, from_value, to_value)
    values (new.workspace_id, new.id, v_actor, 'archived', to_jsonb(old.archived_at is not null), to_jsonb(new.archived_at is not null));
  end if;
  return new;
end $$;
create trigger issues_after_write after insert or update on public.issues
  for each row execute function public.issues_after_write();

-- Comments: subscribe author, notify subscribers and @mentions.
create or replace function public.comments_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_sub      record;
  v_user     uuid;
  v_mentions uuid[];
begin
  perform public.subscribe_user(new.issue_id, new.user_id);

  select coalesce(array_agg(distinct m[1]::uuid), '{}') into v_mentions
  from regexp_matches(new.body, 'data-id="([0-9a-fA-F-]{36})"', 'g') as m;

  foreach v_user in array v_mentions loop
    if exists (select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = v_user) then
      perform public.subscribe_user(new.issue_id, v_user);
      perform public.notify_user(new.workspace_id, v_user, new.user_id, 'mention', new.issue_id, new.id, '{}'::jsonb);
    end if;
  end loop;

  for v_sub in
    select user_id from public.issue_subscribers
    where issue_id = new.issue_id and not (user_id = any (v_mentions))
  loop
    perform public.notify_user(new.workspace_id, v_sub.user_id, new.user_id, 'comment', new.issue_id, new.id, '{}'::jsonb);
  end loop;
  return new;
end $$;
create trigger comments_after_insert after insert on public.comments
  for each row execute function public.comments_after_insert();

-- Project updates propagate health and notify lead + members.
create or replace function public.project_updates_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_project public.projects;
  v_user    uuid;
begin
  update public.projects set health = new.health where id = new.project_id returning * into v_project;
  for v_user in
    select distinct u from unnest(array_append(v_project.member_ids, v_project.lead_id)) u where u is not null
  loop
    if v_user <> coalesce(new.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and exists (select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = v_user) then
      insert into public.notifications (workspace_id, user_id, actor_id, type, project_id, data)
      values (new.workspace_id, v_user, new.user_id, 'project_update', new.project_id,
              jsonb_build_object('health', new.health));
    end if;
  end loop;
  return new;
end $$;
create trigger project_updates_after_insert after insert on public.project_updates
  for each row execute function public.project_updates_after_insert();

-- Deleting a label removes it from every issue.
create or replace function public.labels_after_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- skip during cascades (team / workspace being deleted): those issues are going away too
  if old.team_id is not null and not exists (select 1 from public.teams where id = old.team_id) then
    return old;
  end if;
  if not exists (select 1 from public.workspaces where id = old.workspace_id) then
    return old;
  end if;
  update public.issues set label_ids = array_remove(label_ids, old.id)
  where workspace_id = old.workspace_id and old.id = any (label_ids);
  return old;
end $$;
create trigger labels_after_delete after delete on public.labels
  for each row execute function public.labels_after_delete();

-- Workspace membership guards: keep at least one admin, clean up team rows.
create or replace function public.workspace_members_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- cascades from a deleted workspace or a deleted user need no guarding
    if not exists (select 1 from public.workspaces where id = old.workspace_id)
       or not exists (select 1 from public.profiles where id = old.user_id) then
      return old;
    end if;
    if old.role = 'admin' and not exists (
      select 1 from public.workspace_members
      where workspace_id = old.workspace_id and role = 'admin' and user_id <> old.user_id
    ) then
      raise exception 'A workspace needs at least one admin';
    end if;
    delete from public.team_members where workspace_id = old.workspace_id and user_id = old.user_id;
    delete from public.favorites where workspace_id = old.workspace_id and user_id = old.user_id;
    return old;
  end if;
  -- UPDATE (role change)
  new.workspace_id := old.workspace_id;
  new.user_id := old.user_id;
  if old.role = 'admin' and new.role <> 'admin' and not exists (
    select 1 from public.workspace_members
    where workspace_id = old.workspace_id and role = 'admin' and user_id <> old.user_id
  ) then
    raise exception 'A workspace needs at least one admin';
  end if;
  return new;
end $$;
create trigger workspace_members_guard before update or delete on public.workspace_members
  for each row execute function public.workspace_members_guard();

-- Team membership: only workspace members can join teams.
create or replace function public.team_members_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = new.user_id
  ) then
    raise exception 'User is not a member of this workspace';
  end if;
  return new;
end $$;
create trigger team_members_guard before insert on public.team_members
  for each row execute function public.team_members_guard();

-- Teams: workspace_id is immutable, key changes keep numbering.
create or replace function public.teams_guard()
returns trigger language plpgsql as $$
begin
  new.workspace_id := old.workspace_id;
  new.issue_count := greatest(new.issue_count, old.issue_count);
  new.created_at := old.created_at;
  return new;
end $$;
create trigger teams_guard before update on public.teams
  for each row execute function public.teams_guard();

-- Workspaces: slug normalisation.
create or replace function public.workspaces_guard()
returns trigger language plpgsql as $$
begin
  new.slug := lower(new.slug);
  if new.slug in (
    'login', 'signup', 'logout', 'onboarding', 'join', 'auth', 'api', 'settings', 'forgot-password',
    'reset-password', 'invite', 'new', 'admin', 'app', 'static', 'public', 'favicon', 'robots', 'sitemap', 'setup'
  ) then
    raise exception 'That URL is reserved' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := public._keep_author(old.created_by);
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger workspaces_guard before insert or update on public.workspaces
  for each row execute function public.workspaces_guard();

-- Invites: inviter is the caller.
create or replace function public.workspace_invites_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.invited_by := coalesce(auth.uid(), new.invited_by);
    new.email := nullif(lower(trim(new.email)), '');
    new.accepted_at := null;
    new.accepted_by := null;
  end if;
  return new;
end $$;
create trigger workspace_invites_guard before insert on public.workspace_invites
  for each row execute function public.workspace_invites_guard();

-- Favorites / views: owner is the caller.
create or replace function public.owner_is_caller()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'favorites' then
      new.user_id := coalesce(auth.uid(), new.user_id);
    else
      new.owner_id := coalesce(auth.uid(), new.owner_id);
    end if;
  end if;
  return new;
end $$;
create trigger favorites_owner before insert on public.favorites
  for each row execute function public.owner_is_caller();
create trigger views_owner before insert on public.views
  for each row execute function public.owner_is_caller();

-- Notifications: recipients may only flip read/snooze/archive state.
create or replace function public.notifications_guard()
returns trigger language plpgsql as $$
begin
  new.id := old.id;
  new.workspace_id := old.workspace_id;
  new.user_id := old.user_id;
  new.actor_id := public._keep_author(old.actor_id);
  new.type := old.type;
  new.issue_id := old.issue_id;
  new.project_id := old.project_id;
  new.comment_id := old.comment_id;
  new.data := old.data;
  new.created_at := old.created_at;
  return new;
end $$;
create trigger notifications_guard before update on public.notifications
  for each row execute function public.notifications_guard();

-- ════════════════════════════════════════════════════════════════════════════
--  RPCs
-- ════════════════════════════════════════════════════════════════════════════

-- Internal: create a team with Linear-style default workflow.
create or replace function public._create_team(
  p_ws uuid, p_name text, p_key text, p_user uuid, p_color text default '#5e6ad2'
) returns public.teams
language plpgsql security definer set search_path = public
as $$
declare v_team public.teams;
begin
  insert into public.teams (workspace_id, name, key, color)
  values (p_ws, trim(p_name), upper(trim(p_key)), coalesce(p_color, '#5e6ad2'))
  returning * into v_team;

  insert into public.workflow_states (workspace_id, team_id, name, type, color, position) values
    (p_ws, v_team.id, 'Backlog',     'backlog',   '#bec2c8', 0),
    (p_ws, v_team.id, 'Todo',        'unstarted', '#e2e2e2', 1),
    (p_ws, v_team.id, 'In Progress', 'started',   '#f2c94c', 2),
    (p_ws, v_team.id, 'In Review',   'started',   '#0f7488', 3),
    (p_ws, v_team.id, 'Done',        'completed', '#5e6ad2', 4),
    (p_ws, v_team.id, 'Canceled',    'canceled',  '#95a2b3', 5),
    (p_ws, v_team.id, 'Duplicate',   'canceled',  '#95a2b3', 6);

  if p_user is not null then
    insert into public.team_members (team_id, user_id, workspace_id) values (v_team.id, p_user, p_ws)
    on conflict do nothing;
  end if;
  return v_team;
end $$;

create or replace function public.create_team(p_workspace_id uuid, p_name text, p_key text, p_color text default '#5e6ad2')
returns public.teams
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  return public._create_team(p_workspace_id, p_name, p_key, auth.uid(), p_color);
end $$;

create or replace function public.create_workspace(
  p_name text, p_slug text, p_team_name text default 'Engineering', p_team_key text default 'ENG'
) returns public.workspaces
language plpgsql security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_ws   public.workspaces;
  v_team public.teams;
  v_todo uuid;
  v_back uuid;
  v_prog uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if (select count(*) from public.workspaces where created_by = v_uid) >= 10 then
    raise exception 'Workspace limit reached';
  end if;

  insert into public.workspaces (name, slug, created_by)
  values (trim(p_name), lower(trim(p_slug)), v_uid)
  returning * into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws.id, v_uid, 'admin');

  insert into public.labels (workspace_id, name, color) values
    (v_ws.id, 'Bug', '#eb5757'),
    (v_ws.id, 'Feature', '#bb87fc'),
    (v_ws.id, 'Improvement', '#4ea7fc');

  v_team := public._create_team(v_ws.id, coalesce(nullif(trim(p_team_name), ''), 'Engineering'),
                                coalesce(nullif(trim(p_team_key), ''), 'ENG'), v_uid);

  select id into v_todo from public.workflow_states where team_id = v_team.id and name = 'Todo';
  select id into v_back from public.workflow_states where team_id = v_team.id and name = 'Backlog';
  select id into v_prog from public.workflow_states where team_id = v_team.id and name = 'In Progress';

  -- Getting-started issues (real, editable, deletable).
  insert into public.issues (team_id, workspace_id, title, description, state_id, priority, assignee_id, sort_order) values
    (v_team.id, v_ws.id, 'Welcome to Locus 👋',
     '<p>Locus is built for speed. Everything is one keystroke away.</p><ul><li><p>Press <code>C</code> to create an issue</p></li><li><p>Press <code>⌘K</code> to open the command menu</p></li><li><p>Press <code>?</code> to see every shortcut</p></li></ul>',
     v_prog, 2, v_uid, -4),
    (v_team.id, v_ws.id, 'Try 3 ways to navigate',
     '<ol><li><p><code>G</code> then <code>I</code> → Inbox, <code>G</code> then <code>M</code> → My issues</p></li><li><p><code>J</code>/<code>K</code> to move through lists, <code>Enter</code> to open</p></li><li><p><code>⌘K</code> → type anything</p></li></ol>',
     v_todo, 3, v_uid, -3),
    (v_team.id, v_ws.id, 'Invite your teammates',
     '<p>Open <strong>Settings → Members</strong> and create an invite link. Everyone sees changes in real time.</p>',
     v_todo, 3, null, -2),
    (v_team.id, v_ws.id, 'Plan your first cycle',
     '<p>Enable cycles for your team in <strong>Settings → Teams</strong>, then add issues to the current cycle.</p>',
     v_back, 4, null, -1);

  return v_ws;
end $$;

create or replace function public.get_invite(p_token text)
returns table (workspace_name text, workspace_slug text, inviter_name text, email text, valid boolean, already_member boolean)
language sql stable security definer set search_path = public
as $$
  select w.name, w.slug, coalesce(p.name, ''), i.email,
         (i.accepted_at is null or i.email is null) and (i.expires_at is null or i.expires_at > now()),
         exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = auth.uid())
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.invited_by
  where i.token = p_token;
$$;

create or replace function public.accept_invite(p_token text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_invite public.workspace_invites;
  v_slug   text;
  v_team   uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_invite from public.workspace_invites where token = p_token for update;
  if v_invite.id is null then
    raise exception 'Invite not found';
  end if;
  select slug into v_slug from public.workspaces where id = v_invite.workspace_id;
  if exists (select 1 from public.workspace_members where workspace_id = v_invite.workspace_id and user_id = v_uid) then
    return v_slug;
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'This invite has expired';
  end if;
  if v_invite.email is not null then
    if v_invite.accepted_at is not null then
      raise exception 'This invite has already been used';
    end if;
    select lower(email) into v_email from auth.users where id = v_uid;
    if v_email is distinct from lower(v_invite.email) then
      raise exception 'This invite was sent to a different email address';
    end if;
    update public.workspace_invites set accepted_at = now(), accepted_by = v_uid where id = v_invite.id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, v_uid, v_invite.role)
  on conflict do nothing;

  -- Join the oldest team so the sidebar is never empty.
  select id into v_team from public.teams
  where workspace_id = v_invite.workspace_id and archived_at is null order by created_at limit 1;
  if v_team is not null then
    insert into public.team_members (team_id, user_id, workspace_id)
    values (v_team, v_uid, v_invite.workspace_id) on conflict do nothing;
  end if;
  return v_slug;
end $$;

create or replace function public.my_pending_invites()
returns table (token text, workspace_name text, workspace_slug text, inviter_name text, role text)
language sql stable security definer set search_path = public
as $$
  select i.token, w.name, w.slug, coalesce(p.name, ''), i.role
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.invited_by
  where i.email is not null
    and lower(i.email) = (select lower(email) from auth.users where id = auth.uid())
    and i.accepted_at is null
    and (i.expires_at is null or i.expires_at > now())
    and not exists (
      select 1 from public.workspace_members m where m.workspace_id = i.workspace_id and m.user_id = auth.uid()
    );
$$;

-- Delete a workflow state, moving its issues to a replacement state first.
create or replace function public.delete_workflow_state(p_state_id uuid, p_replacement_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_state public.workflow_states;
begin
  select * into v_state from public.workflow_states where id = p_state_id;
  if v_state.id is null or not public.is_workspace_member(v_state.workspace_id) then
    raise exception 'State not found';
  end if;
  if not exists (select 1 from public.workflow_states where id = p_replacement_id and team_id = v_state.team_id and id <> p_state_id) then
    raise exception 'Replacement state must belong to the same team';
  end if;
  update public.issues set state_id = p_replacement_id where state_id = p_state_id;
  delete from public.workflow_states where id = p_state_id;
end $$;

-- Bulk sort-order rewrite (used after drag & drop when gaps run out).
create or replace function public.reorder_issues(p_ids uuid[], p_orders double precision[])
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  update public.issues i set sort_order = o.ord
  from unnest(p_ids, p_orders) as o(id, ord)
  where i.id = o.id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  Row Level Security
-- ════════════════════════════════════════════════════════════════════════════
alter table public.profiles            enable row level security;
alter table public.workspaces          enable row level security;
alter table public.workspace_members   enable row level security;
alter table public.workspace_invites   enable row level security;
alter table public.teams               enable row level security;
alter table public.team_members        enable row level security;
alter table public.workflow_states     enable row level security;
alter table public.labels              enable row level security;
alter table public.projects            enable row level security;
alter table public.project_milestones  enable row level security;
alter table public.project_updates     enable row level security;
alter table public.cycles              enable row level security;
alter table public.issues              enable row level security;
alter table public.issue_relations     enable row level security;
alter table public.issue_subscribers   enable row level security;
alter table public.comments            enable row level security;
alter table public.reactions           enable row level security;
alter table public.issue_history       enable row level security;
alter table public.notifications       enable row level security;
alter table public.favorites           enable row level security;
alter table public.views               enable row level security;

-- profiles
create policy "profiles: read self and teammates" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_workspace_with(id));
create policy "profiles: update self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces
create policy "workspaces: members read" on public.workspaces for select to authenticated
  using (id in (select public.my_workspace_ids()));
create policy "workspaces: admins update" on public.workspaces for update to authenticated
  using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));
create policy "workspaces: admins delete" on public.workspaces for delete to authenticated
  using (public.is_workspace_admin(id));

-- workspace_members
create policy "members: read" on public.workspace_members for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "members: admins change roles" on public.workspace_members for update to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
create policy "members: admins remove, anyone leaves" on public.workspace_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id));

-- workspace_invites
create policy "invites: members read" on public.workspace_invites for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "invites: members create" on public.workspace_invites for insert to authenticated
  with check (
    workspace_id in (select public.my_workspace_ids())
    and (role = 'member' or public.is_workspace_admin(workspace_id))
  );
create policy "invites: admins or inviter revoke" on public.workspace_invites for delete to authenticated
  using (invited_by = (select auth.uid()) or public.is_workspace_admin(workspace_id));

-- teams
create policy "teams: members read" on public.teams for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "teams: members update" on public.teams for update to authenticated
  using (workspace_id in (select public.my_workspace_ids()))
  with check (workspace_id in (select public.my_workspace_ids()));
create policy "teams: admins delete" on public.teams for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

-- team_members
create policy "team members: read" on public.team_members for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "team members: join or add" on public.team_members for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids()));
create policy "team members: leave or remove" on public.team_members for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids()));

-- Plain workspace-scoped tables: any member has full CRUD.
do $$
declare t text;
begin
  foreach t in array array[
    'workflow_states', 'labels', 'projects', 'project_milestones', 'cycles', 'issues', 'issue_relations', 'issue_subscribers'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (workspace_id in (select public.my_workspace_ids()))', t || ': read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (workspace_id in (select public.my_workspace_ids()))', t || ': create', t);
    execute format('create policy %I on public.%I for update to authenticated using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()))', t || ': update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (workspace_id in (select public.my_workspace_ids()))', t || ': delete', t);
  end loop;
end $$;

-- project_updates / comments: everyone reads, authors edit their own.
create policy "project updates: read" on public.project_updates for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "project updates: create" on public.project_updates for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids()));
create policy "project updates: author edits" on public.project_updates for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "project updates: author deletes" on public.project_updates for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id));

create policy "comments: read" on public.comments for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "comments: create" on public.comments for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids()));
create policy "comments: author edits" on public.comments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "comments: author deletes" on public.comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id));

create policy "reactions: read" on public.reactions for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "reactions: create" on public.reactions for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids()) and user_id = (select auth.uid()));
create policy "reactions: remove own" on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "history: read" on public.issue_history for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));

create policy "notifications: read own" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: update own" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: delete own" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "favorites: own" on public.favorites for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()));

create policy "views: read shared or own" on public.views for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()) and (shared or owner_id = (select auth.uid())));
create policy "views: create" on public.views for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids()));
create policy "views: owner or admin edits" on public.views for update to authenticated
  using (owner_id = (select auth.uid()) or public.is_workspace_admin(workspace_id))
  with check (workspace_id in (select public.my_workspace_ids()));
create policy "views: owner or admin deletes" on public.views for delete to authenticated
  using (owner_id = (select auth.uid()) or public.is_workspace_admin(workspace_id));

-- ════════════════════════════════════════════════════════════════════════════
--  Privileges
-- ════════════════════════════════════════════════════════════════════════════
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update on public.issue_history from authenticated;
revoke insert on public.notifications from authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_workspace_ids()               to authenticated;
grant execute on function public.is_workspace_member(uuid)        to authenticated;
grant execute on function public.is_workspace_admin(uuid)         to authenticated;
grant execute on function public.shares_workspace_with(uuid)      to authenticated;
grant execute on function public._keep_author(uuid)               to authenticated;
grant execute on function public.create_workspace(text, text, text, text) to authenticated;
grant execute on function public.create_team(uuid, text, text, text)      to authenticated;
grant execute on function public.accept_invite(text)              to authenticated;
grant execute on function public.get_invite(text)                 to anon, authenticated;
grant execute on function public.my_pending_invites()             to authenticated;
grant execute on function public.delete_workflow_state(uuid, uuid) to authenticated;
grant execute on function public.reorder_issues(uuid[], double precision[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  Realtime
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'workspaces', 'workspace_members', 'workspace_invites', 'teams', 'team_members', 'workflow_states',
      'labels', 'projects', 'project_milestones', 'project_updates', 'cycles', 'issues', 'issue_relations',
      'issue_subscribers', 'comments', 'reactions', 'issue_history', 'notifications', 'favorites', 'views',
      'profiles'
    ] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
