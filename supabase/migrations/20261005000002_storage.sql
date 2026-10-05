-- ════════════════════════════════════════════════════════════════════════════
--  Locus · storage buckets (avatars, issue attachments)
--  Object paths:  avatars/<user_id>/<file>      attachments/<workspace_id>/<file>
--  Both buckets are public-read (paths contain unguessable UUIDs); writes are
--  restricted to the owner (avatars) or to workspace members (attachments).
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  ('attachments', 'attachments', true, 26214400, null)
on conflict (id) do nothing;

create policy "avatars: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner updates" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "attachments: members upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in (select ws::text from public.my_workspace_ids() ws)
  );
create policy "attachments: members delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in (select ws::text from public.my_workspace_ids() ws)
  );
