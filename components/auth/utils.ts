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

const LINK_ERROR = "That link is invalid or has expired. Request a new one.";
const SAME_BROWSER = "Open the link in the same browser you requested it from, or request a new one.";
const SESSION_EXPIRED = "Your session has expired. Please start again.";
const BAD_CREDENTIALS = "Incorrect email or password.";
const UNCONFIRMED = "Please confirm your email address first. Check your inbox for the link.";
const EMAIL_TAKEN = "An account with this email already exists.";

/** Supabase Auth error codes → copy. (weak_password is handled separately: it needs `reasons`.) */
const CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: BAD_CREDENTIALS,
  email_not_confirmed: UNCONFIRMED,
  user_already_exists: EMAIL_TAKEN,
  email_exists: EMAIL_TAKEN,
  same_password: "Your new password must be different from your current one.",
  over_email_send_rate_limit: "Too many emails sent. Please wait a minute before trying again.",
  over_request_rate_limit: "Too many attempts. Please wait a minute and try again.",
  signup_disabled: "New sign-ups are currently disabled.",
  email_provider_disabled: "Email sign-in is disabled. Use another sign-in method.",
  email_address_invalid: "Enter a valid email address.",
  email_address_not_authorized: "Email delivery isn’t set up for this app yet, so we can’t email this address. Log in with your password instead.",
  otp_expired: "That link has expired. Request a new one.",
  flow_state_not_found: SAME_BROWSER,
  flow_state_expired: SAME_BROWSER,
  bad_code_verifier: SAME_BROWSER,
  session_not_found: SESSION_EXPIRED,
  session_expired: SESSION_EXPIRED,
  refresh_token_not_found: SESSION_EXPIRED,
  provider_disabled: "This sign-in method isn’t enabled. Log in with your email and password.",
  unexpected_audience: "This sign-in method is misconfigured. Log in with your email and password.",
  user_banned: "This account has been suspended.",
  captcha_failed: "Captcha verification failed. Please try again.",
  reauthentication_needed: "For security, log in again before changing your password.",
};

/**
 * Codes that only reach /login through a redirect (?error=<code>) from the auth callback /
 * confirm routes or the identity provider — never from an in-form request.
 */
const LINK_CODES: Record<string, string> = {
  missing_code: LINK_ERROR,
  invalid_link: LINK_ERROR,
  unknown: LINK_ERROR,
  otp_disabled: LINK_ERROR,
  bad_oauth_state: LINK_ERROR,
  bad_oauth_callback: LINK_ERROR,
  access_denied: "Sign-in was cancelled. Try again.",
};

const AUTH_CODE_RE = /^[a-z_]{1,64}$/;

/** Own-property lookup, so codes like "constructor" / "__proto__" never hit Object.prototype. */
function lookup(table: Record<string, string>, key: string | undefined): string | null {
  return key && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

/** Recognised raw Supabase messages → fixed copy (null when nothing matches). */
function messagePattern(msg: string): string | null {
  if (!msg) return null;
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) return "Can’t reach the server. Check your connection and try again.";
  if (/invalid login credentials/i.test(msg)) return BAD_CREDENTIALS;
  if (/user already registered/i.test(msg)) return EMAIL_TAKEN;
  if (/email not confirmed/i.test(msg)) return UNCONFIRMED;
  if (/auth session missing/i.test(msg)) return SESSION_EXPIRED;
  if (/code verifier|both auth code and code verifier/i.test(msg)) return SAME_BROWSER;
  if (/(link|token).*(invalid|expired)|(invalid|expired).*(link|token)/i.test(msg)) return LINK_ERROR;
  return null;
}

/** Turn a Supabase Auth error (or a raw message) into copy a person can act on. */
export function authErrorMessage(err: unknown): string {
  const e = (typeof err === "string" ? { message: err } : (err ?? {})) as AuthLikeError;
  const msg = (e.message ?? "").trim();
  if (e.code === "weak_password") return weakPassword(e.reasons, msg);
  return lookup(CODE_MESSAGES, e.code) ?? messagePattern(msg) ?? (msg || "Something went wrong. Please try again.");
}

/**
 * Copy for a `/login?error=` value. The parameter is attacker-controllable, so this only ever
 * returns fixed strings: known codes map to their copy, anything else (unknown codes, or free
 * text from old links) becomes the generic link error. Null when there is no error.
 */
export function authErrorFromCode(code: string | null | undefined): string | null {
  const c = code?.trim();
  if (!c) return null;
  if (AUTH_CODE_RE.test(c)) return lookup(CODE_MESSAGES, c) ?? lookup(LINK_CODES, c) ?? LINK_ERROR;
  // Not code-shaped (a legacy free-text description): classify it, never echo it.
  return c.length <= 300 ? messagePattern(c) ?? LINK_ERROR : LINK_ERROR;
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
