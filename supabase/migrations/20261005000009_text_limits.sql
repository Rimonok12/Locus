-- ════════════════════════════════════════════════════════════════════════════
--  Locus · bounded text columns
--  Every member downloads every issue / project / update and keeps them in
--  IndexedDB, and Realtime drops wide fields from records over ~1 MB, so rich
--  text is capped at 200,000 characters (well below that even for multi-byte
--  text). Short descriptions get the limits the UI already enforces.
--  Content limits only apply when the column is written, so existing rows are
--  never truncated and stay editable.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── profile names: clamp at the source, then constrain ─────────────────────
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
    left(v_name, 80),
    left(lower(regexp_replace(split_part(v_name, ' ', 1), '[^a-zA-Z0-9_.-]', '', 'g')), 32),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

update public.profiles set name = left(name, 80) where char_length(name) > 80;
update public.profiles set display_name = left(display_name, 32) where char_length(display_name) > 32;
alter table public.profiles
  add constraint profiles_name_len check (char_length(name) <= 80),
  add constraint profiles_display_name_len check (char_length(display_name) <= 32);

-- ─── content columns ────────────────────────────────────────────────────────
-- A trigger rather than a CHECK: it only fires when the column actually changes,
-- so a legacy row that is already over the limit stays writable (status, assignee…)
-- and nothing has to be truncated. Arguments are (column, max length) pairs.
create or replace function public.enforce_text_limits()
returns trigger language plpgsql as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_col text;
  v_max integer;
  i     integer := 0;
begin
  while i + 1 < tg_nargs loop
    v_col := tg_argv[i];
    v_max := tg_argv[i + 1]::integer;
    i := i + 2;
    if v_old is not null and (v_new -> v_col) is not distinct from (v_old -> v_col) then
      continue;
    end if;
    if char_length(coalesce(v_new ->> v_col, '')) > v_max then
      raise exception 'Text is too long (% characters max)', to_char(v_max, 'FM999,999,999')
        using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.enforce_text_limits() from public, anon, authenticated;

create trigger issues_text_limits before insert or update on public.issues
  for each row execute function public.enforce_text_limits('description', '200000');
create trigger projects_text_limits before insert or update on public.projects
  for each row execute function public.enforce_text_limits('description', '200000', 'summary', '255');
create trigger project_updates_text_limits before insert or update on public.project_updates
  for each row execute function public.enforce_text_limits('body', '200000');
create trigger teams_text_limits before insert or update on public.teams
  for each row execute function public.enforce_text_limits('description', '500');
create trigger labels_text_limits before insert or update on public.labels
  for each row execute function public.enforce_text_limits('description', '240');
create trigger workflow_states_text_limits before insert or update on public.workflow_states
  for each row execute function public.enforce_text_limits('description', '240');
create trigger project_milestones_text_limits before insert or update on public.project_milestones
  for each row execute function public.enforce_text_limits('description', '2000');
create trigger cycles_text_limits before insert or update on public.cycles
  for each row execute function public.enforce_text_limits('description', '2000');
create trigger views_text_limits before insert or update on public.views
  for each row execute function public.enforce_text_limits('description', '2000');
