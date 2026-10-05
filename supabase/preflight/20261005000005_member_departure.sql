-- ════════════════════════════════════════════════════════════════════════════
--  Locus · preflight for 20261005000005_member_departure.sql
--  NOT a migration (the runner only reads supabase/migrations). Run it in the
--  Supabase SQL editor BEFORE `npm run db:migrate` on a database where 005 has
--  not been applied yet.
--
--  005's backfill unassigns issues whose assignee left the workspace; every row
--  it touches goes through issues_before_write, which rejects an issue whose
--  workflow state or cycle belongs to another team. Migration 001 let a member
--  move a state or cycle to another team, so if such an issue ALSO has a
--  departed assignee, 005 raises and the whole file rolls back.
--
--  Step 1 must return 0 rows. If it returns rows, run step 2 (the repair
--  20261005000013 applies later, plus 005's own unassignment of departed
--  members: before 005 every issue write re-checks the assignee, so the two
--  must happen in one statement), then step 1 again, then migrate.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── step 1: issues that would abort 005 ────────────────────────────────────
select i.id, i.team_id, i.state_id, i.cycle_id, i.assignee_id
from public.issues i
where i.assignee_id is not null
  and not exists (
    select 1 from public.workspace_members wm where wm.workspace_id = i.workspace_id and wm.user_id = i.assignee_id)
  and (not exists (select 1 from public.workflow_states s where s.id = i.state_id and s.team_id = i.team_id)
       or (i.cycle_id is not null
           and not exists (select 1 from public.cycles c where c.id = i.cycle_id and c.team_id = i.team_id)));

-- ─── step 2 (only if step 1 returned rows): put those issues back on their own team's state / no cycle ───
-- begin;
--
-- insert into public.workflow_states (workspace_id, team_id, name, type, color, position)
-- select t.workspace_id, t.id, 'Todo', 'unstarted', '#e2e2e2', 0
-- from public.teams t
-- where exists (select 1 from public.issues i where i.team_id = t.id)
--   and not exists (select 1 from public.workflow_states s where s.team_id = t.id);
--
-- update public.issues i
--    set state_id = case
--          when exists (select 1 from public.workflow_states s where s.id = i.state_id and s.team_id = i.team_id) then i.state_id
--          else coalesce(
--            (select s2.id from public.workflow_states s2
--              where s2.team_id = i.team_id
--                and s2.type = (select s.type from public.workflow_states s where s.id = i.state_id)
--              order by s2.position limit 1),
--            (select s3.id from public.workflow_states s3 where s3.team_id = i.team_id order by s3.position limit 1))
--        end,
--        cycle_id = case
--          when i.cycle_id is null
--            or exists (select 1 from public.cycles c where c.id = i.cycle_id and c.team_id = i.team_id) then i.cycle_id
--          else null
--        end,
--        assignee_id = case
--          when i.assignee_id is null
--            or exists (select 1 from public.workspace_members wm
--                       where wm.workspace_id = i.workspace_id and wm.user_id = i.assignee_id) then i.assignee_id
--          else null
--        end
--  where not exists (select 1 from public.workflow_states s where s.id = i.state_id and s.team_id = i.team_id)
--     or (i.cycle_id is not null
--         and not exists (select 1 from public.cycles c where c.id = i.cycle_id and c.team_id = i.team_id));
--
-- commit;
