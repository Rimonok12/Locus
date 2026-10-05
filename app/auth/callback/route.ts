/* ─── Locus · PKCE code exchange (email confirmation, magic links, recovery) ───
   Failures go to /login?error=<code> (lib/auth-redirect): provider / Supabase messages are never
   relayed to the page — they are free text a third party controls. */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOriginUrl } from "@/lib/safe-next";
import { authErrorCode, loginErrorUrl, providerErrorCode, type AuthErrorLike } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  const providerError = providerErrorCode(url.searchParams);
  if (providerError) {
    // the query is attacker-controlled: log only a short code-shaped token
    const raw = url.searchParams.get("error_code") || url.searchParams.get("error") || "";
    console.warn("[auth/callback] provider error:", raw.replace(/[^\w-]/g, "").slice(0, 64) || "-");
    return NextResponse.redirect(loginErrorUrl(url.origin, providerError, next));
  }
  if (!code) return NextResponse.redirect(loginErrorUrl(url.origin, "missing_code", next));

  let failure: AuthErrorLike | null;
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failure = error;
  } catch (e) {
    failure = { name: e instanceof Error ? e.name : null, status: 0 };
  }
  if (!failure) return NextResponse.redirect(sameOriginUrl(next, url.origin));

  console.warn("[auth/callback] code exchange failed:", failure.code || failure.name || "-", failure.status ?? "-");
  return NextResponse.redirect(loginErrorUrl(url.origin, authErrorCode(failure), next));
}
