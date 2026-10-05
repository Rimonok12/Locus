"use client";
/* ─── Locus · client-side session helpers for public pages (onboarding, invites) ─── */

import { supabase } from "@/lib/supabase/client";
import { clearLocalCache, teardown } from "@/lib/sync/store";

/**
 * Sign this device out, drop the local workspace cache, then go to `dest`.
 * Mirrors the store's own `signOut()` (which always lands on /login):
 * - `scope: "local"` ends only this browser's session — other devices stay signed in;
 * - `teardown()` stops realtime/persistence if a workspace session is live in this tab
 *   (a no-op on public pages), so nothing is written back after the cache is cleared;
 * - `auth.signOut()` keeps the session when the request fails (offline, 5xx), so in that
 *   case the server route clears the auth cookies and redirects to `dest` itself.
 */
export async function signOutTo(dest: string): Promise<void> {
  teardown();
  await clearLocalCache();
  let ok = false;
  try {
    ok = !(await supabase().auth.signOut({ scope: "local" })).error;
  } catch {
    /* fall back to the server route */
  }
  if (ok) {
    window.location.assign(dest);
    return;
  }
  const form = document.createElement("form");
  form.method = "post";
  // the route only honours same-origin relative paths (lib/safe-next) and falls back to /login
  form.action = `/auth/signout?next=${encodeURIComponent(dest)}`;
  form.hidden = true;
  document.body.appendChild(form);
  form.submit();
}

/** Accept an invite by token. Resolves to the workspace slug, or throws a readable Error. */
export async function acceptInvite(token: string, fallbackSlug: string): Promise<string> {
  let res;
  try {
    res = await supabase().rpc("accept_invite", { p_token: token });
  } catch (e) {
    throw new Error(inviteErrorMessage(e instanceof Error ? e.message : String(e)));
  }
  if (res.error) throw new Error(inviteErrorMessage(res.error.message));
  return (typeof res.data === "string" && res.data) || fallbackSlug;
}

export function inviteErrorMessage(message: string): string {
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return "Can’t reach the server. Check your connection and try again.";
  }
  if (/not authenticated|jwt expired/i.test(message)) return "Your session has expired. Log in again to continue.";
  return message || "Couldn’t join this workspace. Please try again.";
}
