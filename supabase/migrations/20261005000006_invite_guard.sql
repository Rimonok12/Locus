-- ════════════════════════════════════════════════════════════════════════════
--  Locus · invites: token, lifetime and creation time are server-owned
--  A client could previously pick a guessable token, a never-expiring
--  expires_at, or a future created_at (to sort first as "the" invite link).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.workspace_invites_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.invited_by  := coalesce(auth.uid(), new.invited_by);
    new.email       := nullif(lower(trim(new.email)), '');
    new.accepted_at := null;
    new.accepted_by := null;
    new.token       := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    new.created_at  := now();
    new.expires_at  := now() + interval '14 days';
  end if;
  return new;
end $$;
revoke execute on function public.workspace_invites_guard() from public, anon, authenticated;

-- cap rows planted before this migration (unbounded, or longer than the promised 14 days)
update public.workspace_invites
   set created_at = least(created_at, now()),
       expires_at = least(coalesce(expires_at, now() + interval '14 days'), least(created_at, now()) + interval '14 days')
 where accepted_at is null
   and (expires_at is null or expires_at > least(created_at, now()) + interval '14 days' or created_at > now());
