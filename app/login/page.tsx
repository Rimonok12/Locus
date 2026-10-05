/* ─── Locus · /login — email + password (magic link when auth emails are enabled) ─── */

import type { Metadata } from "next";
import LoginForm from "@/components/auth/LoginForm";
import { authErrorFromCode, safeNext } from "@/components/auth/utils";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage({ searchParams }: { searchParams: { next?: string | string[]; error?: string | string[] } }) {
  const raw = Array.isArray(searchParams.error) ? searchParams.error[0] : searchParams.error;
  // ?error= is attacker-controllable: only fixed copy for recognised codes ever reaches the card.
  const error = authErrorFromCode(raw?.trim() || null);
  return <LoginForm next={safeNext(searchParams.next)} initialError={error} />;
}
