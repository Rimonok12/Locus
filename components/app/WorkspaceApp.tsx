"use client";
/* ─── Locus · workspace client root: bootstrap the sync engine, then render the shell ─── */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { bootstrap, teardown, useSync } from "@/lib/sync/store";
import { applyTheme, useUI } from "@/lib/ui";
import type { Profile, Workspace } from "@/lib/types";
import { LocusMark } from "@/components/primitives/icons";
import { Button } from "@/components/primitives/controls";
import ErrorBoundary from "./ErrorBoundary";
import Shell from "./Shell";

export default function WorkspaceApp({ workspace, profile }: { workspace: Workspace; profile: Profile }) {
  const status = useSync((s) => s.status);
  const error = useSync((s) => s.error);
  const slug = useSync((s) => s.workspaces[s.workspaceId]?.slug);
  const theme = useUI((s) => s.theme);
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    bootstrap({ workspace, profile });
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  // Keep the URL, the "last workspace" cookie and localStorage on the current slug — another admin may
  // rename it while this tab is open (realtime / refresh), and a stale link may push the old slug back.
  useEffect(() => {
    if (!slug || status !== "ready") return;
    const { pathname: p, search, hash } = window.location;
    const current = p.split("/")[1] ?? "";
    // null state (not history.state) so Next's patched replaceState updates usePathname
    if (current && current !== slug) window.history.replaceState(null, "", p.replace(/^\/[^/]+/, `/${slug}`) + search + hash);
    try { localStorage.setItem("locus:last-workspace", slug); } catch { /* ignore */ }
    document.cookie = `locus_ws=${slug}; path=/; max-age=31536000; samesite=lax`;
  }, [slug, pathname, status]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);

  if (!mounted || status === "idle" || status === "loading") return <BootScreen />;
  if (status === "error") return <Fatal title="Couldn’t load your workspace" message={error} />;
  return (
    <ErrorBoundary fallback={(e, reset) => <Fatal title="Something went wrong" message={e.message} onRetry={reset} />}>
      <Shell />
    </ErrorBoundary>
  );
}

function Fatal({ title, message, onRetry }: { title: string; message: string | null; onRetry?: () => void }) {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <LocusMark size={32} />
      <div>
        <h1 className="text-[15px] font-semibold text-ink">{title}</h1>
        {message && <p className="mt-1 max-w-md text-[13px] text-dim">{message}</p>}
      </div>
      <div className="flex gap-2">
        {onRetry && <Button variant="primary" onClick={onRetry}>Try again</Button>}
        <Button variant={onRetry ? "secondary" : "primary"} onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </div>
  );
}

function BootScreen() {
  return (
    <div className="flex h-screen bg-canvas">
      <div className="hidden w-[240px] shrink-0 flex-col gap-2 border-r border-line bg-sidebar p-3 md:flex">
        <div className="skeleton h-7 w-32 rounded-md" />
        <div className="skeleton mt-3 h-7 rounded-md" />
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-6 rounded-md" style={{ width: `${60 + ((i * 13) % 30)}%` }} />)}
      </div>
      <div className="flex flex-1 flex-col">
        <div className="h-12 border-b border-line" />
        <div className="flex flex-1 items-center justify-center">
          <div className="animate-pulse"><LocusMark size={36} /></div>
        </div>
      </div>
    </div>
  );
}
