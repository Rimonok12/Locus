"use client";
/* ─── Locus · settings shell: section nav (sidebar on desktop, tab strip on mobile) + routed pages ─── */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, Building2, LayoutGrid, SlidersHorizontal, Tag, User, Users } from "lucide-react";
import { linkProps, navigate, type Route, type SettingsSection } from "@/lib/router";
import { useMyTeams, useTeamByKey } from "@/lib/model";
import { useUI } from "@/lib/ui";
import { ViewHeader, type Crumb } from "@/components/app/Header";
import { anyOverlayOpen } from "@/components/primitives/overlay";
import { TeamIcon } from "@/components/primitives/icons";
import ProfileSettings from "./ProfileSettings";
import PreferencesSettings from "./PreferencesSettings";
import WorkspaceSettings from "./WorkspaceSettings";
import MembersSettings from "./MembersSettings";
import TeamsSettings from "./TeamsSettings";
import TeamSettings from "./TeamSettings";
import LabelsSettings from "./LabelsSettings";

interface NavEntry { section: SettingsSection; label: string; icon: ReactNode }

const GROUPS: { title: string; items: NavEntry[] }[] = [
  {
    title: "Account",
    items: [
      { section: "account", label: "Profile", icon: <User size={14} /> },
      { section: "preferences", label: "Preferences", icon: <SlidersHorizontal size={14} /> },
    ],
  },
  {
    title: "Workspace",
    items: [
      { section: "workspace", label: "General", icon: <Building2 size={14} /> },
      { section: "members", label: "Members", icon: <Users size={14} /> },
      { section: "teams", label: "Teams", icon: <LayoutGrid size={14} /> },
      { section: "labels", label: "Labels", icon: <Tag size={14} /> },
    ],
  },
];

const TITLE: Record<SettingsSection, string> = {
  account: "Profile", preferences: "Preferences", workspace: "General", members: "Members", teams: "Teams", labels: "Labels",
};

const BACK: Route = { kind: "my-issues", tab: "assigned" };

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.closest("[contenteditable='true'], [contenteditable='']")) return true;
  const tag = t.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes((t as HTMLInputElement).type);
}

/** Escape leaves settings (like Linear) when nothing else wants the key. */
function useEscapeToExit() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || anyOverlayOpen()) return;
      const u = useUI.getState();
      if (u.paletteOpen || u.createIssue || u.picker || u.shortcutsOpen || u.confirm || u.mobileNavOpen || u.selected.length || u.peekIssueId) return;
      e.preventDefault();
      navigate(BACK);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function SettingsView({ section, teamKey }: { section: SettingsSection; teamKey?: string }) {
  const myTeams = useMyTeams();
  const team = useTeamByKey(teamKey);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTeamId = useRef<string | undefined>(undefined);
  useEscapeToExit();

  const onTeamPage = Boolean(section === "teams" && teamKey);

  // each page starts at the top — except when the open team's key was just renamed (same team, new URL)
  useLayoutEffect(() => {
    const renamed = onTeamPage && team !== undefined && team.id === lastTeamId.current;
    if (!renamed) scrollRef.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, teamKey]);
  useEffect(() => {
    if (!onTeamPage) lastTeamId.current = undefined;
    else if (team) lastTeamId.current = team.id;
  });

  const teamInNav = onTeamPage && myTeams.some((t) => t.key === teamKey);
  const isActive = (s: SettingsSection) => (s === "teams" ? section === "teams" && (!teamKey || !teamInNav) : !teamKey && section === s);

  const crumbs: Crumb[] = onTeamPage
    ? [{ label: "Settings", to: { kind: "settings", section: "account" } }, { label: "Teams", to: { kind: "settings", section: "teams" } }]
    : [{ label: "Settings" }];
  const title = onTeamPage ? team?.name ?? teamKey : TITLE[section];

  let page: ReactNode = null;
  if (onTeamPage && teamKey) page = <TeamSettings teamKey={teamKey} />;
  else {
    switch (section) {
      case "account": page = <ProfileSettings />; break;
      case "preferences": page = <PreferencesSettings />; break;
      case "workspace": page = <WorkspaceSettings />; break;
      case "members": page = <MembersSettings />; break;
      case "teams": page = <TeamsSettings />; break;
      case "labels": page = <LabelsSettings />; break;
    }
  }

  return (
    <>
      <ViewHeader
        crumbs={crumbs}
        title={title}
        icon={onTeamPage && team ? <TeamIcon team={team} size={16} /> : undefined}
        sub={<MobileTabs isActive={isActive} teamKey={teamKey} />}
      />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings" className="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r border-line bg-sidebar px-2.5 pb-6 pt-3 md:flex">
          <a
            {...linkProps(BACK)}
            className="group mb-1 flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-dim transition-colors hover:bg-wash hover:text-ink"
          >
            <ArrowLeft size={14} className="shrink-0 text-faint transition-colors group-hover:text-ink" />
            <span className="flex-1">Back to app</span>
            <kbd className="opacity-0 transition-opacity group-hover:opacity-100">Esc</kbd>
          </a>
          {GROUPS.map((g) => (
            <NavGroup key={g.title} title={g.title}>
              {g.items.map((it) => (
                <NavLink key={it.section} to={{ kind: "settings", section: it.section }} icon={it.icon} label={it.label} active={isActive(it.section)} />
              ))}
            </NavGroup>
          ))}
          {myTeams.length > 0 && (
            <NavGroup title="Your teams">
              {myTeams.map((t) => (
                <NavLink
                  key={t.id}
                  to={{ kind: "settings", section: "teams", teamKey: t.key }}
                  icon={<TeamIcon team={t} size={16} />}
                  label={t.name}
                  active={teamKey === t.key}
                />
              ))}
            </NavGroup>
          )}
        </nav>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-6 sm:px-6 md:px-8 md:pt-10">{page}</div>
        </div>
      </div>
    </>
  );
}

function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pt-4">
      <div className="flex h-6 items-center px-2 text-[11.5px] font-medium text-faint">{title}</div>
      <div className="mt-0.5 space-y-px">{children}</div>
    </div>
  );
}

function NavLink({ to, icon, label, active }: { to: Route; icon: ReactNode; label: string; active: boolean }) {
  return (
    <a
      {...linkProps(to)}
      aria-current={active ? "page" : undefined}
      className={`group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${
        active ? "bg-wash font-medium text-ink" : "text-dim hover:bg-wash hover:text-ink"
      }`}
    >
      <span className={`flex w-4 shrink-0 items-center justify-center ${active ? "text-ink" : "text-faint group-hover:text-dim"}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </a>
  );
}

/** Below md the nav becomes a horizontally scrolling strip under the header. */
function MobileTabs({ isActive, teamKey }: { isActive: (s: SettingsSection) => boolean; teamKey?: string }) {
  const myTeams = useMyTeams();
  const stripRef = useRef<HTMLDivElement>(null);
  const activeKey = teamKey ?? GROUPS.flatMap((g) => g.items).find((it) => isActive(it.section))?.section ?? "";

  // keep the active tab in view
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>("[aria-current='page']");
    if (!strip || !el || strip.clientWidth === 0) return;
    strip.scrollLeft = Math.max(0, el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2);
  }, [activeKey]);

  const tab = (key: string, to: Route, label: ReactNode, active: boolean) => (
    <a
      key={key}
      {...linkProps(to)}
      aria-current={active ? "page" : undefined}
      className={`focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors ${
        active ? "border-line-strong bg-surface text-ink shadow-card" : "border-transparent text-dim hover:bg-wash hover:text-ink"
      }`}
    >
      {label}
    </a>
  );

  return (
    <div ref={stripRef} className="relative flex items-center gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
      <a
        {...linkProps(BACK)}
        aria-label="Back to app"
        className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink"
      >
        <ArrowLeft size={15} />
      </a>
      {GROUPS.flatMap((g) => g.items).map((it) =>
        tab(it.section, { kind: "settings", section: it.section }, <>{it.icon}{it.label}</>, isActive(it.section)))}
      {myTeams.map((t) =>
        tab(`team-${t.id}`, { kind: "settings", section: "teams", teamKey: t.key }, <><TeamIcon team={t} size={14} />{t.name}</>, teamKey === t.key))}
    </div>
  );
}
