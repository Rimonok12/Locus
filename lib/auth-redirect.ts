/* ─── Locus · auth redirect errors (pure: safe in route handlers, middleware and the client) ───
   /auth/callback and /auth/confirm send failures to `/login?error=<code>`. Provider and Supabase
   messages are free text a third party controls (and they leak implementation detail), so they
   are never relayed: every failure is classified into one of the short codes below, and /login
   maps the code to fixed copy (components/auth/utils authErrorFromCode). */

import { safeNext } from "@/lib/safe-next";

/** Every value the auth routes may put in `/login?error=`. */
export const AUTH_REDIRECT_ERRORS = [
  /** the email link expired or was already used (Supabase answers otp_expired for both) */
  "link_expired",
  /** the link is malformed, for an unknown flow, or was rejected for another 4xx reason */
  "invalid_link",
  /** the auth server failed, was unreachable or rate-limited — retrying later can work */
  "auth_failed",
  /** /auth/callback was opened without a code (or a provider error) in the query */
  "missing_code",
  /**
   * A PKCE link opened in a different browser / device than the one that requested it (the code
   * verifier cookie is missing). This is Supabase's own code, already mapped by /login to
   * "open the link in the same browser you requested it from"; unknown codes there fall back to
   * the generic link copy, so it degrades gracefully.
   */
  "bad_code_verifier",
] as const;

export type AuthRedirectError = (typeof AUTH_REDIRECT_ERRORS)[number];

/** Narrow a `?error=` value to a known code (null for anything else, e.g. legacy free text). */
export function asAuthRedirectError(raw: string | null | undefined): AuthRedirectError | null {
  const v = raw?.trim();
  return v && (AUTH_REDIRECT_ERRORS as readonly string[]).includes(v) ? (v as AuthRedirectError) : null;
}

/** The parts of a Supabase AuthError (or a provider redirect) that classification reads. */
export interface AuthErrorLike {
  code?: string | null;
  status?: number | null;
  name?: string | null;
}

const EXPIRED = new Set(["otp_expired", "flow_state_expired"]);
const WRONG_BROWSER = new Set(["bad_code_verifier", "flow_state_not_found", "pkce_code_verifier_not_found"]);
const RETRYABLE = new Set(["over_request_rate_limit", "over_email_send_rate_limit", "request_timeout", "unexpected_failure"]);

/** Classify a failed exchangeCodeForSession / verifyOtp (or a thrown value) into a redirect code. */
export function authErrorCode(err: AuthErrorLike | null | undefined): AuthRedirectError {
  const code = typeof err?.code === "string" ? err.code : "";
  const status = typeof err?.status === "number" ? err.status : 0;
  if (EXPIRED.has(code)) return "link_expired";
  if (WRONG_BROWSER.has(code) || err?.name === "AuthPKCECodeVerifierMissingError") return "bad_code_verifier";
  if (RETRYABLE.has(code) || err?.name === "AuthRetryableFetchError") return "auth_failed";
  if (status === 429 || status >= 500 || status === 0) return "auth_failed";
  return status >= 400 ? "invalid_link" : "auth_failed";
}

/**
 * Classify the `error` / `error_code` / `error_description` parameters an auth provider (Supabase's
 * verify endpoint) appends to a redirect. Null when the URL carries no error. The description is
 * only pattern-checked for "expired", never forwarded.
 */
export function providerErrorCode(params: URLSearchParams): AuthRedirectError | null {
  const error = params.get("error")?.trim() ?? "";
  const errorCode = params.get("error_code")?.trim() ?? "";
  const description = params.get("error_description") ?? "";
  if (!error && !errorCode && !description) return null;
  if (errorCode) {
    const mapped = authErrorCode({ code: errorCode, status: 400 });
    if (mapped !== "invalid_link") return mapped;
  }
  if (/expired/i.test(description)) return "link_expired";
  if (error === "server_error" || error === "temporarily_unavailable") return "auth_failed";
  return "invalid_link";
}

/** Auth pages never make sense as the post-login destination of a failed link. */
const AUTH_PAGE = /^\/(login|signup|forgot-password|reset-password|auth)(\/|\?|#|$)/;

/**
 * `/login?error=<code>`, keeping a safe same-origin `next` so the person still lands where the
 * link was taking them (e.g. an invite) once they log in.
 */
export function loginErrorUrl(origin: string, code: AuthRedirectError, next?: string | null): URL {
  const url = new URL("/login", origin);
  url.searchParams.set("error", code);
  const dest = safeNext(next);
  if (dest && dest !== "/" && !AUTH_PAGE.test(dest)) url.searchParams.set("next", dest);
  return url;
}
