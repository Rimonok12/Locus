"use client";
/* ─── Locus · settings › teams (team directory + create team) ─── */

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleDot, LogOut, MoreHorizontal, Plus, Settings, Users, X } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast } from "@/lib/ui";
import { COLORS, useMeId, useTeams } from "@/lib/model";
import { createTeam, joinTeam, leaveTeam, updateTeam } from "@/lib/sync/actions";
import { linkProps, navigate, type Route } from "@/lib/router";
import { teamKeyFrom } from "@/lib/format";
import { Button, Field, Input } from "@/components/primitives/controls";
import { Dropdown, Modal } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import { TeamIcon } from "@/components/primitives/icons";
import type { Team } from "@/lib/types";
import { Badge, Card, ColorSwatches, Count, EmojiMenu, FOCUS, PopoverBody, Section, SettingsPage } from "./kit";

export const TEAM_KEY = /^[A-Z][A-Z0-9]{0,6}$/;

const teamRoute = (t: Pick<Team, "key">): Route => ({ kind: "settings", section: "teams", teamKey: t.key });

/** Validation shared by "create team" and "rename key": format + uniqueness (archived teams included). */
export function teamKeyError(key: string, teams: Record<string, Team>, selfId?: string): string | null {
  if (!key) return "The team needs an identifier";
  if (!TEAM_KEY.test(key)) return "1–7 characters: uppercase letters and numbers, starting with a letter";
  const clash = Object.values(teams).find((t) => t.id !== selfId && t.key === key);
  return clash ? `${key} is already used by ${clash.name}` : null;
}

/** teamKeyFrom(name), made unique by a numeric suffix when needed. */
function uniqueKey(name: string, teams: Record<string, Team>): string {
  if (!name.trim()) return "";
  const base = teamKeyFrom(name);
  const used = new Set(Object.values(teams).map((t) => t.key));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = String(n);
    const k = base.slice(0, 7 - suffix.length) + suffix;
    if (!used.has(k)) return k;
  }
  return base;
}

export default function TeamsSettings() {
  const teams = useTeams();
  const teamMembers = useSync((s) => s.team_members);
  const issues = useSync((s) => s.issues);
  const me = useMeId();
  const [creating, setCreating] = useState(false);

  const stats = useMemo(() => {
    const members: Record<string, number> = {};
    const open: Record<string, number> = {};
    for (const r of Object.values(teamMembers)) members[r.team_id] = (members[r.team_id] ?? 0) + 1;
    for (const i of Object.values(issues)) if (!i.archived_at) open[i.team_id] = (open[i.team_id] ?? 0) + 1;
    return { members, issues: open };
  }, [teamMembers, issues]);

  const open = (t: Team) => navigate(teamRoute(t));

  const leave = async (t: Team) => {
    if (await leaveTeam(t.id)) {
      toast(`Left ${t.name}`, { label: "Undo", run: () => { void joinTeam(t.id); } });
    }
  };

  return (
    <SettingsPage
      title="Teams"
      description="Teams own issues, workflows and cycles. Join the teams you work with to see them in your sidebar."
      actions={<Button variant="primary" size="md" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Create team</Button>}
    >
      <Section title={<>All teams <Count n={teams.length} /></>}>
        <Card>
          {teams.map((t) => {
            const joined = Boolean(teamMembers[`${t.id}:${me}`]);
            const memberCount = stats.members[t.id] ?? 0;
            const issueCount = stats.issues[t.id] ?? 0;
            return (
              <div key={t.id} className="group relative flex min-h-[52px] items-center gap-3 py-2 pl-4 pr-2 transition-colors hover:bg-wash">
                <TeamIcon team={t} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    {/* the link stretches over the whole row; controls on the right sit above it */}
                    <a
                      {...linkProps(teamRoute(t))}
                      className="truncate text-[13px] font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent"
                    >
                      {t.name}
                    </a>
                    <span className="shrink-0 text-xxs font-medium text-faint">{t.key}</span>
                  </div>
                  <div className="truncate text-xxs text-faint md:hidden">
                    {memberCount} {memberCount === 1 ? "member" : "members"} · {issueCount} {issueCount === 1 ? "issue" : "issues"}
                  </div>
                  {t.description && <div className="hidden truncate text-xxs text-faint md:block">{t.description}</div>}
                </div>
                <span className="hidden w-[64px] shrink-0 items-center justify-end gap-1.5 text-[12.5px] tabular-nums text-dim md:flex" title="Members">
                  <Users size={13} className="text-faint" />{memberCount}
                </span>
                <span className="hidden w-[72px] shrink-0 items-center justify-end gap-1.5 text-[12.5px] tabular-nums text-dim md:flex" title="Issues">
                  <CircleDot size={13} className="text-faint" />{issueCount}
                </span>
                <div className="pointer-events-none relative z-[1] flex w-[70px] shrink-0 justify-end">
                  {joined ? (
                    <Badge tone="accent">Joined</Badge>
                  ) : (
                    <Button
                      size="sm" className="pointer-events-auto max-sm:h-8"
                      aria-label={`Join ${t.name}`}
                      onClick={async () => { if (await joinTeam(t.id)) toast.success(`Joined ${t.name}`); }}
                    >
                      Join
                    </Button>
                  )}
                </div>
                <Dropdown
                  align="end"
                  trigger={(p) => (
                    <button
                      ref={p.ref}
                      type="button"
                      onClick={p.onClick}
                      aria-expanded={p["aria-expanded"]}
                      aria-label={`Actions for ${t.name}`}
                      className={`focus-ring relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface hover:text-ink ${p.open ? "bg-surface text-ink" : ""}`}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  )}
                >
                  {(close) => (
                    <PopoverBody focus={FOCUS.menu}>
                      <ActionMenu
                        onDone={close}
                        items={[
                          { id: "settings", label: "Team settings", icon: <Settings size={14} />, onSelect: () => open(t) },
                          joined
                            ? { id: "leave", label: "Leave team", icon: <LogOut size={14} />, danger: true, divider: true, onSelect: () => { void leave(t); } }
                            : { id: "join", label: "Join team", icon: <Plus size={14} />, divider: true, onSelect: async () => { if (await joinTeam(t.id)) toast.success(`Joined ${t.name}`); } },
                        ]}
                      />
                    </PopoverBody>
                  )}
                </Dropdown>
              </div>
            );
          })}
          {!teams.length && (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <Users size={22} strokeWidth={1.6} className="mb-2.5 text-faint" />
              <div className="text-[13px] font-medium text-ink">No teams yet</div>
              <p className="mt-1 max-w-[320px] text-[12.5px] text-dim">Create a team to start tracking issues, workflows and cycles.</p>
              <Button className="mt-4" variant="primary" icon={<Plus size={13} />} onClick={() => setCreating(true)}>Create team</Button>
            </div>
          )}
        </Card>
      </Section>

      <CreateTeamModal open={creating} onClose={() => setCreating(false)} />
    </SettingsPage>
  );
}

/* ═══ create team ═══ */

export function CreateTeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // the form mounts fresh on every open (Modal renders nothing while closed)
  const busy = useRef(false);
  return (
    <Modal open={open} onClose={() => { if (!busy.current) onClose(); }} width={480} label="Create team">
      <CreateTeamForm onClose={onClose} busyRef={busy} />
    </Modal>
  );
}

function CreateTeamForm({ onClose, busyRef }: { onClose: () => void; busyRef: { current: boolean } }) {
  const allTeams = useSync((s) => s.teams);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [color, setColor] = useState(() => COLORS[Object.keys(useSync.getState().teams).length % COLORS.length]);
  const [icon, setIcon] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { busyRef.current = false; }, [busyRef]);

  const effectiveKey = keyEdited ? key : uniqueKey(name, allTeams);
  const nameErr = !name.trim() ? "Give the team a name" : name.trim().length > 64 ? "64 characters max" : null;
  const keyErr = teamKeyError(effectiveKey, allTeams);
  const showNameErr = attempted ? nameErr : null;
  const showKeyErr = keyEdited || attempted ? keyErr : null;

  const submit = async () => {
    setAttempted(true);
    if (nameErr || keyErr || busy) return;
    setBusy(true);
    busyRef.current = true;
    try {
      const team = await createTeam(name.trim(), effectiveKey, color);
      if (!team) return;
      if (icon) await updateTeam(team.id, { icon });
      busyRef.current = false;
      onClose();
      navigate({ kind: "settings", section: "teams", teamKey: team.key });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-semibold text-ink">Create a new team</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          className="focus-ring -mr-1.5 flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <X size={15} />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2.5">
          <TeamIcon team={{ key: effectiveKey || "T", color, icon }} size={28} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-ink">{name.trim() || "Team name"}</div>
            <div className="text-xxs text-faint">Issues will look like {effectiveKey || "KEY"}-123</div>
          </div>
        </div>

        <Field label="Name" error={showNameErr}>
          <Input
            autoFocus
            value={name}
            maxLength={64}
            invalid={Boolean(showNameErr)}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Engineering"
          />
        </Field>

        <Field label="Identifier" error={showKeyErr} hint="Used in issue IDs. Uppercase letters and numbers, up to 7 characters.">
          <Input
            value={effectiveKey}
            maxLength={7}
            invalid={Boolean(showKeyErr)}
            onChange={(e) => { setKeyEdited(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7)); }}
            placeholder="ENG"
            className="font-medium uppercase tracking-wide"
            spellCheck={false}
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Color</span>
          <ColorSwatches value={color} onChange={setColor} />
        </div>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Icon <span className="font-normal text-faint">· optional</span>
          </span>
          <div className="flex items-center gap-2">
            <EmojiMenu
              value={icon}
              onChange={setIcon}
              preview={icon ? <span className="text-[15px] leading-none">{icon}</span> : <TeamIcon team={{ key: effectiveKey || "T", color, icon: null }} size={16} />}
            />
            {icon && (
              <Button type="button" size="sm" className="max-sm:h-8" variant="ghost" onClick={() => setIcon(null)}>Remove</Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line bg-raised px-5 py-3">
        <Button type="button" variant="ghost" className="max-sm:h-8" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" className="max-sm:h-8" loading={busy}>Create team</Button>
      </div>
    </form>
  );
}
