"use client";
/* ─── Locus · command palette (⌘K) ───────────────────────────────────────────
   cmdk with shouldFilter={false}: static commands are matched here, issue and
   project matches are computed over the whole store, so nothing gets hidden by
   cmdk's own scoring and our order is kept. Issue commands act on the context
   captured at open time (selection → peek → focused row → the open issue page).
   Typed text can always fall through to the full search page.
   ──────────────────────────────────────────────────────────────────────────── */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import {
  Archive, ArchiveRestore, ArrowRightLeft, CalendarDays, Check, CircleDot, Copy, CopyPlus, CornerDownLeft, Hexagon, Inbox, Keyboard,
  Layers, Link2, ListTree, LogOut, Monitor, Moon, PanelLeft, Plus, RefreshCw, Search, Settings, SquarePen, Star,
  StarOff, Sun, Tag, Target, Trash2, Triangle, UserMinus, UserRound, UserRoundCheck, Users, X,
} from "lucide-react";
import { ui, useUI, type PickerKind, type Theme } from "@/lib/ui";
import { signOut, useSync } from "@/lib/sync/store";
import { hrefFor, navigate, useRoute, type Route } from "@/lib/router";
import { issueKey, PROJECT_STATUS_LABEL, useMyTeams } from "@/lib/model";
import { archiveIssues, duplicateIssue, toggleFavorite } from "@/lib/sync/actions";
import { Modal } from "@/components/primitives/overlay";
import { Kbd } from "@/components/primitives/controls";
import { Avatar } from "@/components/primitives/Avatar";
import { PriorityIcon, ProjectIcon, TeamIcon } from "@/components/primitives/icons";
import { StateGlyph } from "@/components/pickers";
import {
  allAssignedToMe, archiveTargets, confirmDeleteIssues, copyIssueIds, copyIssueLinks, createDefaultsFor, keys,
  liveIds, targetIssueIds, toggleAssignToMe,
} from "./commands";
import { useRestoreFocus } from "./useRestoreFocus";
import type { Issue, Project, Team } from "@/lib/types";

export default function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  return (
    <Modal open={open} onClose={ui.closePalette} position="top" width={640} label="Command palette">
      <Palette />
    </Modal>
  );
}

/* ═══ model ═══ */

interface Cmd {
  id: string;
  label: string;
  icon: ReactNode;
  /** extra words matched by search */
  keywords?: string;
  shortcut?: string[];
  /** right-side marker (e.g. current theme) */
  active?: boolean;
  run: () => void;
}
interface CmdGroup { id: string; heading: string; items: Cmd[] }

/** 0 = no match; higher is better. Every query token must appear somewhere. */
function scoreCmd(cmd: Cmd, q: string): number {
  const label = cmd.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  const hay = `${label} ${cmd.keywords?.toLowerCase() ?? ""}`;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.every((t) => hay.includes(t))) return 0;
  const words = label.split(/[\s·/…()]+/).filter(Boolean);
  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 60;
  return 30;
}

function filterGroups(groups: CmdGroup[], q: string): CmdGroup[] {
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items
        .map((c, i) => ({ c, i, s: scoreCmd(c, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((x) => x.c),
    }))
    .filter((g) => g.items.length);
}

/** Top issue matches: exact key → key/number prefix → title prefix → title words → team key + words. */
function searchIssues(issues: Record<string, Issue>, teams: Record<string, Team>, q: string, limit = 20): Issue[] {
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const num = /^\d+$/.test(q) ? Number(q) : null;
  const keyish = q.includes("-");
  /** "eng 12" spelled as an identifier */
  const spacedKey = q.replace(/^([a-z][a-z0-9]*)\s+(\d+)$/, "$1-$2");
  const scored: { i: Issue; r: number }[] = [];
  for (const i of Object.values(issues)) {
    const teamKey = (teams[i.team_id]?.key ?? "").toLowerCase();
    const key = `${teamKey}-${i.number}`;
    const title = i.title.toLowerCase();
    let r = -1;
    if (key === q || key === spacedKey) r = 0;
    else if ((num !== null && i.number === num) || (keyish && key.startsWith(q))) r = 1;
    else if (title.startsWith(q)) r = 2;
    else {
      let viaTitle = false;
      const ok = tokens.every((t) => {
        if (title.includes(t)) { viaTitle = true; return true; }
        // "eng 12" → ENG-12: a team key and a bare number are identifier parts
        return t === teamKey || t === key || (/^\d+$/.test(t) && i.number === Number(t));
      });
      if (ok) r = viaTitle ? 3 : 4;
    }
    if (r < 0) continue;
    if (i.archived_at) r += 5;
    scored.push({ i, r });
  }
  scored.sort((a, b) => a.r - b.r || b.i.updated_at.localeCompare(a.i.updated_at));
  return scored.slice(0, limit).map((x) => x.i);
}

function searchProjects(projects: Record<string, Project>, q: string, limit = 8): Project[] {
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: { p: Project; r: number }[] = [];
  for (const p of Object.values(projects)) {
    if (p.archived_at) continue;
    const name = p.name.toLowerCase();
    const r = name.startsWith(q) ? 0 : tokens.every((t) => name.includes(t)) ? 1 : -1;
    if (r >= 0) scored.push({ p, r });
  }
  scored.sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, limit).map((x) => x.p);
}

/* ═══ palette ═══ */

function Palette() {
  const { slug, route } = useRoute();
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<string[]>(() => targetIssueIds());
  const issues = useSync((s) => s.issues);
  const teams = useSync((s) => s.teams);
  const projects = useSync((s) => s.projects);
  const favorites = useSync((s) => s.favorites);
  const me = useSync((s) => s.userId);
  const theme = useUI((s) => s.theme);
  const myTeams = useMyTeams();

  const q = query.trim().toLowerCase();
  const targetIds = useMemo(() => liveIds(targets, { ...useSync.getState(), issues }), [targets, issues]);
  const targetIssues = useMemo(() => targetIds.map((id) => issues[id]), [targetIds, issues]);
  const single = targetIssues.length === 1 ? targetIssues[0] : undefined;

  /* dismissed without running anything → focus goes back where it was (e.g. the comment being typed) */
  const ran = useRef(false);
  useRestoreFocus(() => ran.current);

  /* close the palette, then act — keeps focus handling predictable */
  const act = (fn: () => void) => () => { ran.current = true; ui.closePalette(); fn(); };
  const go = (to: Route | string) => act(() => navigate(to));

  const groups = useMemo((): CmdGroup[] => {
    const out: CmdGroup[] = [];
    const mod = keys.mod();
    const shift = keys.shift();

    /* issue context */
    if (targetIds.length) {
      const ids = targetIds;
      const pick = (kind: PickerKind) => () => ui.openPicker(kind, ids);
      const mine = allAssignedToMe(ids);
      const sharedProject = targetIssues.every((i) => i.project_id && i.project_id === targetIssues[0].project_id);
      const fav = single ? Object.values(favorites).some((f) => f.kind === "issue" && f.target_id === single.id && f.user_id === me) : false;
      const items: Cmd[] = [
        { id: "status", label: "Change status…", icon: <StateGlyph stateId={single?.state_id} />, keywords: "state workflow done progress todo backlog cancel", shortcut: ["S"], run: pick("status") },
        { id: "priority", label: "Set priority…", icon: <PriorityIcon priority={single?.priority ?? 2} className="text-dim" />, keywords: "urgent high medium low", shortcut: ["P"], run: pick("priority") },
        { id: "assignee", label: "Assign to…", icon: <UserRound size={15} />, keywords: "assignee owner user member", shortcut: ["A"], run: pick("assignee") },
        mine
          ? { id: "assign-me", label: "Unassign from me", icon: <UserMinus size={15} />, keywords: "assign me myself remove", shortcut: ["I"], run: act(() => toggleAssignToMe(ids)) }
          : { id: "assign-me", label: "Assign to me", icon: <UserRoundCheck size={15} />, keywords: "assign me myself take", shortcut: ["I"], run: act(() => toggleAssignToMe(ids)) },
        { id: "labels", label: "Change labels…", icon: <Tag size={15} />, keywords: "label tag", shortcut: ["L"], run: pick("labels") },
        { id: "project", label: "Add to project…", icon: <Hexagon size={15} />, keywords: "project move", shortcut: [shift, "P"], run: pick("project") },
        ...(sharedProject ? [{ id: "milestone", label: "Set milestone…", icon: <Triangle size={14} />, keywords: "milestone project phase", run: pick("milestone") }] : []),
        { id: "cycle", label: "Add to cycle…", icon: <RefreshCw size={14} />, keywords: "cycle sprint iteration", shortcut: [shift, "C"], run: pick("cycle") },
        { id: "estimate", label: "Set estimate…", icon: <Triangle size={14} />, keywords: "estimate points size", shortcut: [shift, "E"], run: pick("estimate") },
        { id: "due", label: "Set due date…", icon: <CalendarDays size={15} />, keywords: "due date deadline", shortcut: [shift, "D"], run: pick("due") },
        { id: "team", label: "Move to team…", icon: <ArrowRightLeft size={15} />, keywords: "team transfer move", shortcut: [shift, "M"], run: pick("team") },
        { id: "parent", label: "Set parent issue…", icon: <ListTree size={15} />, keywords: "parent sub-issue child", run: pick("parent") },
        { id: "copy-id", label: single ? `Copy ID ${issueKey(single, teams)}` : "Copy issue IDs", icon: <Copy size={15} />, keywords: "copy identifier key clipboard", shortcut: [mod, "."], run: act(() => copyIssueIds(ids)) },
        { id: "copy-link", label: single ? "Copy issue link" : "Copy issue links", icon: <Link2 size={15} />, keywords: "copy url link share clipboard", shortcut: [mod, shift, ","], run: act(() => copyIssueLinks(ids)) },
        ...(single ? [
          { id: "duplicate", label: "Duplicate issue", icon: <CopyPlus size={15} />, keywords: "duplicate copy clone", run: act(() => { duplicateIssue(single.id); }) },
          fav
            ? { id: "favorite", label: "Remove from favorites", icon: <StarOff size={15} />, keywords: "favorite star unfavorite", run: act(() => { toggleFavorite("issue", single.id); }) }
            : { id: "favorite", label: "Add to favorites", icon: <Star size={15} />, keywords: "favorite star pin", run: act(() => { toggleFavorite("issue", single.id); }) },
        ] : []),
        targetIssues.every((i) => i.archived_at)
          ? { id: "archive", label: single ? "Unarchive issue" : `Unarchive ${ids.length} issues`, icon: <ArchiveRestore size={15} />, keywords: "unarchive restore", run: act(() => { archiveIssues(ids, false); }) }
          : { id: "archive", label: single ? "Archive issue" : `Archive ${ids.length} issues`, icon: <Archive size={15} />, keywords: "archive hide", run: act(() => archiveTargets(ids)) },
        { id: "delete", label: single ? "Delete issue" : `Delete ${ids.length} issues`, icon: <Trash2 size={15} />, keywords: "delete remove trash", shortcut: [mod, keys.backspace()], run: act(() => confirmDeleteIssues(ids)) },
      ];
      out.push({ id: "issue", heading: single ? "Issue" : `${ids.length} issues`, items });
    }

    /* create */
    out.push({
      id: "create",
      heading: "Create",
      items: [
        { id: "new-issue", label: "Create new issue", icon: <SquarePen size={15} />, keywords: "new issue add task bug ticket", shortcut: ["C"], run: () => ui.openCreateIssue(createDefaultsFor(route)) },
        { id: "new-project", label: "Create new project", icon: <Plus size={15} />, keywords: "new project add", run: go(`/${slug}/projects/all?create=1`) },
        { id: "new-view", label: "Create new view", icon: <Layers size={15} />, keywords: "new view saved filter add", run: go(`/${slug}/views?create=1`) },
      ],
    });

    /* navigation */
    const nav: Cmd[] = [
      { id: "go-inbox", label: "Go to inbox", icon: <Inbox size={15} />, keywords: "notifications", shortcut: ["G", "I"], run: go({ kind: "inbox" }) },
      { id: "go-my", label: "Go to my issues", icon: <Target size={15} />, keywords: "assigned mine", shortcut: ["G", "M"], run: go({ kind: "my-issues", tab: "assigned" }) },
      { id: "go-projects", label: "Go to projects", icon: <Hexagon size={15} />, keywords: "roadmap", shortcut: ["G", "P"], run: go({ kind: "projects", tab: "all" }) },
      { id: "go-views", label: "Go to views", icon: <Layers size={15} />, keywords: "saved filters", shortcut: ["G", "V"], run: go({ kind: "views" }) },
      { id: "go-search", label: "Search issues", icon: <Search size={15} />, keywords: "find", shortcut: ["/"], run: go({ kind: "search" }) },
      { id: "go-settings", label: "Go to settings", icon: <Settings size={15} />, keywords: "account profile preferences", shortcut: ["G", "S"], run: go({ kind: "settings", section: "account" }) },
      { id: "go-workspace", label: "Workspace settings", icon: <Settings size={15} />, keywords: "settings workspace name logo", run: go({ kind: "settings", section: "workspace" }) },
      { id: "go-members", label: "Members", icon: <Users size={15} />, keywords: "settings invite people team members", run: go({ kind: "settings", section: "members" }) },
      { id: "go-teams", label: "Teams", icon: <Users size={15} />, keywords: "settings teams manage join create", run: go({ kind: "settings", section: "teams" }) },
      { id: "go-labels", label: "Labels", icon: <Tag size={15} />, keywords: "settings labels manage", run: go({ kind: "settings", section: "labels" }) },
      { id: "go-prefs", label: "Preferences", icon: <Monitor size={15} />, keywords: "settings theme appearance", run: go({ kind: "settings", section: "preferences" }) },
    ];
    for (const t of myTeams) {
      const icon = <TeamIcon team={t} size={15} />;
      const kw = `${t.key} team ${t.name}`;
      nav.push(
        { id: `team-${t.id}-all`, label: `${t.name} issues`, icon, keywords: `${kw} all issues`, run: go({ kind: "team", key: t.key, tab: "all" }) },
        { id: `team-${t.id}-active`, label: `${t.name} active issues`, icon, keywords: `${kw} active in progress`, run: go({ kind: "team", key: t.key, tab: "active" }) },
        { id: `team-${t.id}-backlog`, label: `${t.name} backlog`, icon, keywords: `${kw} backlog`, run: go({ kind: "team", key: t.key, tab: "backlog" }) },
      );
      if (t.cycles_enabled) {
        nav.push(
          { id: `team-${t.id}-cycles`, label: `${t.name} cycles`, icon, keywords: `${kw} cycles sprints`, run: go({ kind: "team-cycles", key: t.key }) },
          { id: `team-${t.id}-current`, label: `${t.name} current cycle`, icon, keywords: `${kw} current cycle sprint active`, run: go({ kind: "cycle", key: t.key, number: "current" }) },
        );
      }
      nav.push({ id: `team-${t.id}-projects`, label: `${t.name} projects`, icon, keywords: `${kw} projects`, run: go({ kind: "team-projects", key: t.key }) });
    }
    out.push({ id: "nav", heading: "Navigation", items: nav });

    /* preferences */
    const themeCmd = (value: Theme, label: string, icon: ReactNode): Cmd => ({
      id: `theme-${value}`, label: `Theme: ${label}`, icon, keywords: "theme appearance color mode", active: theme === value,
      run: act(() => ui.setTheme(value)),
    });
    out.push({
      id: "prefs",
      heading: "Preferences",
      items: [
        themeCmd("light", "Light", <Sun size={15} />),
        themeCmd("dark", "Dark", <Moon size={15} />),
        themeCmd("system", "System", <Monitor size={15} />),
        {
          id: "sidebar", label: "Toggle sidebar", icon: <PanelLeft size={15} />, keywords: "navigation collapse expand menu", shortcut: ["["],
          run: act(() => (window.matchMedia("(min-width: 768px)").matches ? ui.toggleSidebar() : ui.setMobileNav(true))),
        },
      ],
    });

    /* help */
    out.push({
      id: "help",
      heading: "Help",
      items: [
        { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard size={15} />, keywords: "help keys hotkeys", shortcut: ["?"], run: act(() => ui.openShortcuts()) },
        { id: "logout", label: "Log out", icon: <LogOut size={15} />, keywords: "sign out exit", run: act(() => { signOut(); }) },
      ],
    });
    return out;
    // `act`/`go` only close over stable module functions + slug/route
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIds, targetIssues, single, favorites, me, teams, myTeams, theme, slug, route]);

  const commandGroups = useMemo(() => filterGroups(groups, q), [groups, q]);
  const issueMatches = useMemo(() => searchIssues(issues, teams, q), [issues, teams, q]);
  const projectMatches = useMemo(() => searchProjects(projects, q), [projects, q]);
  const issuesFirst = /^([a-z][a-z0-9]*(-|\s+))?\d+$/.test(q) || (issueMatches.length > 0 && commandGroups.length === 0);

  const issueGroup = issueMatches.length > 0 && (
    <Command.Group key="issues" heading="Issues">
      {issueMatches.map((i) => {
        const key = issueKey(i, teams);
        return (
          <Command.Item
            key={i.id}
            value={`issue:${i.id}`}
            onSelect={go({ kind: "issue", identifier: key })}
            className="flex h-10 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-[13px] text-ink"
          >
            <span className="flex w-4 shrink-0 items-center justify-center"><StateGlyph stateId={i.state_id} /></span>
            <span className="w-[68px] shrink-0 truncate text-[12.5px] tabular-nums text-faint">{key}</span>
            <span className={`min-w-0 flex-1 truncate ${i.archived_at ? "text-dim" : ""}`}>{i.title || "Untitled"}</span>
            {i.archived_at && <span className="shrink-0 text-xxs text-faint">Archived</span>}
            {i.assignee_id && <span className="hidden shrink-0 sm:inline-flex"><Avatar userId={i.assignee_id} size={16} /></span>}
          </Command.Item>
        );
      })}
    </Command.Group>
  );

  const projectGroup = projectMatches.length > 0 && (
    <Command.Group key="projects" heading="Projects">
      {projectMatches.map((p) => (
        <Command.Item
          key={p.id}
          value={`project:${p.id}`}
          onSelect={go({ kind: "project", id: p.id, tab: "overview" })}
          className="flex h-10 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-[13px] text-ink"
        >
          <span className="flex w-4 shrink-0 items-center justify-center"><ProjectIcon icon={p.icon} color={p.color} /></span>
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <span className="hidden shrink-0 text-xxs text-faint sm:inline">{PROJECT_STATUS_LABEL[p.status]}</span>
        </Command.Item>
      ))}
    </Command.Group>
  );

  const contextIssue = single;
  const removeContext = () => setTargets([]);
  const nothing = Boolean(q) && !commandGroups.length && !issueMatches.length && !projectMatches.length;

  /* typed text → the full search page (it reads ?q=), so a query never dead-ends */
  const searchGroup = q ? (
    <Command.Group key="search" heading="Search">
      <Command.Item
        value="search:all"
        onSelect={go(`${hrefFor({ kind: "search" }, slug)}?q=${encodeURIComponent(query.trim())}`)}
        className="flex h-10 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-[13px] text-ink"
      >
        <span className="flex w-4 shrink-0 items-center justify-center text-dim"><Search size={15} /></span>
        <span className="min-w-0 flex-1 truncate">Search all issues for “{query.trim()}”</span>
      </Command.Item>
    </Command.Group>
  ) : null;

  return (
    <Command label="Command palette" shouldFilter={false} loop vimBindings={false} className="flex flex-col">
      {targetIds.length > 0 && (
        <div className="flex items-center gap-2 px-4 pt-3">
          <span className="inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md bg-wash pl-2 pr-1 text-[12px] font-medium text-dim">
            {contextIssue ? <StateGlyph stateId={contextIssue.state_id} size={12} /> : <CircleDot size={12} className="text-faint" />}
            <span className="truncate">
              {contextIssue ? (
                <>
                  <span className="text-ink">{issueKey(contextIssue, teams)}</span>
                  <span className="ml-1.5 hidden font-normal sm:inline">{contextIssue.title}</span>
                </>
              ) : `${targetIds.length} issues`}
            </span>
            <button
              type="button"
              aria-label="Remove issue context"
              onClick={removeContext}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:bg-line hover:text-ink sm:h-5 sm:w-5"
            >
              <X size={12} />
            </button>
          </span>
        </div>
      )}
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search size={16} className="shrink-0 text-faint" />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !query && targetIds.length) { e.preventDefault(); removeContext(); }
          }}
          placeholder="Type a command or search…"
          className="h-12 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint sm:text-[14px]"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink sm:h-6 sm:w-6"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <Command.List className="max-h-[min(440px,58dvh)] overflow-y-auto overscroll-contain p-1.5">
        {nothing && (
          <div className="flex flex-col items-center gap-1 px-3 pb-3 pt-5 text-center">
            <span className="text-[13px] text-dim">No commands or issues match “{query.trim()}”</span>
            <span className="text-xxs text-faint">Try an issue ID like ENG-12, a title, or a command.</span>
          </div>
        )}
        {issuesFirst && issueGroup}
        {commandGroups.map((g) => (
          <Command.Group key={g.id} heading={g.heading}>
            {g.items.map((c) => (
              <Command.Item
                key={c.id}
                value={`${g.id}:${c.id}`}
                onSelect={c.run}
                className="flex h-10 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-[13px] text-ink"
              >
                <span className="flex w-4 shrink-0 items-center justify-center text-dim">{c.icon}</span>
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.active && <Check size={14} className="shrink-0 text-dim" />}
                {c.shortcut && (
                  <span className="hidden shrink-0 items-center gap-1 sm:flex">
                    {c.shortcut.map((k, i) => <Kbd key={`${k}-${i}`}>{k}</Kbd>)}
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
        {!issuesFirst && issueGroup}
        {projectGroup}
        {searchGroup}
      </Command.List>

      <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-xxs text-faint sm:flex">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> Navigate</span>
        <span className="flex items-center gap-1.5"><Kbd><CornerDownLeft size={10} /></Kbd> Select</span>
        <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd> Close</span>
        {targetIds.length > 0 && !query && (
          <span className="ml-auto flex items-center gap-1.5"><Kbd>{keys.backspace()}</Kbd> Clear context</span>
        )}
      </div>
    </Command>
  );
}
