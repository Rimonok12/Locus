"use client";
/* ─── Locus · sidebar navigation ─── */

import { useState } from "react";
import {
  Inbox, UserCircle2, Search, Plus, ChevronDown, ChevronRight,
  List, LayoutGrid, Target, RefreshCw, Moon, Sun, RotateCcw, Github,
} from "lucide-react";
import { TEAMS } from "@/lib/data";
import { useLocus } from "@/lib/store";

function NavRow({
  icon, label, active, onClick, badge, indent,
}: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; badge?: number; indent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`focus-ring group flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[12.5px] font-medium transition-colors ${
        indent ? "ml-5 w-[calc(100%-1.25rem)]" : ""
      } ${active ? "bg-wash text-ink" : "text-dim hover:bg-wash hover:text-ink"}`}
    >
      <span className={active ? "text-accent" : "text-faint group-hover:text-dim"}>{icon}</span>
      <span className="truncate">{label}</span>
      {badge ? (
        <span className="ml-auto rounded-full bg-accent px-1.5 text-xxs font-semibold text-accent-ink">{badge}</span>
      ) : null}
    </button>
  );
}

export default function Sidebar() {
  const { view, activeTeamId, setView, setPalette, setNewIssue, dark, toggleDark, notifications, resetDemo } = useLocus();
  const [openTeams, setOpenTeams] = useState<Record<string, boolean>>({ t1: true });
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-canvas">
      {/* workspace header */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-ink">◎</span>
        <span className="text-[13px] font-bold tracking-tight">Locus</span>
        <span className="rounded border border-line px-1 text-[9px] font-semibold uppercase tracking-wider text-faint">demo</span>
        <button
          onClick={() => setNewIssue(true)}
          title="New issue (C)"
          className="focus-ring ml-auto flex h-6 w-6 items-center justify-center rounded-md border border-line bg-surface text-dim hover:text-accent"
        >
          <Plus size={13} strokeWidth={2.4} />
        </button>
      </div>

      {/* search */}
      <div className="px-3 pb-3">
        <button
          onClick={() => setPalette(true)}
          className="focus-ring flex h-[30px] w-full items-center gap-2 rounded-md border border-line bg-surface px-2 text-[12px] text-faint hover:text-dim"
        >
          <Search size={13} />
          Search…
          <span className="ml-auto flex gap-1"><kbd>⌘</kbd><kbd>K</kbd></span>
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        <NavRow icon={<Inbox size={14} />} label="Inbox" badge={unread} active={view === "inbox"} onClick={() => setView("inbox")} />
        <NavRow icon={<UserCircle2 size={14} />} label="My Issues" active={view === "my"} onClick={() => setView("my")} />

        <div className="pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-widest text-faint">Workspace</div>
        <NavRow icon={<Target size={14} />} label="Projects" active={view === "projects"} onClick={() => setView("projects")} />
        <NavRow icon={<RefreshCw size={14} />} label="Cycles" active={view === "cycles"} onClick={() => setView("cycles")} />

        <div className="pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-widest text-faint">Teams</div>
        {TEAMS.map((t) => {
          const open = openTeams[t.id];
          return (
            <div key={t.id}>
              <button
                onClick={() => setOpenTeams((s) => ({ ...s, [t.id]: !s[t.id] }))}
                className="focus-ring flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[12.5px] font-medium text-dim hover:bg-wash hover:text-ink"
              >
                {open ? <ChevronDown size={12} className="text-faint" /> : <ChevronRight size={12} className="text-faint" />}
                <span
                  className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold text-white"
                  style={{ background: `hsl(${t.hue} 48% 48%)` }}
                >
                  {t.key[0]}
                </span>
                <span className="truncate">{t.name}</span>
              </button>
              {open && (
                <div className="space-y-0.5">
                  <NavRow indent icon={<List size={13} />} label="Issues" active={view === "issues" && activeTeamId === t.id} onClick={() => setView("issues", t.id)} />
                  <NavRow indent icon={<LayoutGrid size={13} />} label="Board" active={view === "board" && activeTeamId === t.id} onClick={() => setView("board", t.id)} />
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* footer */}
      <div className="space-y-0.5 border-t border-line p-3">
        <NavRow icon={dark ? <Sun size={14} /> : <Moon size={14} />} label={dark ? "Light mode" : "Dark mode"} onClick={toggleDark} />
        <NavRow icon={<RotateCcw size={14} />} label="Reset demo data" onClick={resetDemo} />
        <a
          href="https://github.com/Rimonok12/Locus"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[12.5px] font-medium text-dim hover:bg-wash hover:text-ink"
        >
          <Github size={14} className="text-faint" /> Source on GitHub
        </a>
      </div>
    </aside>
  );
}
