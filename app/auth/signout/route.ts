/* ─── Locus · server-side sign out (POST) ─── */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\s\u0000-\u001f]/.test(next)) return "/login";
  return next;
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  return NextResponse.redirect(new URL(next, request.url), { status: 303 });
}
