"use client";
/* ─── Locus · settings › one team (general, members, cycles, workflow, labels, danger zone) ─── */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, LogOut, RefreshCw, Trash2, TriangleAlert, UserMinus, UserPlus } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui } from "@/lib/ui";
import { cycleName, cyclePhase, displayName, todayISO, useIsAdmin, useMeId, useTeamByKey, useTeamCycles } from "@/lib/model";
import { createNextCycle, deleteTeam, joinTeam, leaveTeam, updateTeam } from "@/lib/sync/actions";
import { navigate } from "@/lib/router";
import { formatDate } from "@/lib/format";
import { Avatar } from "@/components/primitives/Avatar";
import { Button, EmptyState, Switch } from "@/components/primitives/controls";
import { Dropdown } from "@/components/primitives/overlay";
import { SelectMenu } from "@/components/primitives/SelectMenu";
import { TeamIcon } from "@/components/primitives/icons";
import type { Profile, Team } from "@/lib/types";
import {
  Card, ColorSwatches, Count, DangerOutlineButton, EmojiMenu, FOCUS, PopoverBody, Row, Section, SettingsPage, TextField, TypeToConfirm, plural,
} from "./kit";
import { teamKeyError } from "./TeamsSettings";
import WorkflowEditor from "./WorkflowEditor";
import { LabelsEditor } from "./LabelsSettings";

const JUMPS = [
  { id: "team-general", label: "General" },
  { id: "team-members", label: "Members" },
  { id: "team-cycles", label: "Cycles" },
  { id: "team-workflow", label: "Workflow" },
  { id: "team-labels", label: "Labels" },
  { id: "team-danger", label: "Danger zone" },
];

/** Set while this page deletes its own team, so the optimistic removal doesn't flash "not found" before the redirect. */
let deletingTeamId: string | null = null;

/**
 * Resolve the team for the URL key. If the team's key changes while it is open (renamed here or by a
 * teammate in real time), keep showing it and move the URL to the new key instead of flashing "not found".
 */
function useRoutedTeam(teamKey: string): Team | undefined {
  const byKey = useTeamByKey(teamKey);
  const pin = useRef<{ id: string; key: string } | null>(null);
  if (byKey) pin.current = { id: byKey.id, key: teamKey };
  const pinnedId = !byKey && pin.current && pin.current.key === teamKey ? pin.current.id : null;
  const pinned = useSync((s) => (pinnedId ? s.teams[pinnedId] : undefined));
  const team = byKey ?? pinned;
  const last = useRef<Team | undefined>(undefined);
  if (team) last.current = team;
  useEffect(() => {
    if (team && team.key !== teamKey.toUpperCase()) {
      navigate({ kind: "settings", section: "teams", teamKey: team.key }, { replace: true });
    }
  }, [team, teamKey]);
  if (!team && last.current && last.current.id === deletingTeamId) return last.current;
  return team;
}

export default function TeamSettings({ teamKey }: { teamKey: string }) {
  const team = useRoutedTeam(teamKey);

  if (!team) {
    return (
      <EmptyState
        icon={<TriangleAlert size={26} strokeWidth={1.6} />}
        title={`There's no team “${teamKey}”`}
        body="It may have been deleted, or its identifier changed."
        action={
          <Button variant="primary" icon={<ArrowLeft size={13} />} onClick={() => navigate({ kind: "settings", section: "teams" })}>
            All teams
          </Button>
        }
      />
    );
  }
  return <TeamSettingsBody key={team.id} team={team} />;
}

function TeamSettingsBody({ team }: { team: Team }) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <SettingsPage
      icon={<TeamIcon team={team} size={26} />}
      title={team.name}
      description={team.description || `Settings for the ${team.name} team · issues are ${team.key}-123.`}
    >
      <nav aria-label="Team settings sections" className="-mt-4 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {JUMPS.map((j) => (
          <button
            key={j.id}
            type="button"
            onClick={() => scrollTo(j.id)}
            className="focus-ring inline-flex h-8 shrink-0 items-center rounded-md border border-line px-2.5 text-[12.5px] font-medium text-dim transition-colors hover:bg-wash hover:text-ink"
          >
            {j.label}
          </button>
        ))}
      </nav>
      <GeneralSection team={team} />
      <MembersSection team={team} />
      <CyclesSection team={team} />
      <Section
        id="team-workflow"
        title="Workflow"
        description="The statuses issues move through. Each status belongs to a category that drives progress, cycles and filters."
      >
        <WorkflowEditor team={team} />
      </Section>
      <div id="team-labels" className="scroll-mt-6">
        <LabelsEditor teamId={team.id} />
      </div>
      <DangerSection team={team} />
    </SettingsPage>
  );
}

/* ═══ general ═══ */

function GeneralSection({ team }: { team: Team }) {
  const teams = useSync((s) => s.teams);
  return (
    <Section id="team-general" title="General">
      <Card>
        <Row label="Name">
          <TextField
            className="sm:w-[280px]"
            ariaLabel="Team name"
            value={team.name}
            maxLength={64}
            validate={(v) => (!v ? "The team needs a name" : v.length > 64 ? "64 characters max" : null)}
            onSave={(name) => updateTeam(team.id, { name })}
          />
        </Row>
        <Row
          label="Identifier"
          description={
            <span className="flex items-start gap-1.5">
              <TriangleAlert size={13} className="mt-[2px] shrink-0 text-warning" />
              <span>Changing the key changes all issue identifiers ({team.key}-12 → NEW-12) and links that use them.</span>
            </span>
          }
        >
          <TextField
            className="sm:w-[140px]"
            inputClassName="font-medium uppercase tracking-wide"
            ariaLabel="Team identifier"
            value={team.key}
            maxLength={7}
            normalize={(v) => v.trim().toUpperCase()}
            validate={(v) => teamKeyError(v, teams, team.id)}
            successMessage={null}
            onSave={async (key) => {
              const ok = await updateTeam(team.id, { key });
              if (ok) toast.success(`Identifier changed — issues are now ${key}-…`);
              return ok;
            }}
          />
        </Row>
        <Row label="Color" description="Used for the team icon when no emoji is set." top>
          <div className="sm:max-w-[360px]">
            <ColorSwatches value={team.color} onChange={(color) => { if (color !== team.color) void updateTeam(team.id, { color }); }} />
          </div>
        </Row>
        <Row label="Icon" description="An emoji shown next to the team everywhere.">
          <EmojiMenu
            value={team.icon}
            onChange={(icon) => updateTeam(team.id, { icon })}
            preview={<TeamIcon team={team} size={18} />}
          />
          {team.icon && (
            <Button size="sm" className="max-sm:h-8" variant="ghost" onClick={() => updateTeam(team.id, { icon: null })}>Remove</Button>
          )}
        </Row>
        <Row label="Description" description="What this team works on." top>
          <TextField
            className="sm:w-[320px]"
            ariaLabel="Team description"
            multiline
            rows={2}
            maxLength={500}
            value={team.description}
            placeholder="Add a short description…"
            onSave={(description) => updateTeam(team.id, { description })}
          />
        </Row>
      </Card>
    </Section>
  );
}

/* ═══ members ═══ */

function MembersSection({ team }: { team: Team }) {
  const teamMembers = useSync((s) => s.team_members);
  const wsMembers = useSync((s) => s.workspace_members);
  const profiles = useSync((s) => s.profiles);
  const me = useMeId();

  const rows = useMemo(
    () => Object.values(teamMembers)
      .filter((r) => r.team_id === team.id)
      .map((r) => ({ r, p: profiles[r.user_id] as Profile | undefined }))
      .sort((a, b) => (a.r.user_id === me ? -1 : b.r.user_id === me ? 1 : displayName(a.p).localeCompare(displayName(b.p)))),
    [teamMembers, profiles, team.id, me],
  );
  const candidates = useMemo(() => {
    const inTeam = new Set(rows.map((x) => x.r.user_id));
    return Object.values(wsMembers)
      .filter((m) => !inTeam.has(m.user_id) && profiles[m.user_id])
      .map((m) => profiles[m.user_id])
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [wsMembers, profiles, rows]);

  const add = async (userId: string) => {
    const p = profiles[userId];
    if (await joinTeam(team.id, userId)) toast.success(userId === me ? `Joined ${team.name}` : `Added ${displayName(p)} to ${team.name}`);
  };
  const remove = async (userId: string) => {
    const p = profiles[userId];
    if (await leaveTeam(team.id, userId)) {
      toast(userId === me ? `Left ${team.name}` : `Removed ${displayName(p)} from ${team.name}`, {
        label: "Undo",
        run: () => { void joinTeam(team.id, userId); },
      });
    }
  };

  return (
    <Section
      id="team-members"
      title={<>Members <Count n={rows.length} /></>}
      description="Members see this team in their sidebar and can be assigned its issues."
      action={
        <Dropdown
          width={280}
          align="end"
          disabled={!candidates.length}
          trigger={(p) => (
            <Button
              ref={p.ref}
              size="sm" className="max-sm:h-8"
              icon={<UserPlus size={13} />}
              onClick={p.onClick}
              aria-expanded={p["aria-expanded"]}
              disabled={!candidates.length}
              title={candidates.length ? undefined : "Everyone in the workspace is already in this team"}
            >
              Add member
            </Button>
          )}
        >
          {(close) => (
            <PopoverBody focus={FOCUS.search}>
              <SelectMenu
                items={candidates.map((p) => ({
                  id: p.id,
                  label: p.id === me ? `${displayName(p)} (you)` : displayName(p),
                  icon: <Avatar profile={p} size={16} />,
                  keywords: [p.email, p.display_name],
                }))}
                onSelect={(id) => { close(); void add(id); }}
                placeholder="Add to team…"
                emptyText="No one to add"
                digitShortcuts={false}
              />
            </PopoverBody>
          )}
        </Dropdown>
      }
    >
      <Card>
        {rows.map(({ r, p }) => {
          const self = r.user_id === me;
          return (
            <div key={r.user_id} className="flex min-h-[48px] items-center gap-3 py-1.5 pl-4 pr-2">
              <Avatar profile={p ?? null} userId={r.user_id} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-ink">{displayName(p)}</span>
                  {self && <span className="shrink-0 text-xxs text-faint">(you)</span>}
                </div>
                <div className="truncate text-xxs text-faint">{p?.email}</div>
              </div>
              <span className="hidden w-[96px] shrink-0 text-right text-xxs text-faint sm:block" title="Joined team">
                {formatDate(r.created_at)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={self ? <LogOut size={13} /> : <UserMinus size={13} />}
                onClick={() => { void remove(r.user_id); }}
                aria-label={self ? `Leave ${team.name}` : `Remove ${displayName(p)} from ${team.name}`}
                className="max-sm:h-8"
              >
                <span className="hidden sm:inline">{self ? "Leave" : "Remove"}</span>
              </Button>
            </div>
          );
        })}
        {!rows.length && (
          <div className="px-4 py-8 text-center text-[13px] text-faint">
            Nobody is in this team yet.{" "}
            <button type="button" onClick={() => { void add(me); }} className="font-medium text-accent hover:underline">Join it</button>
          </div>
        )}
      </Card>
    </Section>
  );
}

/* ═══ cycles ═══ */

function CyclesSection({ team }: { team: Team }) {
  const cycles = useTeamCycles(team.id);
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  const current = cycles.find((c) => cyclePhase(c, today) === "current");
  const upcoming = cycles.filter((c) => cyclePhase(c, today) === "upcoming");
  const weeks = team.cycle_duration_weeks || 2;

  /** Turning cycles on makes sure there is a current and an upcoming cycle to plan into. */
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      if (!(await updateTeam(team.id, { cycles_enabled: enabled }))) return;
      if (enabled) {
        const phases = new Set(Object.values(useSync.getState().cycles).filter((c) => c.team_id === team.id).map((c) => cyclePhase(c)));
        if (!phases.has("current") && !phases.has("upcoming")) {
          if (await createNextCycle(team.id)) await createNextCycle(team.id);
        } else if (!phases.has("upcoming")) {
          await createNextCycle(team.id);
        }
      }
      toast.success(enabled ? `Cycles enabled for ${team.name}` : `Cycles turned off for ${team.name}`);
    } finally {
      setBusy(false);
    }
  };

  const createNext = async () => {
    setBusy(true);
    try {
      const c = await createNextCycle(team.id);
      if (c) toast.success(`Created ${cycleName(c)} · ${formatDate(c.starts_at)} – ${formatDate(c.ends_at)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="team-cycles" title="Cycles" description="Repeating, time-boxed periods of work, like sprints.">
      <Card>
        <Row label="Enable cycles" description="Show cycles in the sidebar and let issues be planned into them.">
          <Switch label="Enable cycles" checked={team.cycles_enabled} disabled={busy} onChange={(v) => { void toggle(v); }} />
        </Row>
        <Row label="Cycle duration" description="Applies to cycles created from now on.">
          <Dropdown
            width={160}
            align="end"
            disabled={!team.cycles_enabled}
            trigger={(p) => (
              <button
                ref={p.ref}
                type="button"
                onClick={p.onClick}
                aria-expanded={p["aria-expanded"]}
                aria-label="Cycle duration"
                disabled={!team.cycles_enabled}
                className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink shadow-card hover:bg-wash disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
              >
                {plural(weeks, "week")}
                <ChevronDown size={12} className="text-faint" />
              </button>
            )}
          >
            {(close) => (
              <PopoverBody focus={FOCUS.search}>
                <SelectMenu
                  items={[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: String(n), label: plural(n, "week") }))}
                  selected={String(weeks)}
                  onSelect={(id) => {
                    close();
                    const n = Number(id);
                    if (n === weeks) return;
                    void updateTeam(team.id, { cycle_duration_weeks: n }).then((ok) => { if (ok) toast.success(`Cycles now last ${plural(n, "week")}`); });
                  }}
                  placeholder="Duration…"
                  autoFocus
                />
              </PopoverBody>
            )}
          </Dropdown>
        </Row>
        <Row
          label="Upcoming cycles"
          description={
            team.cycles_enabled
              ? <>
                  {current ? `${cycleName(current)} is running until ${formatDate(current.ends_at)}.` : "No cycle is running right now."}{" "}
                  {upcoming.length ? `${plural(upcoming.length, "upcoming cycle")} planned.` : "Nothing planned yet."}
                </>
              : "Turn on cycles to plan upcoming work."
          }
        >
          <Button size="sm" className="max-sm:h-8" icon={<RefreshCw size={13} />} disabled={!team.cycles_enabled} loading={busy && team.cycles_enabled} onClick={createNext}>
            Create next cycle
          </Button>
        </Row>
      </Card>
    </Section>
  );
}

/* ═══ danger zone ═══ */

function DangerSection({ team }: { team: Team }) {
  const isAdmin = useIsAdmin();
  const me = useMeId();
  const joined = useSync((s) => Boolean(s.team_members[`${team.id}:${me}`]));
  const [deleting, setDeleting] = useState(false);

  const leave = () => {
    ui.askConfirm({
      title: `Leave ${team.name}?`,
      body: "The team disappears from your sidebar. You can join again anytime from Settings › Teams.",
      confirmLabel: "Leave team",
      onConfirm: async () => { if (await leaveTeam(team.id)) toast.success(`Left ${team.name}`); },
    });
  };

  const remove = async () => {
    deletingTeamId = team.id;
    const pending = deleteTeam(team.id);
    navigate({ kind: "settings", section: "teams" });
    const ok = await pending;
    deletingTeamId = null;
    if (ok) toast.success(`Deleted team ${team.name}`);
  };

  return (
    <Section id="team-danger" title="Danger zone" tone="danger">
      <Card tone="danger">
        <Row
          label={joined ? "Leave team" : "Join team"}
          description={joined ? "Stop seeing this team in your sidebar. You can rejoin anytime." : "You're not a member of this team."}
        >
          {joined ? (
            <DangerOutlineButton icon={<LogOut size={13} />} onClick={leave}>Leave team</DangerOutlineButton>
          ) : (
            <Button size="sm" className="max-sm:h-8" icon={<UserPlus size={13} />} onClick={async () => { if (await joinTeam(team.id)) toast.success(`Joined ${team.name}`); }}>
              Join team
            </Button>
          )}
        </Row>
        <Row
          label="Delete team"
          description={
            isAdmin
              ? "Permanently delete the team with all of its issues, cycles, workflow and labels."
              : "Only admins can delete teams."
          }
        >
          <Button size="sm" className="max-sm:h-8" variant="danger" icon={<Trash2 size={13} />} disabled={!isAdmin} onClick={() => setDeleting(true)}>
            Delete team
          </Button>
        </Row>
      </Card>

      <TypeToConfirm
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${team.name}?`}
        expected={team.key}
        confirmLabel="Delete team"
        body={<DeleteTeamSummary team={team} />}
        onConfirm={remove}
      />
    </Section>
  );
}

/** Mounted only while the delete dialog is open, so the per-team counts aren't recomputed on every change. */
function DeleteTeamSummary({ team }: { team: Team }) {
  const issueCount = useSync((s) => {
    let n = 0;
    for (const i of Object.values(s.issues)) if (i.team_id === team.id) n++;
    return n;
  });
  const cycleCount = useSync((s) => {
    let n = 0;
    for (const c of Object.values(s.cycles)) if (c.team_id === team.id) n++;
    return n;
  });
  return (
    <>
      This permanently deletes {team.name}, its {plural(issueCount, "issue")}, {plural(cycleCount, "cycle")}, workflow
      statuses and team labels for everyone. <span className="font-medium text-ink">This can&apos;t be undone.</span>
    </>
  );
}
