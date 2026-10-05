"use client";
/* ─── Locus · client-side session helpers for public pages (onboarding, invites) ─── */

import { supabase } from "@/lib/supabase/client";
import { clearLocalCache } from "@/lib/sync/store";

/**
 * Sign out, drop the local workspace cache, then go to `dest`.
 * `auth.signOut()` keeps the session when the revoke request fails (offline,
 * 5xx), so in that case we fall back to the server route, which clears the
 * auth cookies and lands on /login.
 */
export async function signOutTo(dest: string): Promise<void> {
  await clearLocalCache();
  let failed = false;
  try {
    const { error } = await supabase().auth.signOut();
    failed = Boolean(error);
  } catch {
    failed = true;
  }
  if (!failed) {
    window.location.assign(dest);
    return;
  }
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/auth/signout";
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
