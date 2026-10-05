-- ════════════════════════════════════════════════════════════════════════════
--  Locus · member departure
--  When someone leaves or is removed from a workspace:
--    • issues they were assigned become unassigned, projects they led lose
--      their lead, they leave every project's member list and stop following
--      issues, and their notifications for that workspace are dropped
--    • when someone ELSE removed them, every invite they could use to rejoin is
--      revoked: shared links (rotated), anything they minted, and pending email
--      invites addressed to them
--  Membership checks on issues.assignee_id / projects.lead_id now only run when
--  the value changes, so a stale value can never block unrelated writes or the
--  FK `on delete set null` cascades (label / cycle / milestone / project delete).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.workspace_members_after_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_email text;
begin
  -- cascades from a deleted workspace or a deleted user: the FKs handle those rows
  if not exists (select 1 from public.workspaces where id = old.workspace_id)
     or not exists (select 1 from public.profiles where id = old.user_id) then
    return old;
  end if;

  update public.issues set assignee_id = null
  where workspace_id = old.workspace_id and assignee_id = old.user_id;

  update public.projects
     set lead_id = case when lead_id = old.user_id then null else lead_id end,
         member_ids = array_remove(member_ids, old.user_id)
   where workspace_id = old.workspace_id
     and (lead_id = old.user_id or old.user_id = any (member_ids));

  delete from public.issue_subscribers where workspace_id = old.workspace_id and user_id = old.user_id;
  delete from public.notifications where workspace_id = old.workspace_id and user_id = old.user_id;

  -- leaving voluntarily keeps the workspace's shared link alive
  if auth.uid() is distinct from old.user_id then
    select lower(email) into v_email from auth.users where id = old.user_id;
    delete from public.workspace_invites
    where workspace_id = old.workspace_id
      and accepted_at is null
      and (email is null                  -- shared, reusable links: rotate
           or invited_by = old.user_id    -- anything the removed member minted (alternate addresses)
           or lower(email) = v_email);    -- pending email invites addressed to them
  end if;
  return old;
end $$;

drop trigger if exists workspace_members_after_delete on public.workspace_members;
create trigger workspace_members_after_delete after delete on public.workspace_members
  for each row execute function public.workspace_members_after_delete();
revoke execute on function public.workspace_members_after_delete() from public, anon, authenticated;

-- ─── projects: lead membership checked only when the lead changes ───────────
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

  if new.lead_id is not null
     and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id)
     and not exists (
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

-- ─── issues: assignee membership checked only when the assignee changes ─────
-- (body otherwise identical to the init migration; updated_at now uses
--  clock_timestamp(), see 20261005000008_updated_at_clock.sql)
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

  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (
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
    -- write time, not transaction start: stamps follow commit order per row (row lock is held here)
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;

-- ─── backfill rows orphaned by members who left before this migration ───────
update public.issues i set assignee_id = null
where i.assignee_id is not null and not exists (
  select 1 from public.workspace_members wm where wm.workspace_id = i.workspace_id and wm.user_id = i.assignee_id
);

update public.projects p
   set lead_id = case when exists (
         select 1 from public.workspace_members wm where wm.workspace_id = p.workspace_id and wm.user_id = p.lead_id
       ) then p.lead_id end,
       member_ids = coalesce(array(
         select m from unnest(p.member_ids) m
         where exists (select 1 from public.workspace_members wm where wm.workspace_id = p.workspace_id and wm.user_id = m)
       ), '{}')
 where (p.lead_id is not null and not exists (
          select 1 from public.workspace_members wm where wm.workspace_id = p.workspace_id and wm.user_id = p.lead_id))
    or exists (
          select 1 from unnest(p.member_ids) m
          where not exists (select 1 from public.workspace_members wm where wm.workspace_id = p.workspace_id and wm.user_id = m));

delete from public.issue_subscribers s
where not exists (select 1 from public.workspace_members wm where wm.workspace_id = s.workspace_id and wm.user_id = s.user_id);

delete from public.notifications n
where not exists (select 1 from public.workspace_members wm where wm.workspace_id = n.workspace_id and wm.user_id = n.user_id);

revoke execute on function public.projects_before_write() from public, anon, authenticated;
revoke execute on function public.issues_before_write() from public, anon, authenticated;
