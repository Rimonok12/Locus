/* ─── Locus · marketing landing page (server component, shown to signed-out visitors on "/") ─── */

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight, AtSign, ChevronRight, Command, Github, Hexagon, Inbox, Keyboard, Radio, RefreshCw, Search,
} from "lucide-react";
import { HealthDot, LocusMark, ProgressRing, ProjectIcon, StateIcon } from "@/components/primitives/icons";
import { ProgressBar } from "@/components/primitives/controls";
import ThemeSync from "@/components/auth/ThemeSync";
import { buttonClass } from "@/components/auth/utils";
import ProductMock, { MockAvatar } from "./ProductMock";

const GITHUB_URL = "https://github.com/Rimonok12/Locus";

/* ─── small building blocks ─── */

function Key({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 items-center justify-center rounded-md border border-line-strong bg-surface px-1.5 text-[12px] font-medium text-dim shadow-[inset_0_-1px_0_var(--line-strong)] ${wide ? "min-w-[38px]" : "min-w-[28px]"}`}
    >
      {children}
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] font-medium text-accent">{children}</p>;
}

function FeatureCard({ icon, title, body, visual }: { icon: ReactNode; title: string; body: string; visual: ReactNode }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-card transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong">
      <div className="mb-5 flex h-[84px] items-center overflow-hidden rounded-lg border border-line bg-canvas px-3.5">{visual}</div>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent">{icon}</span>
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-dim">{body}</p>
    </div>
  );
}

/* ─── feature visuals ─── */

const keyboardVisual = (
  <div className="flex flex-wrap items-center gap-1.5">
    <Key>C</Key><Key wide>⌘K</Key><Key>J</Key><Key>K</Key><Key>X</Key><Key>S</Key><Key>A</Key><Key>P</Key>
  </div>
);

const realtimeVisual = (
  <div className="w-full space-y-2 text-[12px]">
    <div className="flex items-center gap-2">
      <MockAvatar person={{ initials: "SN", hue: 300 }} size={18} />
      <span className="min-w-0 flex-1 truncate text-dim">
        <span className="font-medium text-ink">Sam</span> moved ENG-198 to{" "}
        <span className="inline-flex translate-y-[2px]"><StateIcon type="completed" color="#3f72af" size={12} /></span>{" "}
        <span className="text-ink">Done</span>
      </span>
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
    </div>
    <div className="flex items-center gap-2 opacity-70">
      <MockAvatar person={{ initials: "AK", hue: 18 }} size={18} />
      <span className="min-w-0 flex-1 truncate text-dim">
        <span className="font-medium text-ink">Aisha</span> assigned ENG-226 to you
      </span>
      <span className="shrink-0 text-[11px] text-faint">now</span>
    </div>
  </div>
);

const cyclesVisual = (
  <div className="w-full">
    <div className="flex items-center gap-2 text-[12px]">
      <ProgressRing value={0.68} size={14} />
      <span className="font-medium text-ink">Cycle 24</span>
      <span className="truncate text-faint">Oct 6 – Oct 20</span>
      <span className="ml-auto text-faint">68%</span>
    </div>
    <ProgressBar value={0.68} className="mt-2.5" />
    <div className="mt-2 flex gap-3 text-[11px] text-faint">
      <span><span className="text-dim">17</span> done</span>
      <span><span className="text-dim">5</span> in progress</span>
      <span><span className="text-dim">3</span> todo</span>
    </div>
  </div>
);

const projectsVisual = (
  <div className="w-full space-y-2 text-[12px]">
    <div className="flex items-center gap-2">
      <ProjectIcon icon={null} color="#26b5ce" />
      <span className="font-medium text-ink">Realtime v2</span>
      <span className="ml-auto flex items-center gap-1.5 text-dim"><HealthDot health="on_track" size={7} /> On track</span>
    </div>
    <div className="flex items-center gap-2">
      <ProjectIcon icon={null} color="#f2994a" />
      <span className="font-medium text-ink">Mobile polish</span>
      <span className="ml-auto flex items-center gap-1.5 text-dim"><HealthDot health="at_risk" size={7} /> At risk</span>
    </div>
  </div>
);

const commandVisual = (
  <div className="flex h-9 w-full items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 shadow-card">
    <Search size={13} className="shrink-0 text-faint" />
    <span className="min-w-0 flex-1 truncate text-[12.5px] text-faint">Search or run a command…</span>
    <span className="flex shrink-0 gap-1"><kbd>⌘</kbd><kbd>K</kbd></span>
  </div>
);

const inboxVisual = (
  <div className="w-full space-y-2 text-[12px]">
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <MockAvatar person={{ initials: "ML", hue: 152 }} size={18} />
      <span className="min-w-0 flex-1 truncate text-dim"><span className="font-medium text-ink">Maya</span> mentioned you in ENG-214</span>
      <AtSign size={12} className="shrink-0 text-faint" />
    </div>
    <div className="flex items-center gap-2 opacity-70">
      <span className="h-1.5 w-1.5 shrink-0" />
      <MockAvatar person={{ initials: "RD", hue: 232 }} size={18} />
      <span className="min-w-0 flex-1 truncate text-dim"><span className="font-medium text-ink">Rimon</span> commented on ENG-209</span>
    </div>
  </div>
);

const FEATURES = [
  {
    icon: <Keyboard size={13} />, title: "Keyboard-first", visual: keyboardVisual,
    body: "Create, triage, assign and move issues without touching the mouse. J/K to navigate, X to select, one key for every property.",
  },
  {
    icon: <Radio size={13} />, title: "Real-time sync", visual: realtimeVisual,
    body: "Every edit appears instantly — for you, optimistically, and for your teammates over a live Postgres change stream.",
  },
  {
    icon: <RefreshCw size={12} />, title: "Cycles", visual: cyclesVisual,
    body: "Time-boxed sprints with progress, scope tracking and one-click rollover of unfinished work into the next cycle.",
  },
  {
    icon: <Hexagon size={13} />, title: "Projects & updates", visual: projectsVisual,
    body: "Group work across teams with leads, milestones, target dates and health updates that keep everyone aligned.",
  },
  {
    icon: <Command size={13} />, title: "Command menu", visual: commandVisual,
    body: "Press ⌘K from anywhere to jump to any issue, project or view — or to run any action on the current selection.",
  },
  {
    icon: <Inbox size={13} />, title: "Inbox & mentions", visual: inboxVisual,
    body: "Assignments, @mentions, comments and status changes land in one inbox you can read, snooze and archive.",
  },
];

const STATS = [
  { value: "0 ms", label: "spent waiting on the network. Edits apply locally first and sync in the background." },
  { value: "1 key", label: "to create, assign, prioritize or move an issue. No menus to dig through." },
  { value: "Live", label: "updates for the whole team, streamed from Postgres the moment anything changes." },
  { value: "100%", label: "of tables protected by Postgres row-level security, so every workspace stays private." },
];

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["C"], label: "Create issue" },
  { keys: ["⌘", "K"], label: "Command menu" },
  { keys: ["G", "I"], label: "Go to inbox" },
  { keys: ["/"], label: "Search" },
  { keys: ["?"], label: "All shortcuts" },
];

const gradientText = {
  backgroundImage: "linear-gradient(180deg, var(--ink) 30%, color-mix(in srgb, var(--ink) 60%, var(--canvas)))",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
} as const;

export default function Landing() {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-[100dvh] overflow-x-clip bg-canvas text-ink">
      <ThemeSync />

      {/* ─── nav ─── */}
      <header
        className="sticky top-0 z-40 border-b border-line backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--canvas) 80%, transparent)" }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="focus-ring flex items-center gap-2 rounded-md">
            <LocusMark size={22} />
            <span className="text-[14.5px] font-semibold tracking-[-0.015em]">Locus</span>
          </Link>
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main">
            <a href="#features" className={buttonClass("ghost", "md")}>Features</a>
            <a href="#speed" className={buttonClass("ghost", "md")}>Speed</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={buttonClass("ghost", "md")}>GitHub</a>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <Link href="/login" className={buttonClass("ghost", "md")}>Log in</Link>
            <Link href="/signup" className={buttonClass("primary", "md")}>Sign up</Link>
          </div>
        </div>
      </header>

      {/* ─── hero ─── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[640px]"
          style={{ background: "radial-gradient(60% 55% at 50% 0%, var(--accent-soft), transparent 75%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage: "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(60% 50% at 50% 0%, black, transparent 80%)",
            WebkitMaskImage: "radial-gradient(60% 50% at 50% 0%, black, transparent 80%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-14 text-center sm:px-6 sm:pb-32 sm:pt-24 lg:pt-28">
          <a
            href="#features"
            className="anim-fade focus-ring inline-flex h-7 items-center gap-2 rounded-full border border-line bg-surface pl-2.5 pr-2 text-[12px] font-medium text-dim shadow-card transition-colors hover:border-line-strong hover:text-ink"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Real-time sync · Command menu · Cycles
            <ChevronRight size={12} className="text-faint" />
          </a>
          <h1
            className="mx-auto mt-6 max-w-4xl text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[60px] lg:text-[72px]"
            style={gradientText}
          >
            Issue tracking at the speed of thought.
          </h1>
          <p className="mx-auto mt-5 max-w-[620px] text-balance text-[15px] leading-relaxed text-dim sm:text-[17px]">
            Locus is a keyboard-first, real-time issue tracker for software teams. Plan cycles, ship projects and clear your
            inbox — every action is a keystroke away, and every change syncs instantly.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:items-center">
            <Link href="/signup" className={buttonClass("primary", "lg", "sm:min-w-[148px]")}>
              Get started <ArrowRight size={15} />
            </Link>
            <Link href="/login" className={buttonClass("secondary", "lg", "sm:min-w-[120px]")}>
              Log in
            </Link>
          </div>
          <p className="mt-5 hidden items-center justify-center gap-1.5 text-[12px] text-faint sm:flex">
            Press <kbd>C</kbd> to create an issue, <kbd>⌘</kbd><kbd>K</kbd> for everything else.
          </p>

          <ProductMock />
        </div>
      </section>

      {/* ─── features ─── */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <Eyebrow>Features</Eyebrow>
          <h2 className="mt-2 text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
            A tracker that keeps up with you.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-dim">
            Everything a software team needs to plan and ship — designed around speed, focus and clarity, with nothing in your way.
          </p>
        </div>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => <FeatureCard key={f.title} {...f} />)}
        </div>
      </section>

      {/* ─── speed ─── */}
      <section id="speed" className="scroll-mt-16 border-y border-line bg-sidebar">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <Eyebrow>Built for speed</Eyebrow>
            <h2 className="mt-2 text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
              Every interaction feels instant.
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-dim">
              Locus keeps your workspace in memory, writes optimistically and reconciles in the background. Reloads start
              from a local snapshot, so you’re never staring at a spinner.
            </p>
          </div>
          <dl className="mt-12 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.value} className="flex flex-col-reverse border-l border-line-strong pl-4">
                <dt className="mt-2 text-[13px] leading-relaxed text-dim">{s.label}</dt>
                <dd className="text-[34px] font-semibold leading-none tracking-[-0.035em] text-ink sm:text-[40px]">{s.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-14 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-8">
            {SHORTCUTS.map((s) => (
              <span key={s.label} className="flex items-center gap-2 text-[12.5px] text-dim">
                <span className="flex gap-1">{s.keys.map((k) => <Key key={k}>{k}</Key>)}</span>
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─── final call to action ─── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px]"
          style={{ background: "radial-gradient(55% 70% at 50% 100%, var(--accent-soft), transparent 75%)" }}
        />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6 sm:py-32">
          <LocusMark size={44} />
          <h2 className="mx-auto mt-6 max-w-2xl text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]" style={gradientText}>
            Plan, build and ship at the speed of thought.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-balance text-[15px] leading-relaxed text-dim">
            Create a workspace, invite your team and start shipping.
          </p>
          <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-2.5 sm:w-auto sm:flex-row sm:items-center">
            <Link href="/signup" className={buttonClass("primary", "lg", "sm:min-w-[148px]")}>
              Get started <ArrowRight size={15} />
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={buttonClass("secondary", "lg", "sm:min-w-[148px]")}>
              <Github size={15} /> View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ─── footer ─── */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:px-6">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <LocusMark size={18} />
            <span className="text-[13px] font-semibold">Locus</span>
            <span className="text-[12.5px] text-faint">· Built by Rimon Debnath · © {year}</span>
          </div>
          <nav className="-ml-3 flex flex-wrap items-center gap-x-0.5 gap-y-1 sm:ml-auto" aria-label="Footer">
            <a href="#features" className={buttonClass("ghost", "md")}>Features</a>
            <Link href="/login" className={buttonClass("ghost", "md")}>Log in</Link>
            <Link href="/signup" className={buttonClass("ghost", "md")}>Sign up</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={buttonClass("ghost", "md")}>
              <Github size={14} /> GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
