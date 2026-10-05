"use client";
/* ─── Locus · workspace client root: bootstrap the sync engine, then render the shell ─── */

import { useEffect, useState } from "react";
import { bootstrap, teardown, useSync } from "@/lib/sync/store";
import { applyTheme, useUI } from "@/lib/ui";
import type { Profile, Workspace } from "@/lib/types";
import { LocusMark } from "@/components/primitives/icons";
import { Button } from "@/components/primitives/controls";
import Shell from "./Shell";

export default function WorkspaceApp({ workspace, profile }: { workspace: Workspace; profile: Profile }) {
  const status = useSync((s) => s.status);
  const error = useSync((s) => s.error);
  const theme = useUI((s) => s.theme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    bootstrap({ workspace, profile });
    try { localStorage.setItem("locus:last-workspace", workspace.slug); } catch { /* ignore */ }
    document.cookie = `locus_ws=${workspace.slug}; path=/; max-age=31536000; samesite=lax`;
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);

  if (!mounted || status === "idle" || status === "loading") return <BootScreen />;
  if (status === "error") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
        <LocusMark size={32} />
        <div>
          <h1 className="text-[15px] font-semibold text-ink">Couldn’t load your workspace</h1>
          <p className="mt-1 text-[13px] text-dim">{error}</p>
        </div>
        <Button variant="primary" onClick={() => window.location.reload()}>Try again</Button>
      </div>
    );
  }
  return <Shell />;
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
