"use client";
/* ─── Locus · application shell: sidebar + routed content + global overlays ─── */

import { useLayoutEffect } from "react";
import { useRoute } from "@/lib/router";
import { ui, useUI } from "@/lib/ui";
import Sidebar from "./Sidebar";
import RouteView from "./RouteView";
import Toaster from "./Toaster";
import ConfirmDialog from "./ConfirmDialog";
import CommandPalette from "@/components/overlays/CommandPalette";
import CreateIssueModal from "@/components/overlays/CreateIssueModal";
import PickerDialog from "@/components/overlays/PickerDialog";
import ShortcutsHelp from "@/components/overlays/ShortcutsHelp";
import BulkActionBar from "@/components/overlays/BulkActionBar";
import { useGlobalShortcuts } from "@/components/overlays/useGlobalShortcuts";
import IssuePeek from "@/components/issue/IssuePeek";

export default function Shell() {
  const { path } = useRoute();
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const mobileNav = useUI((s) => s.mobileNavOpen);
  useGlobalShortcuts();

  // leaving a view clears transient list state — in a layout effect so it runs
  // before child views' effects (e.g. the issue page focusing its issue)
  useLayoutEffect(() => {
    ui.clearSelection();
    ui.setFocused(null);
    ui.peek(null);
    ui.setMobileNav(false);
  }, [path]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas text-ink">
      {/* desktop sidebar */}
      <div className={`hidden shrink-0 transition-[width] duration-200 md:block ${collapsed ? "w-0" : "w-[240px]"}`}>
        <div className={`h-full w-[240px] ${collapsed ? "-translate-x-full" : ""} transition-transform duration-200`}>
          <Sidebar />
        </div>
      </div>
      {/* mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div className="anim-fade absolute inset-0 bg-black/40" onClick={() => ui.setMobileNav(false)} />
          <div className="anim-slide absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-modal">
            <Sidebar />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <RouteView />
      </main>

      <IssuePeek />
      <BulkActionBar />
      <CommandPalette />
      <CreateIssueModal />
      <PickerDialog />
      <ShortcutsHelp />
      <ConfirmDialog />
      <Toaster />
    </div>
  );
}
