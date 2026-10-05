/* ─── Locus · "/" — signed-in users go to their workspace, everyone else sees the landing page ─── */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Landing from "@/components/marketing/Landing";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <Landing />;

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(slug)")
    .eq("user_id", user.id);
  const slugs = (memberships ?? [])
    .map((m) => (m.workspaces as unknown as { slug: string } | null)?.slug)
    .filter(Boolean) as string[];
  if (!slugs.length) redirect("/onboarding");

  const last = cookies().get("locus_ws")?.value;
  redirect(`/${last && slugs.includes(last) ? last : slugs[0]}`);
}
