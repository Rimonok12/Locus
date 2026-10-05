-- ════════════════════════════════════════════════════════════════════════════
--  Locus · favorites cleanup
--  favorites.target_id is polymorphic (issue / project / cycle / view / team),
--  so it cannot carry a foreign key. Remove favorites when their target goes.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.favorites_cleanup()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.favorites
  where target_id = old.id
    and kind = case tg_table_name
      when 'issues' then 'issue'
      when 'projects' then 'project'
      when 'cycles' then 'cycle'
      when 'views' then 'view'
      when 'teams' then 'team'
    end;
  return old;
end $$;

create trigger issues_favorites_cleanup after delete on public.issues
  for each row execute function public.favorites_cleanup();
create trigger projects_favorites_cleanup after delete on public.projects
  for each row execute function public.favorites_cleanup();
create trigger cycles_favorites_cleanup after delete on public.cycles
  for each row execute function public.favorites_cleanup();
create trigger views_favorites_cleanup after delete on public.views
  for each row execute function public.favorites_cleanup();
create trigger teams_favorites_cleanup after delete on public.teams
  for each row execute function public.favorites_cleanup();

revoke execute on function public.favorites_cleanup() from public, anon;
