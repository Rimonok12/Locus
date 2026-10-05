/* ─── Locus · /reset-password — reached from the recovery email (needs the recovery session) ─── */

import type { Metadata } from "next";
import { Link2Off } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { AuthCard, AuthIcon, AuthLink } from "@/components/auth/AuthCard";
import { buttonClass } from "@/components/auth/utils";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const user = await getUser();
  if (!user) {
    return (
      <AuthCard
        icon={<AuthIcon tone="danger"><Link2Off size={19} /></AuthIcon>}
        title="This reset link has expired"
        subtitle="Password reset links work once and expire after an hour. Request a new one to continue."
        footer={<p>Remembered your password? <AuthLink href="/login">Log in</AuthLink></p>}
      >
        <a href="/forgot-password" className={buttonClass("primary", "lg", "w-full")}>Request a new link</a>
      </AuthCard>
    );
  }
  return <ResetPasswordForm email={user.email ?? ""} />;
}
