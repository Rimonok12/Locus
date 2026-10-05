"use client";
/* ─── Locus · keyboard shortcuts reference (?) ─── */

import { useMemo, useState } from "react";
import { Keyboard, Search, X } from "lucide-react";
import { ui, useUI } from "@/lib/ui";
import { Modal } from "@/components/primitives/overlay";
import { IconButton, Kbd } from "@/components/primitives/controls";
import { keys } from "./commands";
import { useRestoreFocus } from "./useRestoreFocus";

interface Shortcut {
  label: string;
  /** each inner array is one key combo; several combos are alternatives (or a sequence when `then`) */
  combos: string[][];
  then?: boolean;
  keywords?: string;
}
interface Section { title: string; items: Shortcut[] }

/* Every entry maps to a real handler: General / Navigation / Issue → useGlobalShortcuts,
   Lists → issues/useListInteractions (+ issues/filters for F), Issue page → issue/IssueView,
   Inbox → views/InboxView, Editor → editor/Editor (Tiptap StarterKit, task lists, mentions). */
function buildSections(): Section[] {
  const mod = keys.mod();
  const shift = keys.shift();
  const alt = keys.alt();
  const enter = keys.enter;
  const backspace = keys.backspace();
  const seq = (label: string, a: string, b: string, keywords?: string): Shortcut => ({ label, combos: [[a], [b]], then: true, keywords });
  return [
    {
      title: "General",
      items: [
        { label: "Open command palette", combos: [[mod, "K"]], keywords: "search commands" },
        { label: "Create issue", combos: [["C"]], keywords: "new" },
        { label: "Search", combos: [["/"]], keywords: "find" },
        { label: "Keyboard shortcuts", combos: [["?"]], keywords: "help" },
        { label: "Toggle sidebar", combos: [["["]], keywords: "navigation collapse menu" },
      ],
    },
    {
      title: "Navigation",
      items: [
        seq("Go to inbox", "G", "I", "notifications"),
        seq("Go to my issues", "G", "M", "assigned"),
        seq("Go to projects", "G", "P"),
        seq("Go to views", "G", "V", "saved"),
        seq("Go to settings", "G", "S", "account"),
        seq("Go to team issues", "G", "T"),
        seq("Go to active issues", "G", "A", "in progress"),
        seq("Go to backlog", "G", "B"),
        seq("Go to cycles", "G", "C", "sprint"),
      ],
    },
    {
      title: "Lists",
      items: [
        { label: "Move down / up", combos: [["J"], ["K"]], keywords: "next previous arrow focus" },
        { label: "Extend selection", combos: [[shift, "J"], [shift, "K"]], keywords: "multi select range" },
        { label: "Select issue", combos: [["X"]], keywords: "check toggle" },
        { label: "Select all", combos: [[mod, "A"]] },
        { label: "Open issue", combos: [[enter], ["O"]] },
        { label: "Peek issue", combos: [["Space"]], keywords: "preview panel close" },
        { label: "Filter", combos: [["F"]] },
        { label: "Clear selection / close peek", combos: [["Esc"]], keywords: "escape" },
      ],
    },
    {
      title: "Issue",
      items: [
        { label: "Change status", combos: [["S"]], keywords: "state" },
        { label: "Set priority", combos: [["P"]] },
        { label: "Assign to…", combos: [["A"]], keywords: "assignee" },
        { label: "Assign to me / unassign", combos: [["I"]], keywords: "myself" },
        { label: "Change labels", combos: [["L"]], keywords: "tag" },
        { label: "Add to project", combos: [[shift, "P"]] },
        { label: "Add to cycle", combos: [[shift, "C"]], keywords: "sprint" },
        { label: "Set estimate", combos: [[shift, "E"]], keywords: "points" },
        { label: "Set due date", combos: [[shift, "D"]], keywords: "deadline" },
        { label: "Move to team", combos: [[shift, "M"]] },
        { label: "Copy issue ID", combos: [[mod, "."]], keywords: "identifier clipboard" },
        { label: "Copy issue link", combos: [[mod, shift, ","]], keywords: "url clipboard" },
        { label: "Delete issue", combos: [[mod, backspace]], keywords: "remove" },
      ],
    },
    {
      title: "Issue page",
      items: [
        { label: "Next / previous issue", combos: [["J"], ["K"]], keywords: "navigate list" },
        { label: "Go back", combos: [["Esc"]], keywords: "escape close list" },
      ],
    },
    {
      title: "Inbox",
      items: [
        { label: "Next / previous notification", combos: [["J"], ["K"]], keywords: "notifications" },
        { label: "Open issue", combos: [[enter]], keywords: "notification" },
        { label: "Archive notification", combos: [["E"], [backspace]], keywords: "done remove" },
        { label: "Mark read / unread", combos: [["U"]], keywords: "notification" },
        { label: "Snooze / unsnooze", combos: [["H"]], keywords: "remind later notification" },
      ],
    },
    {
      title: "Editor",
      items: [
        { label: "Submit", combos: [[mod, enter]], keywords: "send save comment create" },
        { label: "Mention someone", combos: [["@"]], keywords: "user tag" },
        { label: "Bold", combos: [[mod, "B"]] },
        { label: "Italic", combos: [[mod, "I"]] },
        { label: "Underline", combos: [[mod, "U"]] },
        { label: "Strikethrough", combos: [[mod, shift, "S"]] },
        { label: "Inline code", combos: [[mod, "E"]], keywords: "markdown `code`" },
        { label: "Code block", combos: [["```", "Space"], [mod, alt, "C"]], keywords: "markdown pre" },
        { label: "Heading", combos: [["#", "Space"]], keywords: "markdown title ## ###" },
        { label: "Bulleted list", combos: [["-", "Space"]], keywords: "markdown bullet" },
        { label: "Numbered list", combos: [["1.", "Space"]], keywords: "markdown ordered" },
        { label: "Checklist", combos: [["[ ]", "Space"]], keywords: "markdown task todo checkbox" },
        { label: "Quote", combos: [[">", "Space"]], keywords: "markdown blockquote" },
        { label: "Leave the editor", combos: [["Esc"]], keywords: "blur escape" },
      ],
    },
  ];
}

/** key glyphs also match their names ("cmd", "shift", "backspace"…) in the search box */
const SPOKEN: Record<string, string> = {
  "⌘": "⌘ cmd command", "⇧": "⇧ shift", "⌥": "⌥ alt option", "⌫": "⌫ backspace delete", "↵": "↵ enter return", Esc: "esc escape",
};
const spoken = (k: string) => SPOKEN[k] ?? k;

export default function ShortcutsHelp() {
  const open = useUI((s) => s.shortcutsOpen);
  return (
    <Modal open={open} onClose={ui.closeShortcuts} width={560} label="Keyboard shortcuts">
      <ShortcutsBody />
    </Modal>
  );
}

function ShortcutsBody() {
  const [query, setQuery] = useState("");
  useRestoreFocus();
  const sections = useMemo(buildSections, []);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return sections;
    const tokens = q.split(/\s+/);
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((it) => {
          const hay = `${it.label} ${it.keywords ?? ""} ${s.title} ${it.combos.map((c) => c.map(spoken).join(" ")).join(" ")}`.toLowerCase();
          return tokens.every((t) => hay.includes(t));
        }),
      }))
      .filter((s) => s.items.length);
  }, [sections, q]);

  return (
    <div className="flex max-h-[min(680px,84dvh)] flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3.5">
        <Keyboard size={16} className="shrink-0 text-faint" />
        <h2 className="text-[14px] font-semibold text-ink">Keyboard shortcuts</h2>
        <IconButton label="Close" size={32} className="ml-auto" onClick={ui.closeShortcuts}><X size={15} /></IconButton>
      </div>
      <div className="shrink-0 px-4 pb-3">
        <div className="flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised px-2.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
          <Search size={14} className="shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint sm:text-[13px]"
          />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-wash hover:text-ink">
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-2 pb-3">
        {filtered.length === 0 && (
          <div className="px-2 py-10 text-center text-[13px] text-faint">No shortcuts match “{query.trim()}”.</div>
        )}
        {filtered.map((s) => (
          <section key={s.title} className="pt-3">
            <h3 className="px-2 pb-1 text-xxs font-medium text-faint">{s.title}</h3>
            <ul>
              {s.items.map((it) => (
                <li key={it.label} className="flex min-h-[34px] items-center gap-3 rounded-md px-2 text-[13px] text-ink hover:bg-wash">
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xxs text-faint">
                    {it.combos.map((combo, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="px-0.5">{it.then ? "then" : "/"}</span>}
                        {combo.map((k, j) => <Kbd key={`${k}-${j}`}>{k}</Kbd>)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
