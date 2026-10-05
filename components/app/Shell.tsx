"use client";
/* ─── Locus · application shell: sidebar + routed content + global overlays ─── */

import { useLayoutEffect, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { navigate, useRoute } from "@/lib/router";
import { ui, useUI } from "@/lib/ui";
import { Button, EmptyState } from "@/components/primitives/controls";
import Sidebar from "./Sidebar";
import RouteView from "./RouteView";
import Toaster from "./Toaster";
import ConfirmDialog from "./ConfirmDialog";
import ErrorBoundary from "./ErrorBoundary";
import { ViewHeader } from "./Header";
import CommandPalette from "@/components/overlays/CommandPalette";
import CreateIssueModal from "@/components/overlays/CreateIssueModal";
import PickerDialog from "@/components/overlays/PickerDialog";
import ShortcutsHelp from "@/components/overlays/ShortcutsHelp";
import BulkActionBar from "@/components/overlays/BulkActionBar";
import { useGlobalShortcuts } from "@/components/overlays/useGlobalShortcuts";
import IssuePeek from "@/components/issue/IssuePeek";

/** Shown in place of a view that threw while rendering; the sidebar and overlays keep working. */
function ViewCrash({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <ViewHeader title="Something went wrong" />
      <EmptyState
        icon={<AlertTriangle size={28} />}
        title="This view hit an unexpected error"
        body={error.message || "Try again, or reload the page."}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={reset}>Try again</Button>
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="ghost" onClick={() => { navigate({ kind: "my-issues", tab: "assigned" }); reset(); }}>Go to My issues</Button>
          </div>
        }
      />
    </>
  );
}

/** A broken overlay or sidebar drops out on its own (and closes) instead of taking the shell down. */
const Guard = ({ resetKey, onError, children }: { resetKey: string; onError?: () => void; children: ReactNode }) => (
  <ErrorBoundary resetKey={resetKey} onError={onError}>{children}</ErrorBoundary>
);

/** Global overlays, each behind its own boundary that resets whenever the overlay opens / closes.
 *  (Separate from Shell so opening an overlay never re-renders the routed view.) */
function Overlays() {
  const { path } = useRoute();
  const peekId = useUI((s) => s.peekIssueId);
  const paletteOpen = useUI((s) => s.paletteOpen);
  const creating = useUI((s) => Boolean(s.createIssue));
  const picker = useUI((s) => (s.picker ? `${s.picker.kind}:${s.picker.issueIds.join(",")}` : ""));
  const shortcutsOpen = useUI((s) => s.shortcutsOpen);
  const confirming = useUI((s) => Boolean(s.confirm));
  return (
    <>
      <Guard resetKey={peekId ?? ""} onError={() => ui.peek(null)}><IssuePeek /></Guard>
      <Guard resetKey={path} onError={ui.clearSelection}><BulkActionBar /></Guard>
      <Guard resetKey={String(paletteOpen)} onError={ui.closePalette}><CommandPalette /></Guard>
      <Guard resetKey={String(creating)} onError={ui.closeCreateIssue}><CreateIssueModal /></Guard>
      <Guard resetKey={picker} onError={ui.closePicker}><PickerDialog /></Guard>
      <Guard resetKey={String(shortcutsOpen)} onError={ui.closeShortcuts}><ShortcutsHelp /></Guard>
      <Guard resetKey={String(confirming)} onError={ui.closeConfirm}><ConfirmDialog /></Guard>
    </>
  );
}

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
      {/* desktop sidebar — hidden from Tab order and assistive tech while collapsed (visibility flips after the slide) */}
      <div className={`hidden shrink-0 transition-[width] duration-200 md:block ${collapsed ? "w-0" : "w-[240px]"}`}>
        <div className={`h-full w-[240px] transition-[transform,visibility] duration-200 ${collapsed ? "invisible -translate-x-full" : "visible"}`}>
          <Guard resetKey={path}><Sidebar /></Guard>
        </div>
      </div>
      {/* mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div className="anim-fade absolute inset-0 bg-black/40" onClick={() => ui.setMobileNav(false)} />
          <div className="anim-slide absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-modal">
            <Guard resetKey={path}><Sidebar /></Guard>
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <ErrorBoundary resetKey={path} fallback={(error, reset) => <ViewCrash error={error} reset={reset} />}>
          <RouteView />
        </ErrorBoundary>
      </main>

      <Overlays />
      <Toaster />
    </div>
  );
}
