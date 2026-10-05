/* ─── Locus · workspace layout: server-side auth + membership gate ─── */

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkspaceApp from "@/components/app/WorkspaceApp";
import type { Profile, Workspace } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Mirrors the workspaces.slug check constraint. Probes like /robots.txt or /apple-touch-icon.png
 *  (the middleware skips those extensions) 404 here without any auth or database round trip. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/i;

export default async function WorkspaceLayout({ params, children }: { params: { slug: string }; children: React.ReactNode }) {
  if (!SLUG_RE.test(params.slug)) notFound();
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/${params.slug}`);

  const [{ data: workspace }, { data: profile }] = await Promise.all([
    supabase.from("workspaces").select("*").eq("slug", params.slug.toLowerCase()).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  ]);
  if (!workspace) notFound(); // RLS hides workspaces you're not a member of
  const me: Profile = profile ?? {
    id: user.id, email: user.email ?? "", name: user.email?.split("@")[0] ?? "", display_name: "",
    avatar_url: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };

  return (
    <>
      <WorkspaceApp workspace={workspace as Workspace} profile={me} />
      {children}
    </>
  );
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  if (!SLUG_RE.test(params.slug)) return { title: "Page not found" };
  const supabase = createClient();
  const { data } = await supabase.from("workspaces").select("name").eq("slug", params.slug.toLowerCase()).maybeSingle();
  return { title: data?.name ?? "Workspace" };
}
