"use client";
/* ─── Locus · command palette (⌘K) built on cmdk ─── */

import { Command } from "cmdk";
import { useEffect } from "react";
import {
  Inbox, LayoutGrid, List, Moon, Plus, RefreshCw, Sun, Target, UserCircle2,
} from "lucide-react";
import { TEAMS } from "@/lib/data";
import { identifier, useLocus } from "@/lib/store";
import { StatusIcon } from "./ui";

const itemCls =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[12.5px] text-ink aria-selected:bg-wash";

export default function Palette() {
  const {
    paletteOpen, setPalette, setView, setNewIssue, toggleDark, dark, issues, select,
  } = useLocus();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!paletteOpen);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [paletteOpen, setPalette]);

  if (!paletteOpen) return null;

  const run = (fn: () => void) => { fn(); setPalette(false); };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[14vh]"
      style={{ background: "rgba(17,45,78,0.38)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}
    >
      <Command
        label="Command palette"
        className="pop w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
      >
        <Command.Input
          autoFocus
          placeholder="Type a command or search issues…"
          className="h-11 w-full border-b border-line bg-transparent px-4 text-[13.5px] text-ink outline-none placeholder:text-faint"
        />
        <Command.List className="p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-[12.5px] text-faint">No results.</Command.Empty>

          <Command.Group heading={<span className="px-2 text-xxs font-semibold uppercase tracking-wide text-faint">Actions</span>}>
            <Command.Item className={itemCls} onSelect={() => run(() => setNewIssue(true))}>
              <Plus size={14} className="text-accent" /> New issue <kbd className="ml-auto">C</kbd>
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(toggleDark)}>
              {dark ? <Sun size={14} className="text-accent" /> : <Moon size={14} className="text-accent" />}
              Switch to {dark ? "light" : "dark"} mode
            </Command.Item>
          </Command.Group>

          <Command.Group heading={<span className="px-2 text-xxs font-semibold uppercase tracking-wide text-faint">Navigate</span>}>
            <Command.Item className={itemCls} onSelect={() => run(() => setView("inbox"))}>
              <Inbox size={14} className="text-dim" /> Go to Inbox
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => setView("my"))}>
              <UserCircle2 size={14} className="text-dim" /> Go to My Issues
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => setView("projects"))}>
              <Target size={14} className="text-dim" /> Go to Projects
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => setView("cycles"))}>
              <RefreshCw size={14} className="text-dim" /> Go to Cycles
            </Command.Item>
            {TEAMS.map((t) => (
              <Command.Item key={t.id + "i"} className={itemCls} onSelect={() => run(() => setView("issues", t.id))}>
                <List size={14} className="text-dim" /> {t.name}: Issues
              </Command.Item>
            ))}
            {TEAMS.map((t) => (
              <Command.Item key={t.id + "b"} className={itemCls} onSelect={() => run(() => setView("board", t.id))}>
                <LayoutGrid size={14} className="text-dim" /> {t.name}: Board
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading={<span className="px-2 text-xxs font-semibold uppercase tracking-wide text-faint">Issues</span>}>
            {issues.slice(0, 40).map((i) => (
              <Command.Item
                key={i.id}
                value={`${identifier(i)} ${i.title}`}
                className={itemCls}
                onSelect={() => run(() => { setView("issues", i.teamId); select(i.id); })}
              >
                <StatusIcon status={i.status} />
                <span className="font-mono text-xxs text-faint">{identifier(i)}</span>
                <span className="truncate">{i.title}</span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
        <footer className="flex items-center gap-3 border-t border-line px-3 py-2 text-xxs text-faint">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
          <span className="ml-auto font-semibold text-accent">Locus</span>
        </footer>
      </Command>
    </div>
  );
}
