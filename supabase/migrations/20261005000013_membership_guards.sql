-- ════════════════════════════════════════════════════════════════════════════
--  Locus · team-scoped rows stay on their team; membership-shaped writes are
--  checked against the right workspace and the right user
--  • workflow_states.team_id and cycles.team_id are fixed after insert. Moving a
--    state or cycle to another team froze every issue using it ("does not
--    belong to this team" on any update) and, with 20261005000005, made the
--    members assigned to those issues impossible to remove. Existing
--    mismatches are repaired below.
--  • team_members_guard ran before team_members_ws (triggers fire in name
--    order) and so checked the workspace the CLIENT sent: a member of two
--    workspaces could put a user of one into a team of the other.
--  • issue subscriptions: members subscribe / unsubscribe only themselves
--    (admins may unsubscribe anyone). Auto-subscriptions go through
--    subscribe_user(), which is security definer.
--  • the author branch of the views / invites DELETE policies now requires
--    current membership (a filterless DELETE is checked against that policy
--    alone, see 20261005000004).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── states and cycles keep their team ──────────────────────────────────────
create or replace function public.pin_team_id()
returns trigger language plpgsql as $$
begin
  new.team_id := old.team_id;
  return new;
end $$;
revoke execute on function public.pin_team_id() from public, anon, authenticated;

-- named to sort before *_ws, so derive_ws_from_team() sees the pinned team
drop trigger if exists workflow_states_pin_team on public.workflow_states;
create trigger workflow_states_pin_team before update on public.workflow_states
  for each row execute function public.pin_team_id();
drop trigger if exists cycles_pin_team on public.cycles;
create trigger cycles_pin_team before update on public.cycles
  for each row execute function public.pin_team_id();

-- ─── repair issues left with another team's state or cycle ──────────────────
-- a team whose every state was moved away still needs one to map its issues onto
insert into public.workflow_states (workspace_id, team_id, name, type, color, position)
select t.workspace_id, t.id, 'Todo', 'unstarted', '#e2e2e2', 0
from public.teams t
where exists (select 1 from public.issues i where i.team_id = t.id)
  and not exists (select 1 from public.workflow_states s where s.team_id = t.id);

-- one statement for both columns: issues_before_write validates the state and the cycle together
update public.issues i
   set state_id = case
         when exists (select 1 from public.workflow_states s where s.id = i.state_id and s.team_id = i.team_id) then i.state_id
         else coalesce(
           (select s2.id from public.workflow_states s2
             where s2.team_id = i.team_id
               and s2.type = (select s.type from public.workflow_states s where s.id = i.state_id)
             order by s2.position limit 1),
           (select s3.id from public.workflow_states s3 where s3.team_id = i.team_id order by s3.position limit 1))
       end,
       cycle_id = case
         when i.cycle_id is null
           or exists (select 1 from public.cycles c where c.id = i.cycle_id and c.team_id = i.team_id) then i.cycle_id
         else null
       end
 where not exists (select 1 from public.workflow_states s where s.id = i.state_id and s.team_id = i.team_id)
    or (i.cycle_id is not null
        and not exists (select 1 from public.cycles c where c.id = i.cycle_id and c.team_id = i.team_id));

-- ─── team membership is checked against the team's own workspace ────────────
create or replace function public.team_members_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.teams where id = new.team_id;
  if v_ws is null then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.workspace_members where workspace_id = v_ws and user_id = new.user_id
  ) then
    raise exception 'User is not a member of this workspace';
  end if;
  new.workspace_id := v_ws;
  return new;
end $$;
revoke execute on function public.team_members_guard() from public, anon, authenticated;

-- rows planted through the old check: team members who do not belong to the team's workspace
delete from public.team_members tm
using public.teams t
where t.id = tm.team_id
  and (tm.workspace_id <> t.workspace_id
       or not exists (
         select 1 from public.workspace_members wm where wm.workspace_id = t.workspace_id and wm.user_id = tm.user_id
       ));

-- ─── issue subscriptions: yourself only (admins may unsubscribe anyone) ─────
drop policy if exists "issue_subscribers: create" on public.issue_subscribers;
create policy "issue_subscribers: create" on public.issue_subscribers for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids()) and user_id = (select auth.uid()));

drop policy if exists "issue_subscribers: delete" on public.issue_subscribers;
create policy "issue_subscribers: delete" on public.issue_subscribers for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids())
         and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id)));

-- subscriptions planted for people outside the workspace
delete from public.issue_subscribers s
where not exists (select 1 from public.workspace_members wm where wm.workspace_id = s.workspace_id and wm.user_id = s.user_id);

-- ─── authors act on their views / invite links only while they are members ──
drop policy if exists "views: owner or admin edits" on public.views;
create policy "views: owner or admin edits" on public.views for update to authenticated
  using ((owner_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()))
         or public.is_workspace_admin(workspace_id))
  with check (workspace_id in (select public.my_workspace_ids()));

drop policy if exists "views: owner or admin deletes" on public.views;
create policy "views: owner or admin deletes" on public.views for delete to authenticated
  using ((owner_id = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()))
         or public.is_workspace_admin(workspace_id));

drop policy if exists "invites: admins or inviter revoke" on public.workspace_invites;
create policy "invites: admins or inviter revoke" on public.workspace_invites for delete to authenticated
  using ((invited_by = (select auth.uid()) and workspace_id in (select public.my_workspace_ids()))
         or public.is_workspace_admin(workspace_id));
