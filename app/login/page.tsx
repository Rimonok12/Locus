/* ─── Locus · /login — email + password (magic link when auth emails are enabled) ─── */

import type { Metadata } from "next";
import LoginForm from "@/components/auth/LoginForm";
import { safeNext } from "@/components/auth/utils";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage({ searchParams }: { searchParams: { next?: string | string[]; error?: string | string[] } }) {
  const raw = Array.isArray(searchParams.error) ? searchParams.error[0] : searchParams.error;
  const error = raw?.trim() ? raw.trim().slice(0, 300) : null;
  return <LoginForm next={safeNext(searchParams.next)} initialError={error} />;
}
