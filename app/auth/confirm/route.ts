/* ─── Locus · token-hash verification (email templates using {{ .TokenHash }}) ───
   Failures go to /login?error=<code> (lib/auth-redirect): Supabase messages are never relayed. */

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { sameOriginUrl } from "@/lib/safe-next";
import { authErrorCode, loginErrorUrl, providerErrorCode, type AuthErrorLike } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";

const OTP_TYPES: readonly string[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const type = rawType && OTP_TYPES.includes(rawType) ? (rawType as EmailOtpType) : null;
  const next = type === "recovery" ? "/reset-password" : url.searchParams.get("next");

  if (!token_hash || !type) {
    const providerError = providerErrorCode(url.searchParams);
    return NextResponse.redirect(loginErrorUrl(url.origin, providerError ?? "invalid_link", next));
  }

  let failure: AuthErrorLike | null;
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    failure = error;
  } catch (e) {
    failure = { name: e instanceof Error ? e.name : null, status: 0 };
  }
  if (!failure) return NextResponse.redirect(sameOriginUrl(next, url.origin));

  console.warn("[auth/confirm] verification failed:", type, failure.code || failure.name || "-", failure.status ?? "-");
  return NextResponse.redirect(loginErrorUrl(url.origin, authErrorCode(failure), next));
}
