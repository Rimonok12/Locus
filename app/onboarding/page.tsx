/* ─── Locus · /onboarding — join a pending invite or create the first workspace ─── */

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import Onboarding, { type PendingInvite } from "@/components/auth/Onboarding";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: { new?: string | string[] } }) {
  const user = await getUser();
  if (!user) redirect("/login?next=/onboarding");

  const supabase = createClient();
  // Both reads run with the user's session; invites are fetched here so the page renders complete (no layout shift).
  const [memberships, invites] = await Promise.all([
    supabase.from("workspace_members").select("workspace_id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.rpc("my_pending_invites"),
  ]);

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "locus";
  const meta = (user.user_metadata ?? {}) as { name?: unknown; full_name?: unknown };
  const name = typeof meta.name === "string" ? meta.name : typeof meta.full_name === "string" ? meta.full_name : "";
  const isNew = (Array.isArray(searchParams.new) ? searchParams.new[0] : searchParams.new) === "1";

  return (
    <Onboarding
      email={user.email ?? ""}
      name={name}
      host={host}
      isNew={isNew}
      canGoBack={isNew || (memberships.count ?? 0) > 0}
      initialInvites={invites.error ? null : ((invites.data ?? []) as PendingInvite[])}
    />
  );
}
