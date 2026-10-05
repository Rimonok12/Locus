"use client";
/* ─── Locus · accept an invite link while signed in ─── */

import { useState } from "react";
import { ArrowRight, LogOut } from "lucide-react";
import { Button } from "@/components/primitives/controls";
import { AuthCard, FormAlert } from "./AuthCard";
import { acceptInvite, signOutTo } from "./session";
import { withNext } from "./utils";

/** Workspace initial in an accent tile — the invite's "logo". */
export function WorkspaceTile({ name }: { name: string }) {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-[18px] font-semibold text-accent-ink shadow-card">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export default function JoinInvite({
  token, workspaceName, workspaceSlug, inviterName, inviteEmail, userEmail,
}: {
  token: string;
  workspaceName: string;
  workspaceSlug: string;
  inviterName: string;
  inviteEmail: string | null;
  userEmail: string;
}) {
  const [joining, setJoining] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = `/join/${encodeURIComponent(token)}`;
  const mismatch = Boolean(inviteEmail && userEmail && inviteEmail.toLowerCase() !== userEmail.toLowerCase());

  async function join() {
    if (joining || switching) return;
    setJoining(true);
    setError(null);
    try {
      const slug = await acceptInvite(token, workspaceSlug);
      window.location.assign(`/${slug}`);
    } catch (e) {
      setJoining(false);
      setError(e instanceof Error ? e.message : "Couldn’t join this workspace.");
    }
  }

  async function switchAccount() {
    if (switching || joining) return;
    setSwitching(true);
    setError(null);
    await signOutTo(withNext("/login", here));
  }

  return (
    <AuthCard
      icon={<WorkspaceTile name={workspaceName} />}
      title={<>Join {workspaceName}</>}
      subtitle={<>{inviterName ? <span className="font-medium text-ink">{inviterName}</span> : "A teammate"} invited you to collaborate on Locus.</>}
      footer={
        !mismatch && (
          <p>
            Not {userEmail || "you"}?{" "}
            <button
              type="button"
              onClick={switchAccount}
              disabled={switching || joining}
              className="focus-ring rounded font-medium text-ink underline-offset-[3px] hover:text-accent hover:underline disabled:opacity-50"
            >
              {switching ? "Logging out…" : "Switch account"}
            </button>
          </p>
        )
      }
    >
      <div className="space-y-3">
        {mismatch ? (
          <>
            <FormAlert tone="info">
              This invite was sent to <span className="font-medium">{inviteEmail}</span>, but you’re logged in as{" "}
              <span className="font-medium">{userEmail}</span>. Log in with the invited address to accept it.
            </FormAlert>
            {error && <FormAlert>{error}</FormAlert>}
            <Button type="button" variant="primary" size="lg" className="w-full" icon={<LogOut size={15} />} loading={switching} onClick={switchAccount}>
              Switch account
            </Button>
          </>
        ) : (
          <>
            <p className="text-center text-[13px] leading-relaxed text-dim">
              You’ll join as <span className="font-medium text-ink">{userEmail}</span>.
            </p>
            {error && <FormAlert>{error}</FormAlert>}
            <Button type="button" variant="primary" size="lg" className="w-full" loading={joining} disabled={switching} onClick={join} autoFocus>
              Join workspace <ArrowRight size={15} />
            </Button>
          </>
        )}
      </div>
    </AuthCard>
  );
}
