-- ════════════════════════════════════════════════════════════════════════════
--  Locus · function privileges (keep this the LAST migration that creates or
--  replaces functions, or repeat the revoke in the new migration)
--  Supabase's default privileges give anon and authenticated their own EXECUTE
--  grant on every function created in public, so the init migration's
--  `revoke … from public, anon` left authenticated able to call internal
--  SECURITY DEFINER helpers (notify_user, subscribe_user, _create_team) through
--  /rpc — forging notifications, squatting team keys in other workspaces.
--  Trigger functions are not checked for EXECUTE when they fire, and nested
--  calls inside SECURITY DEFINER functions run as the owner, so revoking
--  everything and re-granting the client-facing allow-list is safe.
-- ════════════════════════════════════════════════════════════════════════════

revoke execute on all functions in schema public from public, anon, authenticated;

-- used by RLS policies / non-definer triggers (evaluated as the caller)
grant execute on function public.my_workspace_ids()                         to authenticated;
grant execute on function public.is_workspace_member(uuid)                  to authenticated;
grant execute on function public.is_workspace_admin(uuid)                   to authenticated;
grant execute on function public.shares_workspace_with(uuid)                to authenticated;
grant execute on function public._keep_author(uuid)                         to authenticated;
-- RPCs the app calls
grant execute on function public.create_workspace(text, text, text, text)   to authenticated;
grant execute on function public.create_team(uuid, text, text, text)        to authenticated;
grant execute on function public.accept_invite(text)                        to authenticated;
grant execute on function public.get_invite(text)                           to anon, authenticated;
grant execute on function public.my_pending_invites()                       to authenticated;
grant execute on function public.delete_workflow_state(uuid, uuid)          to authenticated;
grant execute on function public.reorder_issues(uuid[], double precision[]) to authenticated;

-- Functions created later by the migration role are no longer auto-granted to the API roles.
-- (PUBLIC's EXECUTE is a global default that cannot be revoked per schema: every new
--  function must still `revoke execute on function … from public, anon, authenticated`.)
alter default privileges in schema public revoke execute on functions from anon, authenticated;
