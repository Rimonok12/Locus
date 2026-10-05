/* ─── Locus · /login — email + password (magic link only when NEXT_PUBLIC_AUTH_EMAILS=on) ─── */

import type { Metadata } from "next";
import LoginForm from "@/components/auth/LoginForm";
import { authErrorFromCode, safeNext } from "@/components/auth/utils";

export const metadata: Metadata = { title: "Log in" };

type Params = { next?: string | string[]; error?: string | string[]; error_code?: string | string[] };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

export default function LoginPage({ searchParams }: { searchParams: Params }) {
  // ?error= carries a short code from /auth/callback and /auth/confirm (link_expired, auth_failed,
  // missing_code, invalid_link). Supabase's own redirects add the more specific ?error_code=
  // (e.g. otp_expired), which wins when present. Both are attacker-controllable, so
  // authErrorFromCode only ever returns fixed copy and never echoes the query text.
  const error = authErrorFromCode(first(searchParams.error_code) ?? first(searchParams.error));
  return <LoginForm next={safeNext(searchParams.next)} initialError={error} />;
}
