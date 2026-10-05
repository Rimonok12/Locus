/* ─── Locus · landing hero illustration: the app, drawn in HTML/CSS ───
   Server component. Static marketing artwork built from the real glyph primitives. */

import type { ReactNode } from "react";
import {
  ChevronDown, Hexagon, Inbox, Layers, ListFilter, Plus, RefreshCw, Search, SlidersHorizontal, SquarePen,
  Tag, Target, UserRound, CircleDot,
} from "lucide-react";
import { PriorityIcon, StateIcon, TeamIcon } from "@/components/primitives/icons";
import type { Priority, StateType } from "@/lib/types";

type Person = { initials: string; hue: number };
const RD: Person = { initials: "RD", hue: 232 };
const AK: Person = { initials: "AK", hue: 18 };
const ML: Person = { initials: "ML", hue: 152 };
const SN: Person = { initials: "SN", hue: 300 };

const FEATURE = { name: "Feature", color: "#bb87fc" };
const BUG = { name: "Bug", color: "#eb5757" };
const IMPROVEMENT = { name: "Improvement", color: "#4ea7fc" };

interface MockRow { id: string; title: string; priority: Priority; labels: { name: string; color: string }[]; who: Person | null; date: string; focused?: boolean }
interface MockGroup { name: string; type: StateType; color: string; fraction?: number; rows: MockRow[] }

const GROUPS: MockGroup[] = [
  {
    name: "In Progress", type: "started", color: "#f2c94c", fraction: 0.5,
    rows: [
      { id: "ENG-214", title: "Realtime presence on the issue view", priority: 1, labels: [FEATURE], who: RD, date: "Oct 8" },
      { id: "ENG-209", title: "Optimistic reorder flickers on slow networks", priority: 2, labels: [BUG], who: AK, date: "Oct 9", focused: true },
      { id: "ENG-201", title: "Shortcut hints in every tooltip", priority: 3, labels: [IMPROVEMENT], who: ML, date: "Oct 12" },
    ],
  },
  {
    name: "In Review", type: "started", color: "#0f7488", fraction: 0.78,
    rows: [
      { id: "ENG-198", title: "Cycle burn-up chart tracks scope changes", priority: 2, labels: [FEATURE], who: SN, date: "Oct 7" },
      { id: "ENG-193", title: "Remember board grouping per view", priority: 4, labels: [IMPROVEMENT], who: RD, date: "Oct 10" },
    ],
  },
  {
    name: "Todo", type: "unstarted", color: "var(--faint)",
    rows: [
      { id: "ENG-226", title: "Bulk-edit labels from the command menu", priority: 2, labels: [FEATURE], who: AK, date: "Oct 15" },
      { id: "ENG-224", title: "Sub-issue progress in list rows", priority: 0, labels: [], who: null, date: "" },
      { id: "ENG-219", title: "Snooze inbox notifications until Monday", priority: 3, labels: [IMPROVEMENT], who: ML, date: "Oct 18" },
    ],
  },
];

export function MockAvatar({ person, size = 18 }: { person: Person | null; size?: number }) {
  if (!person) {
    return <span className="inline-block shrink-0 rounded-full border border-dashed border-line-strong" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size, height: size, fontSize: Math.max(8, size * 0.42),
        background: `linear-gradient(135deg, hsl(${person.hue} 58% 56%), hsl(${(person.hue + 28) % 360} 60% 44%))`,
      }}
    >
      {person.initials}
    </span>
  );
}

function SideItem({ icon, label, active, badge, indent }: { icon: ReactNode; label: string; active?: boolean; badge?: string; indent?: boolean }) {
  return (
    <div className={`flex h-7 items-center gap-2 rounded-md pr-2 text-[12.5px] ${indent ? "pl-[26px]" : "pl-2"} ${active ? "bg-wash font-medium text-ink" : "text-dim"}`}>
      <span className={`flex w-4 shrink-0 justify-center ${active ? "text-ink" : "text-faint"}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-[16px] text-accent-ink">{badge}</span>}
    </div>
  );
}

function MockSidebar() {
  return (
    <aside className="hidden w-[208px] shrink-0 flex-col border-r border-line bg-sidebar px-2 py-2.5 md:flex">
      <div className="flex items-center gap-1 px-1">
        <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-accent text-[11px] font-semibold text-accent-ink">A</span>
        <span className="ml-1 text-[12.5px] font-semibold text-ink">Acme</span>
        <ChevronDown size={11} className="text-faint" />
        <span className="ml-auto flex h-6 w-6 items-center justify-center text-faint"><Search size={13} /></span>
        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-line-strong bg-surface text-dim shadow-card"><SquarePen size={12} /></span>
      </div>
      <div className="mt-3 space-y-px">
        <SideItem icon={<Inbox size={14} />} label="Inbox" badge="3" />
        <SideItem icon={<Target size={14} />} label="My issues" />
      </div>
      <div className="mt-4 px-2 text-[11px] font-medium text-faint">Workspace</div>
      <div className="mt-1 space-y-px">
        <SideItem icon={<Hexagon size={14} />} label="Projects" />
        <SideItem icon={<Layers size={14} />} label="Views" />
      </div>
      <div className="mt-4 px-2 text-[11px] font-medium text-faint">Your teams</div>
      <div className="mt-1 space-y-px">
        <div className="flex h-7 items-center gap-2 px-2 text-[12.5px] text-ink">
          <TeamIcon team={{ key: "ENG", color: "#4cb782", icon: null }} size={16} />
          <span className="flex-1">Engineering</span>
          <ChevronDown size={11} className="text-faint" />
        </div>
        <SideItem indent icon={<CircleDot size={13} />} label="Issues" active />
        <SideItem indent icon={<RefreshCw size={12} />} label="Cycles" />
        <SideItem indent icon={<Hexagon size={13} />} label="Projects" />
        <div className="flex h-7 items-center gap-2 px-2 text-[12.5px] text-dim">
          <TeamIcon team={{ key: "DES", color: "#e93d82", icon: null }} size={16} />
          <span className="flex-1">Design</span>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-line px-1.5 pt-2.5">
        <MockAvatar person={RD} size={20} />
        <span className="text-[12px] text-dim">Rimon</span>
      </div>
    </aside>
  );
}

function MockRowView({ row, group }: { row: MockRow; group: MockGroup }) {
  return (
    <div
      className={`relative flex h-9 items-center gap-2.5 border-b border-line px-3 text-[12.5px] sm:px-4 ${row.focused ? "bg-wash" : ""}`}
    >
      {row.focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" aria-hidden />}
      <PriorityIcon priority={row.priority} className={row.priority === 0 ? "shrink-0 text-faint" : "shrink-0 text-dim"} />
      <span className="hidden w-[60px] shrink-0 whitespace-nowrap tabular-nums text-faint sm:block">{row.id}</span>
      <StateIcon type={group.type} color={group.color} fraction={group.fraction} />
      <span className="min-w-0 flex-1 truncate text-ink">{row.title}</span>
      <span className="hidden shrink-0 items-center gap-1 md:flex">
        {row.labels.map((l) => (
          <span key={l.name} className="inline-flex h-[20px] items-center gap-1.5 rounded-full border border-line-strong px-2 text-[11px] font-medium text-dim">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
      </span>
      <span className="hidden w-11 shrink-0 text-right text-[11.5px] text-faint lg:block">{row.date}</span>
      <MockAvatar person={row.who} />
    </div>
  );
}

function MockList() {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-canvas">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
        <TeamIcon team={{ key: "ENG", color: "#4cb782", icon: null }} size={16} />
        <span className="text-[12.5px] font-medium text-ink">Engineering</span>
        <div className="ml-2 hidden items-center gap-1 sm:flex">
          <span className="inline-flex h-6 items-center rounded-md px-2 text-[12px] font-medium text-dim">All issues</span>
          <span className="inline-flex h-6 items-center rounded-md border border-line-strong bg-surface px-2 text-[12px] font-medium text-ink shadow-card">Active</span>
          <span className="inline-flex h-6 items-center rounded-md px-2 text-[12px] font-medium text-dim">Backlog</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md text-faint"><ListFilter size={13} /></span>
          <span className="hidden h-6 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 text-[11.5px] font-medium text-dim shadow-card sm:inline-flex">
            <SlidersHorizontal size={12} /> Display
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {GROUPS.map((g) => (
          <div key={g.name}>
            <div className="flex h-8 items-center gap-2 border-b border-line bg-raised px-3 text-[12.5px] sm:px-4">
              <StateIcon type={g.type} color={g.color} fraction={g.fraction} />
              <span className="font-medium text-ink">{g.name}</span>
              <span className="text-faint">{g.rows.length}</span>
              <Plus size={13} className="ml-auto text-faint" />
            </div>
            {g.rows.map((r) => <MockRowView key={r.id} row={r} group={g} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandItem({ icon, label, hint, active }: { icon: ReactNode; label: string; hint?: string; active?: boolean }) {
  return (
    <div className={`flex h-8 items-center gap-2.5 rounded-md px-2 text-[12.5px] ${active ? "bg-wash text-ink" : "text-dim"}`}>
      <span className="flex w-4 shrink-0 justify-center text-faint">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </div>
  );
}

/** Floating ⌘K card that overlaps the window. */
function MockCommandMenu() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-modal">
      <div className="flex h-11 items-center gap-2 border-b border-line px-3">
        <span className="rounded-[5px] bg-wash px-1.5 py-0.5 text-[11px] font-medium text-dim">ENG-209</span>
        <span className="h-4 w-px animate-pulse bg-accent" aria-hidden />
        <span className="truncate text-[12.5px] text-faint">Type a command or search…</span>
        <span className="ml-auto flex shrink-0 gap-1"><kbd>⌘</kbd><kbd>K</kbd></span>
      </div>
      <div className="p-1.5">
        <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-faint">Issue</div>
        <CommandItem active icon={<StateIcon type="started" color="#f2c94c" />} label="Change status…" hint="S" />
        <CommandItem icon={<UserRound size={14} />} label="Assign to…" hint="A" />
        <CommandItem icon={<PriorityIcon priority={2} />} label="Change priority…" hint="P" />
        <CommandItem icon={<Tag size={13} />} label="Add labels…" hint="L" />
        <CommandItem icon={<RefreshCw size={13} />} label="Add to cycle…" />
        <div className="my-1 h-px bg-line" />
        <CommandItem icon={<SquarePen size={13} />} label="Create new issue" hint="C" />
      </div>
    </div>
  );
}

export default function ProductMock() {
  return (
    <div className="relative mx-auto mt-14 max-w-5xl text-left sm:mt-20">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-8 -top-12 bottom-0 sm:-inset-x-16"
        style={{
          background: "radial-gradient(closest-side, color-mix(in srgb, var(--accent) 24%, transparent), transparent)",
          filter: "blur(24px)",
        }}
      />
      <div className="relative overflow-hidden rounded-xl border border-line-strong bg-canvas shadow-modal" role="img" aria-label="The Locus app: a team’s active issues grouped by status, with the command menu open">
        <div className="flex h-9 items-center gap-1.5 border-b border-line bg-sidebar px-3">
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="mx-auto hidden h-5 items-center rounded-md bg-wash px-3 text-[10.5px] text-faint sm:flex">locus · acme / team / ENG / active</span>
        </div>
        <div className="flex h-[380px] sm:h-[440px] lg:h-[470px]">
          <MockSidebar />
          <MockList />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-28" style={{ background: "linear-gradient(to bottom, transparent, var(--canvas))" }} />
      </div>
      <div className="absolute -bottom-10 right-3 hidden w-[300px] sm:block md:-right-6 md:w-[340px]">
        <MockCommandMenu />
      </div>
    </div>
  );
}
