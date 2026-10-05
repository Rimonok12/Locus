/* ─── Locus · server-side sign out (POST) ─── */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOriginUrl } from "@/lib/safe-next";

export async function POST(request: NextRequest) {
  const supabase = createClient();
  // this device only: logging out must not end the user's sessions elsewhere
  await supabase.auth.signOut({ scope: "local" });
  const url = new URL(request.url);
  return NextResponse.redirect(sameOriginUrl(url.searchParams.get("next"), url.origin, "/login"), { status: 303 });
}
