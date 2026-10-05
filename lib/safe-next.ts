/* ─── Locus · post-auth redirect targets (pure: safe in middleware, route handlers and the client) ─── */

/**
 * A same-origin relative path, or null. Must start with "/", must not be protocol-relative
 * ("//", "/\"), and must not contain whitespace, backslashes or control characters: browsers strip
 * tab / CR / LF while parsing URLs, so "/\t/evil.com" would become "//evil.com".
 */
export function safeNext(raw: string | string[] | null | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || v.length > 2048) return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\\\u0000-\u001f\u007f]/.test(v)) return null;
  return v;
}

/** Absolute redirect target that is guaranteed to stay on `origin` (falls back to `fallback`). */
export function sameOriginUrl(next: string | null | undefined, origin: string, fallback = "/"): URL {
  const n = safeNext(next) ?? fallback;
  const u = new URL(n, origin);
  return u.origin === origin ? u : new URL(fallback, origin);
}
