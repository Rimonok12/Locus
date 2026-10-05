"use client";
/* ─── Locus · root error UI ──────────────────────────────────────────────────
   Catches anything below the root layout that throws while rendering — a page,
   the workspace layout (e.g. the database was unreachable), or a client crash
   outside the workspace's own view boundaries. The root layout (theme script,
   fonts, tokens) is still mounted, so this uses the app's own styling.
   Retry re-fetches server components (router.refresh) and re-renders the
   segment; a stale-deploy chunk error or being offline gets its own copy.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/primitives/controls";

/** A lazy chunk from a previous deploy is gone: only a full reload picks up the new build. */
function isChunkError(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /loading (css )?chunk [\w-]+ failed|failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(error.message ?? "")
  );
}

const LINK_SECONDARY =
  "focus-ring inline-flex h-10 shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink shadow-card transition-colors hover:bg-wash";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [offline, setOffline] = useState(false);
  const stale = isChunkError(error);

  useEffect(() => {
    console.error("[locus] unhandled error", error);
  }, [error]);

  useEffect(() => {
    const prev = document.title;
    document.title = "Something went wrong · Locus";
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      document.title = prev;
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const retry = () => {
    if (stale) {
      window.location.reload();
      return;
    }
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  let icon: ReactNode = <TriangleAlert size={20} strokeWidth={1.8} />;
  let title = "Something went wrong";
  let body = "An unexpected error stopped this page from loading. Try again — if it keeps happening, reload the page.";
  let action = "Try again";
  if (stale) {
    icon = <RotateCw size={20} strokeWidth={1.8} />;
    title = "Locus has been updated";
    body = "A newer version is available. Reload to pick it up and carry on where you left off.";
    action = "Reload";
  } else if (offline) {
    icon = <WifiOff size={20} strokeWidth={1.8} />;
    title = "You’re offline";
    body = "Locus couldn’t load this page without a connection. Try again once you’re back online.";
  }
  const tone = stale ? "var(--accent)" : "var(--danger)";
  const detail = process.env.NODE_ENV !== "production" && error.message ? error.message : null;

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-canvas text-ink">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px]"
        style={{ background: "radial-gradient(56% 64% at 50% 0%, var(--accent-soft), transparent 72%)" }}
      />
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
        <div role="alert" aria-live="assertive" className="anim-modal flex w-full max-w-[380px] flex-col items-center text-center">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface shadow-card"
            style={{ color: tone, boxShadow: `0 0 0 4px color-mix(in srgb, ${tone} 10%, transparent)` }}
          >
            {icon}
          </span>
          <h1 className="mt-5 text-balance text-[20px] font-semibold leading-tight tracking-[-0.012em] text-ink">{title}</h1>
          <p className="mt-2 max-w-[340px] text-balance text-[13px] leading-relaxed text-dim">{body}</p>

          {detail && (
            <pre className="mt-4 max-h-40 w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-raised px-3 py-2 text-left font-mono text-xxs text-dim">
              {detail}
            </pre>
          )}

          <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
            <Button
              variant="primary"
              size="lg"
              autoFocus
              loading={pending}
              icon={<RotateCw size={14} />}
              onClick={retry}
              className="w-full sm:w-auto"
            >
              {action}
            </Button>
            <a href="/" className={`${LINK_SECONDARY} w-full sm:w-auto`}>Go to Locus</a>
          </div>

          {error.digest && (
            <p className="mt-6 text-xxs text-faint">
              Error ID <code className="select-all font-mono text-dim">{error.digest}</code>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
