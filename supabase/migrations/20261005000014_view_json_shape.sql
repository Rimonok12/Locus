-- ════════════════════════════════════════════════════════════════════════════
--  Locus · shape of saved views' JSON
--  views.filters / views.display were `jsonb not null`, which still admits the
--  JSON literal null, scalars, and arrays of anything. Any member can write a
--  shared view, and every member's client renders it, so one malformed row
--  could break the Views page for the whole workspace.
--  • filters is an array of objects, each with a string "field" and an array
--    "values" (other keys — id, op — are the client's business)
--  • display is an object
--  Existing rows are normalised first (invalid filter elements are dropped).
-- ════════════════════════════════════════════════════════════════════════════

update public.views set filters = '[]'::jsonb where jsonb_typeof(filters) is distinct from 'array';
update public.views set display = '{}'::jsonb where jsonb_typeof(display) is distinct from 'object';

update public.views v
   set filters = coalesce((
         select jsonb_agg(x.e order by x.n)
         from jsonb_array_elements(v.filters) with ordinality as x(e, n)
         where jsonb_typeof(x.e) = 'object'
           and jsonb_typeof(x.e -> 'field') is not distinct from 'string'
           and jsonb_typeof(x.e -> 'values') is not distinct from 'array'
       ), '[]'::jsonb)
 where exists (
         select 1 from jsonb_array_elements(v.filters) e
         where not (jsonb_typeof(e) = 'object'
                    and jsonb_typeof(e -> 'field') is not distinct from 'string'
                    and jsonb_typeof(e -> 'values') is not distinct from 'array'));

alter table public.views
  add constraint views_filters_is_array check (jsonb_typeof(filters) = 'array'),
  add constraint views_display_is_object check (jsonb_typeof(display) = 'object');

-- Element shape. A trigger rather than a CHECK: constraint expressions need EXECUTE on the
-- functions they call, trigger functions do not, so this one stays private.
create or replace function public.views_json_guard()
returns trigger language plpgsql as $$
begin
  -- a non-array is left to views_filters_is_array (checked after BEFORE triggers)
  if (tg_op = 'INSERT' or new.filters is distinct from old.filters)
     and jsonb_typeof(new.filters) = 'array' and exists (
    select 1 from jsonb_array_elements(new.filters) e
    -- a missing key gives a NULL type: `is not distinct from` counts that as invalid
    where not (jsonb_typeof(e) = 'object'
               and jsonb_typeof(e -> 'field') is not distinct from 'string'
               and jsonb_typeof(e -> 'values') is not distinct from 'array')
  ) then
    raise exception 'Each view filter needs a "field" and a list of "values"' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.views_json_guard() from public, anon, authenticated;

drop trigger if exists views_json_guard on public.views;
create trigger views_json_guard before insert or update on public.views
  for each row execute function public.views_json_guard();
