/* ─── Locus · auth helpers (pure — safe to import from server and client components) ─── */

/**
 * Only same-origin relative paths are allowed as post-auth destinations:
 * must start with "/", must not be protocol-relative ("//", "/\"), and must not
 * contain whitespace/control characters (browsers strip those, which can turn
 * "/\t/evil.com" into "//evil.com").
 */
export function safeNext(raw: string | string[] | null | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || v.length > 2048) return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\\\u0000-\u001f\u007f]/.test(v)) return null;
  return v;
}

/** Append `?next=` to an auth route when a destination is known. */
export function withNext(path: string, next: string | null | undefined): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

/** Absolute URL of the PKCE callback that lands the user on `next` (client only). */
export function callbackUrl(next: string): string {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

/** Slugs the database refuses (mirrors workspaces_guard in the init migration). */
export const RESERVED_SLUGS = new Set([
  "login", "signup", "logout", "onboarding", "join", "auth", "api", "settings", "forgot-password",
  "reset-password", "invite", "new", "admin", "app", "static", "public", "favicon", "robots", "sitemap", "setup",
]);
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
export const TEAM_KEY_RE = /^[A-Z][A-Z0-9]{0,6}$/;

interface AuthLikeError { message?: string; code?: string; status?: number; reasons?: string[] }

function weakPassword(reasons: string[] | undefined, fallback: string): string {
  if (reasons?.includes("pwned")) return "This password has appeared in a data breach. Please choose a different one.";
  if (reasons?.includes("length")) return "That password is too short.";
  if (reasons?.includes("characters")) return "Use a mix of upper- and lowercase letters, numbers and symbols.";
  return fallback || "That password is too weak. Try a longer one.";
}

/** Turn a Supabase Auth error (or a raw message) into copy a person can act on. */
export function authErrorMessage(err: unknown): string {
  const e = (typeof err === "string" ? { message: err } : (err ?? {})) as AuthLikeError;
  const msg = (e.message ?? "").trim();
  switch (e.code) {
    case "invalid_credentials": return "Incorrect email or password.";
    case "email_not_confirmed": return "Please confirm your email address first. Check your inbox for the link.";
    case "user_already_exists":
    case "email_exists": return "An account with this email already exists.";
    case "weak_password": return weakPassword(e.reasons, msg);
    case "same_password": return "Your new password must be different from your current one.";
    case "over_email_send_rate_limit": return "Too many emails sent. Please wait a minute before trying again.";
    case "over_request_rate_limit": return "Too many attempts. Please wait a minute and try again.";
    case "signup_disabled": return "New sign-ups are currently disabled.";
    case "email_provider_disabled": return "Email sign-in is disabled. Use another sign-in method.";
    case "email_address_invalid": return "Enter a valid email address.";
    case "email_address_not_authorized": return "We can’t send email to this address yet. Try a different address.";
    case "otp_expired": return "That link has expired. Request a new one.";
    case "flow_state_not_found":
    case "flow_state_expired":
    case "bad_code_verifier": return "Open the link in the same browser you requested it from, or request a new one.";
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found": return "Your session has expired. Please start again.";
    case "provider_disabled": return "Google sign-in isn’t enabled for this project yet.";
    case "unexpected_audience": return "Google sign-in is misconfigured: this client ID isn’t authorized in Supabase.";
    case "user_banned": return "This account has been suspended.";
    case "captcha_failed": return "Captcha verification failed. Please try again.";
    case "reauthentication_needed": return "For security, log in again before changing your password.";
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) return "Can’t reach the server. Check your connection and try again.";
  if (/invalid login credentials/i.test(msg)) return "Incorrect email or password.";
  if (/user already registered/i.test(msg)) return "An account with this email already exists.";
  if (/email not confirmed/i.test(msg)) return "Please confirm your email address first. Check your inbox for the link.";
  if (/auth session missing/i.test(msg)) return "Your session has expired. Please start again.";
  if (/code verifier|both auth code and code verifier/i.test(msg)) return "Open the link in the same browser you requested it from, or request a new one.";
  if (/(link|token).*(invalid|expired)|(invalid|expired).*(link|token)/i.test(msg)) return "That link is invalid or has expired. Request a new one.";
  return msg || "Something went wrong. Please try again.";
}

/** Rough password strength (0–4) for the meter under new-password fields. */
export function passwordScore(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: "" };
  if (pw.length < MIN_PASSWORD) return { score: 1, label: `At least ${MIN_PASSWORD} characters` };
  let s = 1;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(pw)).length;
  if (classes >= 2) s++;
  if (classes >= 3 || pw.length >= 14) s++;
  if (pw.length >= 12 && classes >= 3) s++;
  const score = Math.min(4, s) as 1 | 2 | 3 | 4;
  return { score, label: ["", "Weak", "Fair", "Good", "Strong"][score] };
}

/* ─── link-as-button styles (server components can't use the client Button) ─── */

const BTN_BASE =
  "focus-ring inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors";
const BTN_VARIANT = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover shadow-card",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-wash shadow-card",
  ghost: "bg-transparent text-dim hover:bg-wash hover:text-ink",
} as const;
const BTN_SIZE = {
  sm: "h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  lg: "h-10 px-4 text-[14px] gap-2 rounded-lg",
} as const;

export function buttonClass(variant: keyof typeof BTN_VARIANT = "secondary", size: keyof typeof BTN_SIZE = "md", extra = ""): string {
  return `${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${extra}`;
}
