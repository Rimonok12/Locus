/* ─── Locus · public environment ─── */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Set NEXT_PUBLIC_AUTH_EMAILS=on once custom SMTP is configured in Supabase. Supabase's built-in
 *  mailer only delivers to the project's own team members, so email-link sign-in stays hidden until then. */
export const authEmailsEnabled = process.env.NEXT_PUBLIC_AUTH_EMAILS === "on";

/** Absolute site origin used for auth redirects (falls back to the request origin client-side). */
export function siteUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3456")
  );
}
