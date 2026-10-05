"use client";
/* ─── Locus · sidebar navigation ─── */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown, ChevronRight, CircleDot, HelpCircle, Inbox, Layers, LogOut, MoreHorizontal, PanelLeftClose,
  Plus, RefreshCw, Search, Settings, SquarePen, Star, Target, UserPlus, Wifi, WifiOff,
  Hexagon, LayoutList, Check,
} from "lucide-react";
import { useSync, signOut } from "@/lib/sync/store";
import { ui } from "@/lib/ui";
import { linkProps, navigate, useRoute, type Route } from "@/lib/router";
import { issueKey, useMe, useMyTeams, useWorkspace, displayName } from "@/lib/model";
import { toggleFavorite } from "@/lib/sync/actions";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import { Avatar } from "@/components/primitives/Avatar";
import { ProjectIcon, TeamIcon } from "@/components/primitives/icons";
import { StateGlyph } from "@/components/pickers";
import { Tooltip } from "@/components/primitives/controls";
import type { Team } from "@/lib/types";

function sameRoute(a: Route, b: Route) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function NavItem({
  to, icon, label, active, badge, indent = 0, right,
}: { to: Route; icon: ReactNode; label: ReactNode; active: boolean; badge?: number; indent?: number; right?: ReactNode }) {
  return (
    <a
      {...linkProps(to)}
      className={`group flex h-8 items-center gap-2 rounded-md pr-2 text-[13px] transition-colors md:h-7 ${
        active ? "bg-wash font-medium text-ink" : "text-dim hover:bg-wash hover:text-ink"
      }`}
      style={{ paddingLeft: 8 + indent * 18 }}
    >
      <span className={`flex w-4 shrink-0 items-center justify-center ${active ? "text-ink" : "text-faint group-hover:text-dim"}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-semibold leading-[18px] text-accent-ink">{badge > 99 ? "99+" : badge}</span> : null}
      {right}
    </a>
  );
}

function Section({ title, children, defaultOpen = true, action }: { title: string; children: ReactNode; defaultOpen?: boolean; action?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pt-4">
      <div className="group flex h-8 items-center pl-2 pr-1 md:h-6">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex flex-1 items-center gap-1 self-stretch text-[11.5px] font-medium text-faint hover:text-dim">
          {title}
          <ChevronDown size={11} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
        <span className="transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">{action}</span>
      </div>
      {open && <div className="mt-0.5 space-y-px">{children}</div>}
    </div>
  );
}

function TeamNav({ team, route }: { team: Team; route: Route }) {
  const [open, setOpen] = useState(true);
  const inTeam = "key" in route && route.key === team.key;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-dim hover:bg-wash hover:text-ink md:h-7"
      >
        <TeamIcon team={team} size={16} />
        <span className={`min-w-0 flex-1 truncate text-left ${inTeam ? "text-ink" : ""}`}>{team.name}</span>
        {open ? <ChevronDown size={12} className="text-faint" /> : <ChevronRight size={12} className="text-faint" />}
      </button>
      {open && (
        <div className="space-y-px">
          <NavItem indent={1} to={{ kind: "team", key: team.key, tab: "all" }} icon={<CircleDot size={14} />} label="Issues"
            active={route.kind === "team" && route.key === team.key} />
          {team.cycles_enabled && (
            <NavItem indent={1} to={{ kind: "team-cycles", key: team.key }} icon={<RefreshCw size={13} />} label="Cycles"
              active={(route.kind === "team-cycles" || route.kind === "cycle") && route.key === team.key} />
          )}
          <NavItem indent={1} to={{ kind: "team-projects", key: team.key }} icon={<Hexagon size={14} />} label="Projects"
            active={route.kind === "team-projects" && route.key === team.key} />
        </div>
      )}
    </div>
  );
}

function Favorites({ route }: { route: Route }) {
  const favorites = useSync((s) => s.favorites);
  const issues = useSync((s) => s.issues);
  const projects = useSync((s) => s.projects);
  const views = useSync((s) => s.views);
  const teams = useSync((s) => s.teams);
  const cycles = useSync((s) => s.cycles);
  const me = useSync((s) => s.userId);
  const items = useMemo(() => Object.values(favorites).filter((f) => f.user_id === me).sort((a, b) => a.sort_order - b.sort_order).map((f) => {
    switch (f.kind) {
      case "issue": {
        const i = issues[f.target_id];
        return i && { f, to: { kind: "issue", identifier: issueKey(i, teams) } as Route, icon: <StateGlyph stateId={i.state_id} />, label: i.title };
      }
      case "project": {
        const p = projects[f.target_id];
        return p && { f, to: { kind: "project", id: p.id, tab: "overview" } as Route, icon: <ProjectIcon icon={p.icon} color={p.color} />, label: p.name };
      }
      case "view": {
        const v = views[f.target_id];
        return v && { f, to: { kind: "view", id: v.id } as Route, icon: <Layers size={14} style={{ color: v.color }} />, label: v.name };
      }
      case "cycle": {
        const c = cycles[f.target_id];
        const t = c && teams[c.team_id];
        return c && t && { f, to: { kind: "cycle", key: t.key, number: c.number } as Route, icon: <RefreshCw size={13} />, label: c.name || `${t.key} · Cycle ${c.number}` };
      }
      case "team": {
        const t = teams[f.target_id];
        return t && { f, to: { kind: "team", key: t.key, tab: "all" } as Route, icon: <TeamIcon team={t} size={14} />, label: t.name };
      }
    }
    return null;
  }).filter(Boolean) as { f: { kind: "issue" | "project" | "view" | "cycle" | "team"; target_id: string; id: string }; to: Route; icon: ReactNode; label: string }[], [favorites, issues, projects, views, teams, cycles, me]);

  if (!items.length) return null;
  return (
    <Section title="Favorites">
      {items.map((it) => (
        <NavItem
          key={it.f.id} to={it.to} icon={it.icon} label={it.label} active={sameRoute(it.to, route)}
          right={
            <button
              aria-label="Remove from favorites"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(it.f.kind, it.f.target_id); }}
              className="hidden text-faint hover:text-ink [@media(hover:hover)]:group-hover:block"
            >
              <Star size={12} className="fill-current" />
            </button>
          }
        />
      ))}
    </Section>
  );
}

function WorkspaceMenu() {
  const ws = useWorkspace();
  const me = useMe();
  const workspaces = useSync((s) => s.workspaces);
  const all = Object.values(workspaces).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Dropdown
      width={260}
      trigger={(p) => (
        <button ref={p.ref} onClick={p.onClick} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 hover:bg-wash">
          {ws?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ws.logo_url} alt="" className="h-5 w-5 shrink-0 rounded-[5px] object-cover" />
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-accent text-[11px] font-semibold text-white">
              {ws?.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate text-[13px] font-semibold text-ink">{ws?.name}</span>
          <ChevronDown size={12} className="shrink-0 text-faint" />
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="border-b border-line px-3 py-2.5">
            <div className="truncate text-[12.5px] font-medium text-ink">{displayName(me)}</div>
            <div className="truncate text-xxs text-faint">{me?.email}</div>
          </div>
          <ActionMenu
            onDone={close}
            items={[
              { id: "settings", label: "Workspace settings", icon: <Settings size={14} />, onSelect: () => navigate({ kind: "settings", section: "workspace" }) },
              { id: "invite", label: "Invite members", icon: <UserPlus size={14} />, onSelect: () => navigate({ kind: "settings", section: "members" }) },
              ...all.map((w, i) => ({
                id: `ws-${w.id}`,
                divider: i === 0,
                label: w.name,
                icon: w.id === ws?.id ? <Check size={14} /> : <span className="h-3.5 w-3.5" />,
                onSelect: () => { if (w.id !== ws?.id) window.location.assign(`/${w.slug}`); },
              })),
              { id: "new-ws", label: "Create or join a workspace", icon: <Plus size={14} />, onSelect: () => window.location.assign("/onboarding?new=1") },
              { id: "logout", divider: true, label: "Log out", icon: <LogOut size={14} />, onSelect: () => signOut() },
            ]}
          />
        </div>
      )}
    </Dropdown>
  );
}

/** Current time, re-read every minute and when the tab becomes visible (snoozes expire on their own). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return now;
}

export default function Sidebar() {
  const { route } = useRoute();
  const teams = useMyTeams();
  const connection = useSync((s) => s.connection);
  const now = useMinuteClock();
  const unread = useSync((s) => {
    let n = 0;
    for (const x of Object.values(s.notifications)) {
      if (!x.read_at && !x.archived_at && (!x.snoozed_until || Date.parse(x.snoozed_until) <= now)) n++;
    }
    return n;
  });
  const me = useMe();

  return (
    <aside className="flex h-full w-full flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-1 px-2.5 pb-1 pt-2.5">
        <WorkspaceMenu />
        <Tooltip label="Search" shortcut={["/"]}>
          <button aria-label="Search" onClick={() => navigate({ kind: "search" })} className="flex h-8 w-8 items-center justify-center rounded-md text-dim hover:bg-wash hover:text-ink md:h-7 md:w-7">
            <Search size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Create new issue" shortcut={["C"]}>
          <button aria-label="Create new issue" onClick={() => ui.openCreateIssue()} className="flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-surface text-dim shadow-card hover:text-ink md:h-7 md:w-7">
            <SquarePen size={14} />
          </button>
        </Tooltip>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-4 pt-2">
        <div className="space-y-px">
          <NavItem to={{ kind: "inbox" }} icon={<Inbox size={15} />} label="Inbox" active={route.kind === "inbox"} badge={unread} />
          <NavItem to={{ kind: "my-issues", tab: "assigned" }} icon={<Target size={15} />} label="My issues" active={route.kind === "my-issues"} />
        </div>

        <Section title="Workspace">
          <NavItem to={{ kind: "projects", tab: "all" }} icon={<Hexagon size={15} />} label="Projects" active={route.kind === "projects" || route.kind === "project"} />
          <NavItem to={{ kind: "views" }} icon={<Layers size={15} />} label="Views" active={route.kind === "views" || route.kind === "view"} />
          <NavItem to={{ kind: "settings", section: "teams" }} icon={<LayoutList size={15} />} label="Teams" active={route.kind === "settings" && route.section === "teams" && !route.teamKey} />
        </Section>

        <Favorites route={route} />

        <Section
          title="Your teams"
          action={
            <a {...linkProps({ kind: "settings", section: "teams" })} aria-label="Manage teams" className="flex h-7 w-7 items-center justify-center rounded text-faint hover:bg-wash hover:text-ink md:h-5 md:w-5">
              <MoreHorizontal size={13} />
            </a>
          }
        >
          {teams.map((t) => <TeamNav key={t.id} team={t} route={route} />)}
          {!teams.length && (
            <a {...linkProps({ kind: "settings", section: "teams" })} className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-faint hover:bg-wash hover:text-ink md:h-7">
              <Plus size={14} /> Join or create a team
            </a>
          )}
        </Section>
      </nav>

      <div className="flex items-center gap-1 border-t border-line px-2.5 py-2">
        <a {...linkProps({ kind: "settings", section: "account" })} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-wash md:py-1">
          <Avatar profile={me} size={20} />
          <span className="truncate text-[12.5px] text-dim">{displayName(me)}</span>
        </a>
        <Tooltip label={connection === "live" ? "Synced in real time" : connection === "offline" ? "Offline — reconnecting" : "Connecting…"} side="top">
          <span className="flex h-8 w-8 items-center justify-center text-faint md:h-7 md:w-7">
            {connection === "offline" ? <WifiOff size={14} className="text-warning" /> : <Wifi size={14} className={connection === "live" ? "text-success" : ""} />}
          </span>
        </Tooltip>
        <Tooltip label="Keyboard shortcuts" shortcut={["?"]} side="top">
          <button aria-label="Keyboard shortcuts" onClick={ui.openShortcuts} className="flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink md:h-7 md:w-7">
            <HelpCircle size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Collapse sidebar" shortcut={["["]} side="top">
          <button aria-label="Collapse sidebar" onClick={ui.toggleSidebar} className="hidden h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink md:flex">
            <PanelLeftClose size={15} />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

