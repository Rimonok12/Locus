"use client";
/* ─── Locus · settings › members (invites, invite link, pending invites, members) ─── */

import { useMemo, useState } from "react";
import { Check, ChevronDown, Link2, LogOut, Mail, MoreHorizontal, RefreshCw, Search, UserMinus, UserPlus, X } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui } from "@/lib/ui";
import { displayName, useIsAdmin, useMeId, useWorkspace } from "@/lib/model";
import { createInvite, inviteLink, leaveWorkspace, removeMember, revokeInvite, setMemberRole } from "@/lib/sync/actions";
import { formatDate } from "@/lib/format";
import { Avatar } from "@/components/primitives/Avatar";
import { Button, Input, Textarea } from "@/components/primitives/controls";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu, type ActionItem } from "@/components/primitives/SelectMenu";
import type { Profile, Role, WorkspaceInvite, WorkspaceMember } from "@/lib/types";
import { Badge, Card, CopyButton, Count, Section, SettingsPage, plural } from "./kit";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Manages workspace settings, members and invites." },
  { value: "member", label: "Member", description: "Creates and edits issues, projects, teams and labels." },
];
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", member: "Member" };

const isExpired = (i: WorkspaceInvite) => Boolean(i.expires_at && Date.parse(i.expires_at) < Date.now());

function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).map((p) => p.trim().replace(/^<|>$/g, "").toLowerCase()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!EMAIL.test(p)) { if (!invalid.includes(p)) invalid.push(p); }
    else if (!valid.includes(p)) valid.push(p);
  }
  return { valid, invalid };
}

export default function MembersSettings() {
  const ws = useWorkspace();
  const isAdmin = useIsAdmin();
  const me = useMeId();
  const memberRows = useSync((s) => s.workspace_members);
  const profiles = useSync((s) => s.profiles);
  const invites = useSync((s) => s.workspace_invites);

  const pending = useMemo(
    () => Object.values(invites).filter((i) => !i.accepted_at).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [invites],
  );
  const memberCount = Object.keys(memberRows).length;

  return (
    <SettingsPage
      title="Members"
      description={
        <>
          Manage who has access to {ws?.name ?? "this workspace"}.{" "}
          <span className="text-faint">{plural(memberCount, "member")} · {plural(pending.length, "pending invite")}</span>
        </>
      }
    >
      <InviteSection isAdmin={isAdmin} />
      <InviteLinkSection isAdmin={isAdmin} me={me} />
      {pending.length > 0 && <PendingInvites invites={pending} isAdmin={isAdmin} me={me} profiles={profiles} />}
      <MemberList rows={memberRows} profiles={profiles} isAdmin={isAdmin} me={me} workspaceName={ws?.name ?? "this workspace"} />
    </SettingsPage>
  );
}

/* ═══ role picker ═══ */

/** `locked` maps a role that can't be chosen to the reason shown in its place. */
function RolePicker({
  value, onChange, locked = {}, ghost = false, label = "Role",
}: { value: Role; onChange: (r: Role) => void; locked?: Partial<Record<Role, string>>; ghost?: boolean; label?: string }) {
  return (
    <Dropdown
      width={260}
      align="end"
      trigger={(p) => (
        <Button
          ref={p.ref}
          type="button"
          variant={ghost ? "ghost" : "secondary"}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup="menu"
          aria-label={`${label}: ${ROLE_LABEL[value]}`}
          className={`h-8 ${ghost && p.open ? "bg-wash text-ink" : ""}`}
        >
          {ROLE_LABEL[value]}
          <ChevronDown size={12} className="text-faint" />
        </Button>
      )}
    >
      {(close) => (
        <div className="p-1" role="menu">
          {ROLES.map((r) => {
            const reason = r.value !== value ? locked[r.value] : undefined;
            const disabled = Boolean(reason);
            return (
              <button
                key={r.value}
                type="button"
                role="menuitemradio"
                aria-checked={value === r.value}
                autoFocus={value === r.value}
                disabled={disabled}
                onClick={() => { close(); if (r.value !== value) onChange(r.value); }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-wash focus-visible:bg-wash disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="mt-0.5 flex w-4 shrink-0 justify-center text-dim">{value === r.value && <Check size={14} />}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{r.label}</span>
                  <span className="block text-xxs text-faint">{reason ?? r.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}

/* ═══ invite by email ═══ */

interface InviteResult { email: string; link: string | null; note?: string }

function InviteSection({ isAdmin }: { isAdmin: boolean }) {
  const [text, setText] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const parsed = useMemo(() => parseEmails(text), [text]);
  // losing admin rights mid-session falls back to member invites (the server would refuse admin ones)
  const inviteRole: Role = isAdmin ? role : "member";

  const send = async () => {
    setAttempted(true);
    if (!parsed.valid.length || parsed.invalid.length || busy) return;
    const role = inviteRole;
    setBusy(true);
    try {
      const s = useSync.getState();
      const memberEmails = new Set(
        Object.values(s.workspace_members).map((m) => s.profiles[m.user_id]?.email?.toLowerCase()).filter(Boolean) as string[],
      );
      const out = await Promise.all(
        parsed.valid.map(async (email): Promise<InviteResult> => {
          if (memberEmails.has(email)) return { email, link: null, note: "Already a member" };
          const existing = Object.values(s.workspace_invites).find(
            (i) => i.email === email && !i.accepted_at && i.role === role && i.token && !isExpired(i),
          );
          if (existing) return { email, link: inviteLink(existing.token), note: "Already invited — same link" };
          const inv = await createInvite(email, role);
          return inv?.token ? { email, link: inviteLink(inv.token) } : { email, link: null, note: "Couldn't create invite" };
        }),
      );
      setResults(out);
      const failed = out.filter((r) => !r.link && r.note === "Couldn't create invite").map((r) => r.email);
      setText(failed.join(", "));
      setAttempted(false);
      setTouched(false);
      const created = out.filter((r) => r.link).length;
      if (created) toast.success(created === 1 ? "Invite link ready" : `${created} invite links ready`);
    } finally {
      setBusy(false);
    }
  };

  const ready = results?.filter((r) => r.link) ?? [];
  const invalidMsg = parsed.invalid.length
    ? `Not a valid email: ${parsed.invalid.slice(0, 3).join(", ")}${parsed.invalid.length > 3 ? ` +${parsed.invalid.length - 3} more` : ""}`
    : null;
  const emptyMsg = !parsed.valid.length && !parsed.invalid.length ? "Enter at least one email address" : null;
  const error = attempted ? invalidMsg ?? emptyMsg : touched ? invalidMsg : null;

  return (
    <Section title="Invite people" description="Create personal invite links for your teammates.">
      <Card>
        <form
          className="p-4"
          onSubmit={(e) => { e.preventDefault(); void send(); }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Email addresses</span>
            <Textarea
              rows={2}
              value={text}
              readOnly={busy}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
              }}
              placeholder="jane@company.com, sam@company.com"
              aria-invalid={error ? true : undefined}
              className={`min-h-[60px] resize-y ${error ? "!border-danger" : ""}`}
            />
          </label>
          <div className="mt-1 min-h-[16px] text-xxs">
            {error ? <span className="text-danger">{error}</span> : <span className="text-faint">Separate addresses with commas, spaces or new lines.</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-[12.5px] text-dim">
              {parsed.valid.length ? plural(parsed.valid.length, "invite") : ""}
            </span>
            <span className="text-[12.5px] text-dim">Invite as</span>
            <RolePicker
              value={inviteRole}
              onChange={setRole}
              label="Invite as"
              locked={isAdmin ? {} : { admin: "Only admins can invite admins." }}
            />
            <Button type="submit" variant="primary" size="md" icon={<UserPlus size={14} />} loading={busy}>
              Send invites
            </Button>
          </div>
        </form>

        {results && results.length > 0 && (
          <div className="anim-fade bg-raised px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink">
                  {ready.length ? "Share these links with your teammates" : "No new invites were created"}
                </div>
                <p className="mt-0.5 text-[12.5px] leading-snug text-dim">
                  Locus doesn&apos;t send emails. Each link works once, for that email address, and expires in 14 days.
                </p>
              </div>
              {ready.length > 1 && (
                <CopyButton
                  text={ready.map((r) => `${r.email}: ${r.link}`).join("\n")}
                  what="All invite links copied"
                  label="Copy all"
                />
              )}
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setResults(null)}
                className="focus-ring -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>
            <ul className="mt-2.5 space-y-1">
              {results.map((r) => (
                <li key={r.email} className="flex min-h-[40px] items-center gap-2.5 rounded-md border border-line bg-surface py-1 pl-3 pr-1">
                  <Mail size={14} className="shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink">{r.email}</div>
                    {r.link ? (
                      <div className="truncate text-xxs text-faint">{r.note ? `${r.note} · ` : ""}{r.link}</div>
                    ) : (
                      <div className={`truncate text-xxs ${r.note === "Already a member" ? "text-faint" : "text-danger"}`}>{r.note}</div>
                    )}
                  </div>
                  {r.link && <CopyButton text={r.link} what={`Invite link for ${r.email} copied`} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </Section>
  );
}

/* ═══ reusable invite link ═══ */

function InviteLinkSection({ isAdmin, me }: { isAdmin: boolean; me: string }) {
  const invites = useSync((s) => s.workspace_invites);
  const [busy, setBusy] = useState(false);
  const link = useMemo(
    () => Object.values(invites)
      .filter((i) => !i.email && i.role === "member" && !i.accepted_at && !isExpired(i))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0],
    [invites],
  );
  const creator = useSync((s) => (link?.invited_by ? s.profiles[link.invited_by] : undefined));
  const url = link?.token ? inviteLink(link.token) : null;
  const canReset = Boolean(link && (isAdmin || link.invited_by === me));

  const create = async () => {
    setBusy(true);
    try {
      const inv = await createInvite(null, "member");
      if (inv?.token) {
        const url = inviteLink(inv.token);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(
            () => toast.success("Invite link created and copied"),
            () => toast.success("Invite link created"),
          );
        } else toast.success("Invite link created");
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (!link) return;
    ui.askConfirm({
      title: "Reset invite link?",
      body: "The current link stops working immediately. Anyone who hasn't joined yet will need the new link.",
      confirmLabel: "Reset link",
      destructive: true,
      onConfirm: async () => {
        if (await revokeInvite(link.id)) await create();
      },
    });
  };

  return (
    <Section title="Invite link" description="Anyone with this link can join the workspace as a member.">
      <Card>
        <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center">
          {link ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Link2 size={14} className="shrink-0 text-faint" />
                <Input
                  readOnly
                  value={url ?? "Creating link…"}
                  aria-label="Invite link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 min-w-0 truncate border-line bg-raised font-mono text-[12px] text-dim sm:text-[12px]"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <CopyButton text={url} what="Invite link copied" label="Copy link" />
                <Button
                  size="sm" className="max-sm:h-8"
                  variant="ghost"
                  icon={<RefreshCw size={13} />}
                  disabled={!canReset || busy || !url}
                  title={canReset ? "Revoke this link and create a new one" : "Only admins or the person who created the link can reset it"}
                  onClick={reset}
                >
                  Reset
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-dim">
                Create a shareable link to post in your team chat. Links expire after 14 days and can be revoked anytime.
              </p>
              <Button size="sm" className="max-sm:h-8" variant="primary" icon={<Link2 size={13} />} loading={busy} onClick={create}>
                Create invite link
              </Button>
            </>
          )}
        </div>
        {link?.expires_at && (
          <div className="bg-raised px-4 py-2 text-xxs text-faint">
            Expires {formatDate(link.expires_at)}
            {link.invited_by ? ` · created by ${link.invited_by === me ? "you" : displayName(creator)}` : ""}
          </div>
        )}
      </Card>
    </Section>
  );
}

/* ═══ pending invites ═══ */

function PendingInvites({
  invites, isAdmin, me, profiles,
}: { invites: WorkspaceInvite[]; isAdmin: boolean; me: string; profiles: Record<string, Profile> }) {
  const revoke = (i: WorkspaceInvite) => {
    ui.askConfirm({
      title: "Revoke invite?",
      body: i.email ? `The invite link for ${i.email} will stop working.` : "This invite link will stop working for anyone who hasn't joined yet.",
      confirmLabel: "Revoke",
      destructive: true,
      onConfirm: async () => { if (await revokeInvite(i.id)) toast.success("Invite revoked"); },
    });
  };

  return (
    <Section title={<>Pending invites <Count n={invites.length} /></>}>
      <Card>
        {invites.map((i) => {
          const expired = isExpired(i);
          const inviter = i.invited_by ? profiles[i.invited_by] : undefined;
          const canRevoke = isAdmin || i.invited_by === me;
          const expiry = i.expires_at === undefined
            ? null
            : expired
              ? <span className="text-danger">Expired</span>
              : i.expires_at
                ? `Expires ${formatDate(i.expires_at)}`
                : "Never expires";
          return (
            <div key={i.id} className="flex min-h-[52px] items-center gap-3 py-2 pl-4 pr-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-wash text-faint">
                {i.email ? <Mail size={13} /> : <Link2 size={13} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`truncate text-[13px] ${i.email ? "text-ink" : "text-dim"}`}>{i.email ?? "Anyone with the link"}</div>
                <div className="truncate text-xxs text-faint">
                  <span className="sm:hidden">{ROLE_LABEL[i.role]} · </span>
                  {inviter ? `Invited by ${inviter.id === me ? "you" : displayName(inviter)}` : "Invited"}
                  {expiry && <span className="md:hidden"> · {expiry}</span>}
                </div>
              </div>
              <span className="hidden sm:block"><Badge tone={i.role === "admin" ? "accent" : "neutral"}>{ROLE_LABEL[i.role]}</Badge></span>
              <span className="hidden w-[110px] shrink-0 text-right text-xxs text-faint md:block">{expiry}</span>
              <div className="flex shrink-0 items-center">
                <CopyButton compact text={i.token && !expired ? inviteLink(i.token) : null} label="Copy invite link" what="Invite link copied" />
                <button
                  type="button"
                  onClick={() => revoke(i)}
                  disabled={!canRevoke}
                  aria-label="Revoke invite"
                  title={canRevoke ? "Revoke invite" : "Only admins or the inviter can revoke this invite"}
                  className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-faint transition-colors hover:bg-wash hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

/* ═══ members ═══ */

interface MemberEntry { m: WorkspaceMember; p: Profile | undefined; name: string }

function MemberList({
  rows, profiles, isAdmin, me, workspaceName,
}: { rows: Record<string, WorkspaceMember>; profiles: Record<string, Profile>; isAdmin: boolean; me: string; workspaceName: string }) {
  const [query, setQuery] = useState("");
  const entries = useMemo<MemberEntry[]>(
    () => Object.values(rows)
      .map((m) => ({ m, p: profiles[m.user_id], name: displayName(profiles[m.user_id]) }))
      .sort((a, b) => (a.m.user_id === me ? -1 : b.m.user_id === me ? 1 : a.name.localeCompare(b.name))),
    [rows, profiles, me],
  );
  const q = query.trim().toLowerCase();
  const shown = q
    ? entries.filter(({ p, name }) => [name, p?.display_name, p?.email].some((x) => x?.toLowerCase().includes(q)))
    : entries;
  const adminCount = entries.filter((e) => e.m.role === "admin").length;

  const changeRole = (e: MemberEntry, role: Role) => {
    const apply = async () => {
      if (await setMemberRole(e.m.user_id, role)) {
        toast.success(e.m.user_id === me ? `You're now ${role === "admin" ? "an admin" : "a member"}` : `${e.name} is now ${role === "admin" ? "an admin" : "a member"}`);
      }
    };
    if (e.m.user_id === me && role === "member") {
      ui.askConfirm({
        title: "Remove your admin access?",
        body: "You won't be able to change workspace settings, roles or members anymore unless another admin promotes you again.",
        confirmLabel: "Become a member",
        destructive: true,
        onConfirm: apply,
      });
    } else void apply();
  };

  const remove = (e: MemberEntry) => {
    ui.askConfirm({
      title: `Remove ${e.name}?`,
      body: `${e.name} will lose access to ${workspaceName} immediately — its teams, issues and projects. Their issues and comments stay in place.`,
      confirmLabel: "Remove member",
      destructive: true,
      onConfirm: async () => { if (await removeMember(e.m.user_id)) toast.success(`Removed ${e.name}`); },
    });
  };

  const leave = () => {
    ui.askConfirm({
      title: `Leave ${workspaceName}?`,
      body: "You'll lose access to its teams, issues and projects until someone invites you again.",
      confirmLabel: "Leave workspace",
      destructive: true,
      onConfirm: () => leaveWorkspace(),
    });
  };

  return (
    <Section
      title={<>Members <Count n={entries.length} /></>}
      description={isAdmin ? undefined : "Only admins can change roles or remove members."}
      action={
        <div className="relative w-[160px] sm:w-[220px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); } }}
            placeholder="Search members"
            aria-label="Search members"
            className="pl-7"
          />
        </div>
      }
    >
      <Card>
        {shown.map((e) => {
          const self = e.m.user_id === me;
          const items: ActionItem[] = [];
          if (self) {
            items.push({
              id: "leave", label: "Leave workspace", icon: <LogOut size={14} />, danger: true, onSelect: leave,
              disabled: e.m.role === "admin" && adminCount <= 1,
              hint: e.m.role === "admin" && adminCount <= 1 ? "Only admin" : undefined,
            });
          } else if (isAdmin) {
            items.push({ id: "remove", label: "Remove from workspace", icon: <UserMinus size={14} />, danger: true, onSelect: () => remove(e) });
          }
          return (
            <div key={e.m.user_id} className="flex min-h-[52px] items-center gap-3 py-2 pl-4 pr-2">
              <Avatar profile={e.p ?? null} userId={e.m.user_id} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-ink">{e.name}</span>
                  {self && <span className="shrink-0 text-xxs text-faint">(you)</span>}
                  {e.p?.display_name && <span className="hidden truncate text-xxs text-faint sm:inline">@{e.p.display_name}</span>}
                </div>
                <div className="truncate text-xxs text-faint">{e.p?.email ?? "Loading profile…"}</div>
              </div>
              <span className="hidden w-[84px] shrink-0 text-right text-xxs text-faint md:block" title="Joined">
                {formatDate(e.m.created_at)}
              </span>
              <div className="flex w-[92px] shrink-0 justify-end">
                {isAdmin ? (
                  <RolePicker
                    ghost
                    value={e.m.role}
                    onChange={(r) => changeRole(e, r)}
                    label={`Role of ${e.name}`}
                    locked={e.m.role === "admin" && adminCount <= 1 ? { member: "A workspace needs at least one admin." } : {}}
                  />
                ) : (
                  <Badge tone={e.m.role === "admin" ? "accent" : "neutral"}>{ROLE_LABEL[e.m.role]}</Badge>
                )}
              </div>
              {items.length ? (
                <Dropdown
                  align="end"
                  trigger={(p) => (
                    <button
                      ref={p.ref}
                      type="button"
                      onClick={p.onClick}
                      aria-expanded={p["aria-expanded"]}
                      aria-label={`Actions for ${e.name}`}
                      className={`focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-wash hover:text-ink ${p.open ? "bg-wash text-ink" : ""}`}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  )}
                >
                  {(close) => <ActionMenu items={items} onDone={close} />}
                </Dropdown>
              ) : (
                <span className="w-8 shrink-0" aria-hidden />
              )}
            </div>
          );
        })}
        {!shown.length && (
          <div className="px-4 py-8 text-center text-[13px] text-faint">
            {q ? <>No members match &ldquo;{query.trim()}&rdquo;</> : "No members yet"}
          </div>
        )}
      </Card>
      {isAdmin && adminCount <= 1 && entries.length > 1 && (
        <p className="mt-2 text-xxs text-faint">Tip: make at least one more person an admin so the workspace is never locked out.</p>
      )}
    </Section>
  );
}
