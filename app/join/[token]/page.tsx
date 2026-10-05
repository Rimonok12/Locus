/* ─── Locus · /join/:token — invite landing (works signed in or out) ─── */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CloudOff, Link2Off } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AuthCard, AuthIcon } from "@/components/auth/AuthCard";
import JoinInvite, { WorkspaceTile } from "@/components/auth/JoinInvite";
import { buttonClass, withNext } from "@/components/auth/utils";

export const metadata: Metadata = { title: "Join workspace" };
export const dynamic = "force-dynamic";

interface InviteInfo {
  workspace_name: string;
  workspace_slug: string;
  inviter_name: string;
  email: string | null;
  valid: boolean;
  already_member: boolean;
}

/** Invite tokens are hex strings; anything else can't match, so skip the round trip. */
const TOKEN_RE = /^[A-Za-z0-9_-]{8,200}$/;

export default async function JoinPage({ params }: { params: { token: string } }) {
  const token = params.token ?? "";
  const here = `/join/${encodeURIComponent(token)}`;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let invite: InviteInfo | undefined;
  let lookupFailed = false;
  if (TOKEN_RE.test(token)) {
    const { data, error } = await supabase.rpc("get_invite", { p_token: token });
    if (error) lookupFailed = true;
    else invite = (data as InviteInfo[] | null)?.[0];
  }

  if (user && invite?.already_member) redirect(`/${invite.workspace_slug}`);

  if (lookupFailed) {
    return (
      <AuthCard
        icon={<AuthIcon tone="danger"><CloudOff size={19} /></AuthIcon>}
        title="We couldn’t load this invite"
        subtitle="Something went wrong while checking the link. Give it another try in a moment."
      >
        <div className="space-y-2.5">
          <a href={here} className={buttonClass("primary", "lg", "w-full")}>Try again</a>
          <a href="/" className={buttonClass("secondary", "lg", "w-full")}>Go to Locus</a>
        </div>
      </AuthCard>
    );
  }

  if (!invite || !invite.valid) {
    return (
      <AuthCard
        icon={<AuthIcon tone="danger"><Link2Off size={19} /></AuthIcon>}
        title="This invite link isn’t valid"
        subtitle="It may have expired, been revoked or already been used. Ask a workspace admin to send you a new one."
      >
        <a href="/" className={buttonClass("primary", "lg", "w-full")}>Go to Locus</a>
      </AuthCard>
    );
  }

  const inviter = invite.inviter_name.trim();

  if (!user) {
    return (
      <AuthCard
        icon={<WorkspaceTile name={invite.workspace_name} />}
        title={<>{inviter || "A teammate"} invited you to {invite.workspace_name}</>}
        subtitle="Locus is a keyboard-first, real-time issue tracker. Log in or create an account to join the workspace."
      >
        <div className="space-y-2.5">
          {invite.email && (
            <p className="pb-1 text-center text-[12.5px] leading-relaxed text-dim">
              This invite is for <span className="break-all font-medium text-ink">{invite.email}</span>.
            </p>
          )}
          <a href={withNext("/login", here)} className={buttonClass("primary", "lg", "w-full")}>Log in to join</a>
          <a href={withNext("/signup", here)} className={buttonClass("secondary", "lg", "w-full")}>Create account</a>
        </div>
      </AuthCard>
    );
  }

  return (
    <JoinInvite
      token={token}
      workspaceName={invite.workspace_name}
      workspaceSlug={invite.workspace_slug}
      inviterName={inviter}
      inviteEmail={invite.email}
      userEmail={user.email ?? ""}
    />
  );
}
