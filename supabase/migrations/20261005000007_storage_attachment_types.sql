-- ════════════════════════════════════════════════════════════════════════════
--  Locus · storage: raster images only
--  Both buckets are public-read, so anything stored is served with its declared
--  content type. Only raster image types are ever uploaded by the app (editor
--  paste/drop, workspace logo, avatars); SVG / HTML and other active content is
--  refused. Attachment URLs are capability URLs (unguessable paths) and stay
--  readable after the issue that embedded them is deleted.
-- ════════════════════════════════════════════════════════════════════════════

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'],
       file_size_limit    = 20971520   -- 20 MB, matches the editor's limit (logos are capped at 2 MB client-side)
 where id = 'attachments';

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']
 where id = 'avatars';
