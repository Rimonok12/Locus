/* ─── Locus · /forgot-password ─── */

import type { Metadata } from "next";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import { safeNext } from "@/components/auth/utils";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage({ searchParams }: { searchParams: { next?: string | string[] } }) {
  return <ForgotPasswordForm next={safeNext(searchParams.next)} />;
}
