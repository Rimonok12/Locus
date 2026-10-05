-- ════════════════════════════════════════════════════════════════════════════
--  Locus · updated_at follows commit order
--  now() is the transaction START time: a transaction that waited on a row lock
--  (or a long multi-row update / cascade) stamped the row older than the write
--  it overwrote, and clients — which drop realtime echoes older than their local
--  row — then kept a stale version. clock_timestamp() inside a BEFORE ROW
--  trigger runs while the row lock is held, so stamps grow in commit order per
--  row. (issues_before_write already does this since 20261005000005.)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  new.id := old.id;
  if auth.uid() is not null then
    new.email := old.email;
  end if;
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  return new;
end $$;

revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.profiles_guard() from public, anon, authenticated;
