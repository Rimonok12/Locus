"use client";
/* ─── Locus · application shell ─── */

import { useEffect } from "react";
import { LayoutGrid, List as ListIcon, Plus } from "lucide-react";
import { useLocus, teamById } from "@/lib/store";
import Sidebar from "./Sidebar";
import IssuesView, { FilterBar } from "./IssuesView";
import BoardView from "./BoardView";
import IssuePanel from "./IssuePanel";
import NewIssueModal from "./NewIssueModal";
import Palette from "./Palette";
import { CyclesView, InboxView, ProjectsView } from "./Views";

const TITLES: Record<string, string> = {
  inbox: "Inbox", my: "My Issues", projects: "Projects", cycles: "Cycles",
};

export default function App() {
  const { view, activeTeamId, dark, setView, setNewIssue, setPalette, paletteOpen, newIssueOpen, selectedIssueId, toast } = useLocus();

  /* theme class on <html> */
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  /* global shortcuts */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
      if (typing || paletteOpen || newIssueOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "c": e.preventDefault(); setNewIssue(true); break;
        case "/": e.preventDefault(); setPalette(true); break;
        case "b": setView("board"); break;
        case "i": setView("issues"); break;
        case "p": setView("projects"); break;
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [paletteOpen, newIssueOpen, setNewIssue, setPalette, setView]);

  const team = teamById(activeTeamId);
  const title = TITLES[view] ?? `${team.name} › ${view === "board" ? "Board" : "Issues"}`;
  const isTeamView = view === "issues" || view === "board";

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4">
          <h1 className="text-[13px] font-semibold tracking-tight">{title}</h1>
          {isTeamView && (
            <div className="flex items-center rounded-md border border-line bg-surface p-0.5">
              <button
                onClick={() => setView("issues")}
                className={`focus-ring flex h-6 items-center gap-1 rounded px-2 text-xxs font-medium ${view === "issues" ? "bg-wash text-ink" : "text-faint hover:text-dim"}`}
              >
                <ListIcon size={12} /> List
              </button>
              <button
                onClick={() => setView("board")}
                className={`focus-ring flex h-6 items-center gap-1 rounded px-2 text-xxs font-medium ${view === "board" ? "bg-wash text-ink" : "text-faint hover:text-dim"}`}
              >
                <LayoutGrid size={12} /> Board
              </button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {isTeamView && <FilterBar />}
            <button
              onClick={() => setNewIssue(true)}
              className="focus-ring flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-semibold text-accent-ink"
            >
              <Plus size={13} strokeWidth={2.6} /> New issue
            </button>
          </div>
        </header>

        {/* content + detail panel */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {view === "issues" && <IssuesView scope="team" />}
            {view === "my" && <IssuesView scope="mine" />}
            {view === "board" && <BoardView />}
            {view === "inbox" && <InboxView />}
            {view === "projects" && <ProjectsView />}
            {view === "cycles" && <CyclesView />}
          </div>
          {selectedIssueId && <IssuePanel />}
        </div>
      </main>

      <NewIssueModal />
      <Palette />

      {toast && (
        <div className="toast fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-lg border border-line bg-surface px-4 py-2 text-[12.5px] font-medium text-ink shadow-pop">
          {toast}
        </div>
      )}
    </div>
  );
}
