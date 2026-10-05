-- ════════════════════════════════════════════════════════════════════════════
--  Locus · tenant integrity on UPDATE
--  • project-scoped rows (milestones, updates) can never change workspace, and
--    project updates can never be re-homed to another project
--  • team-scoped rows (states, labels, views, cycles) keep their workspace even
--    when team_id is null or unchanged
--  • relations / subscriptions cannot be re-pointed after insert
--  • replies must belong to the same issue as their parent comment
--  • authors may only edit / delete their comments and project updates while
--    they are still members of the workspace
--  Note: an UPDATE whose WHERE clause reads no column (e.g. a filterless
--  PostgREST PATCH) is checked only against the UPDATE policy, never SELECT, so
--  every UPDATE / DELETE policy must carry its own membership check.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── project-scoped rows ────────────────────────────────────────────────────
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
  if tg_op = 'UPDATE' and v_ws <> old.workspace_id then
    raise exception 'Cannot move rows across workspaces';
  end if;
  new.workspace_id := v_ws;
  return new;
end $$;

-- fire on every update, so a direct `set workspace_id = …` is recomputed too
drop trigger if exists project_milestones_ws on public.project_milestones;
create trigger project_milestones_ws before insert or update on public.project_milestones
  for each row execute function public.derive_ws_from_project();
drop trigger if exists project_updates_ws on public.project_updates;
create trigger project_updates_ws before insert or update on public.project_updates
  for each row execute function public.derive_ws_from_project();

-- Project updates are posted to one project for good (the client never edits these columns).
-- project_updates_guard sorts before project_updates_ws, so the ws trigger recomputes from the pinned project.
create or replace function public.project_updates_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
  else
    new.user_id := public._keep_author(old.user_id);
    new.project_id := old.project_id;
    new.workspace_id := old.workspace_id;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- ─── team-scoped rows ───────────────────────────────────────────────────────
create or replace function public.derive_ws_from_team()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ws uuid;
begin
  -- workspace_id is immutable, including for workspace-wide rows (team_id null)
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
  end if;
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

drop trigger if exists workflow_states_ws on public.workflow_states;
create trigger workflow_states_ws before insert or update on public.workflow_states
  for each row execute function public.derive_ws_from_team();
drop trigger if exists labels_ws on public.labels;
create trigger labels_ws before insert or update on public.labels
  for each row execute function public.derive_ws_from_team();
drop trigger if exists views_ws on public.views;
create trigger views_ws before insert or update on public.views
  for each row execute function public.derive_ws_from_team();
drop trigger if exists cycles_ws on public.cycles;
create trigger cycles_ws before insert or update on public.cycles
  for each row execute function public.derive_ws_from_team();

-- ─── relations & subscriptions are insert/delete only ───────────────────────
drop policy if exists "issue_relations: update" on public.issue_relations;
drop policy if exists "issue_subscribers: update" on public.issue_subscribers;
revoke update on public.issue_relations, public.issue_subscribers from authenticated;

-- ─── comments: replies stay on their parent's issue ─────────────────────────
-- Invoker rights: the parent lookup runs under the caller's RLS, so a parent in
-- another tenant is invisible and rejected.
create or replace function public.comments_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.edited_at := null;
    if new.parent_id is not null and not exists (
      select 1 from public.comments p where p.id = new.parent_id and p.issue_id = new.issue_id
    ) then
      raise exception 'Reply must belong to the same issue';
    end if;
  else
    new.user_id := public._keep_author(old.user_id);
    new.issue_id := old.issue_id;
    new.workspace_id := old.workspace_id;
    new.parent_id := old.parent_id;
    new.created_at := old.created_at;
    if new.body is distinct from old.body then
      new.edited_at := now();
    end if;
  end if;
  return new;
end $$;

-- ─── author policies require current membership ─────────────────────────────
drop policy if exists "project updates: author edits" on public.project_updates;
create policy "project updates: author edits" on public.project_updates for update to authenticated
  using (user_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()))
  with check (user_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()));

drop policy if exists "project updates: author deletes" on public.project_updates;
create policy "project updates: author deletes" on public.project_updates for delete to authenticated
  using ((user_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()))
         or public.is_workspace_admin(workspace_id));

drop policy if exists "comments: author edits" on public.comments;
create policy "comments: author edits" on public.comments for update to authenticated
  using (user_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()))
  with check (user_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()));

drop policy if exists "comments: author deletes" on public.comments;
create policy "comments: author deletes" on public.comments for delete to authenticated
  using ((user_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()))
         or public.is_workspace_admin(workspace_id));

-- also cover reactions: removing your own reaction requires being a member
drop policy if exists "reactions: remove own" on public.reactions;
create policy "reactions: remove own" on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()));

revoke execute on function public.derive_ws_from_project() from public, anon, authenticated;
revoke execute on function public.derive_ws_from_team() from public, anon, authenticated;
revoke execute on function public.project_updates_guard() from public, anon, authenticated;
revoke execute on function public.comments_guard() from public, anon, authenticated;
