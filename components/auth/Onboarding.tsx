"use client";
/* ─── Locus · onboarding: accept pending invitations or create a workspace ─── */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, LogOut, RotateCw } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { createWorkspace } from "@/lib/sync/actions";
import { slugify, teamKeyFrom } from "@/lib/format";
import { Button } from "@/components/primitives/controls";
import { LocusMark } from "@/components/primitives/icons";
import { AuthDivider, AuthGlow, FormAlert } from "./AuthCard";
import { FieldShell, TextField, useDeferredFocus } from "./fields";
import { acceptInvite, inviteErrorMessage, signOutTo } from "./session";
import { RESERVED_SLUGS, SLUG_RE, TEAM_KEY_RE } from "./utils";
import { useThemeSync } from "./ThemeSync";

/** Row returned by the `my_pending_invites` RPC. */
export interface PendingInvite {
  token: string;
  workspace_name: string;
  workspace_slug: string;
  inviter_name: string;
  role: string;
}

type FieldKey = "name" | "slug" | "teamName" | "teamKey";
type ServerError = { field: FieldKey | "form"; message: string; relogin?: boolean };

const FIELD_ORDER: FieldKey[] = ["name", "slug", "teamName", "teamKey"];
const autoSlug = (name: string) => slugify(name).replace(/-+$/, "");

function slugError(slug: string): string | null {
  if (!slug) return "Choose a URL for your workspace.";
  if (slug.length < 3) return "Use at least 3 characters.";
  if (!SLUG_RE.test(slug)) return "Use lowercase letters, numbers and dashes; start and end with a letter or number.";
  if (RESERVED_SLUGS.has(slug)) return "That URL is reserved";
  return null;
}

function createErrorOf(err: unknown): ServerError {
  const e = (err ?? {}) as { code?: string; message?: string };
  const msg = e.message ?? (typeof err === "string" ? err : "");
  if (e.code === "23505") return { field: "slug", message: "That URL is taken" };
  if (/reserved/i.test(msg)) return { field: "slug", message: "That URL is reserved" };
  if (e.code === "23514" && /slug/i.test(msg)) return { field: "slug", message: "Use lowercase letters, numbers and dashes." };
  if (e.code === "23514" && /key/i.test(msg)) return { field: "teamKey", message: "Letters and numbers only, starting with a letter" };
  if (/workspace limit/i.test(msg)) return { field: "form", message: "You’ve reached the limit of 10 workspaces you can create." };
  if (e.code === "28000" || /not authenticated|jwt expired/i.test(msg)) {
    return { field: "form", message: "Your session has expired. Log in again to continue.", relogin: true };
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
    return { field: "form", message: "Can’t reach the server. Check your connection and try again." };
  }
  return { field: "form", message: msg.length && msg.length < 160 ? msg : "Couldn’t create the workspace. Please try again." };
}

export default function Onboarding({
  email, name, host, isNew, canGoBack, initialInvites,
}: {
  email: string;
  name: string;
  host: string;
  isNew: boolean;
  canGoBack: boolean;
  /** pending invites fetched on the server; null when that request failed (fetched again here) */
  initialInvites: PendingInvite[] | null;
}) {
  useThemeSync();
  const focusLater = useDeferredFocus();

  /* ─── pending invitations ─── */
  const [invites, setInvites] = useState<PendingInvite[]>(initialInvites ?? []);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [joinErrors, setJoinErrors] = useState<Record<string, string>>({});
  const alive = useRef(true);

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true);
    setInvitesError(null);
    let message: string | null = null;
    let rows: PendingInvite[] = [];
    try {
      const { data, error } = await supabase().rpc("my_pending_invites");
      if (error) message = error.message;
      else rows = (data ?? []) as PendingInvite[];
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    if (!alive.current) return;
    setLoadingInvites(false);
    if (message !== null) setInvitesError(inviteErrorMessage(message));
    else setInvites(rows);
  }, []);

  useEffect(() => {
    alive.current = true;
    // The server couldn't load invitations — try once more from the browser.
    if (initialInvites === null) void loadInvites();
    return () => { alive.current = false; };
  }, [initialInvites, loadInvites]);

  async function join(inv: PendingInvite) {
    if (joining || creating || loggingOut) return;
    setJoining(inv.token);
    setJoinErrors((m) => {
      const rest = { ...m };
      delete rest[inv.token];
      return rest;
    });
    try {
      const slug = await acceptInvite(inv.token, inv.workspace_slug);
      window.location.assign(`/${slug}`);
    } catch (e) {
      setJoining(null);
      setJoinErrors((m) => ({ ...m, [inv.token]: e instanceof Error ? e.message : "Couldn’t join this workspace." }));
    }
  }

  /* ─── create workspace ─── */
  const [wsName, setWsName] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [teamName, setTeamName] = useState("Engineering");
  const [keyInput, setKeyInput] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const teamNameRef = useRef<HTMLInputElement>(null);
  const teamKeyRef = useRef<HTMLInputElement>(null);
  const refs = { name: nameRef, slug: slugRef, teamName: teamNameRef, teamKey: teamKeyRef };
  const slugId = useId();

  const slug = slugEdited ? slugInput : autoSlug(wsName);
  const teamKey = keyEdited ? keyInput : teamKeyFrom(teamName);

  const errors: Record<FieldKey, string | null> = {
    name: !wsName.trim() ? "Give your workspace a name." : null,
    slug: slugError(slug),
    teamName: !teamName.trim() ? "Name your first team." : null,
    teamKey: !teamKey ? "Required" : !TEAM_KEY_RE.test(teamKey) ? "Must start with a letter" : null,
  };
  const show = (k: FieldKey) => submitted || touched[k] || (k === "slug" && touched.name && Boolean(wsName.trim()));
  const fieldError = (k: FieldKey): string | null =>
    serverError?.field === k ? serverError.message : show(k) ? errors[k] : null;

  const touch = (k: FieldKey) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const clearServer = (k: FieldKey) => { if (serverError?.field === k) setServerError(null); };

  async function onCreate(ev: FormEvent) {
    ev.preventDefault();
    if (creating || joining || loggingOut) return;
    setSubmitted(true);
    const firstInvalid = FIELD_ORDER.find((k) => errors[k]);
    if (firstInvalid) { refs[firstInvalid].current?.focus(); return; }
    setCreating(true);
    setServerError(null);
    try {
      const created = await createWorkspace(wsName.trim(), slug, teamName.trim(), teamKey);
      window.location.assign(`/${created || slug}`);
    } catch (err) {
      const se = createErrorOf(err);
      setCreating(false);
      setServerError(se);
      if (se.field !== "form") focusLater(refs[se.field]);
    }
  }

  /* ─── account ─── */
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    await signOutTo("/login");
  }

  const firstName = name.trim().split(/\s+/)[0] ?? "";
  const hasInvites = invites.length > 0;
  const busy = creating || Boolean(joining) || loggingOut;
  const keyPreview = TEAM_KEY_RE.test(teamKey) ? teamKey : "KEY";

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-canvas text-ink">
      <AuthGlow />

      <header className="relative z-10 mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        {canGoBack ? (
          <a href="/" className="focus-ring -ml-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-dim transition-colors hover:bg-wash hover:text-ink">
            <ArrowLeft size={14} /> Back to Locus
          </a>
        ) : (
          <a href="/" aria-label="Locus home" className="focus-ring flex shrink-0 items-center gap-2 rounded-md">
            <LocusMark size={20} />
            <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Locus</span>
          </a>
        )}
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <span className="hidden shrink-0 text-[12.5px] text-faint sm:inline">Logged in as</span>
          <span className="truncate text-[12.5px] font-medium text-dim" title={email}>{email}</span>
          <Button
            variant="ghost"
            size="md"
            icon={<LogOut size={14} />}
            loading={loggingOut}
            disabled={creating || Boolean(joining)}
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className="shrink-0"
          >
            <span className="hidden sm:inline">Log out</span>
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[460px] flex-1 px-4 pb-16 pt-8 sm:pt-12">
        <div className="anim-modal mb-8 flex flex-col items-center text-center">
          <LocusMark size={40} />
          <h1 className="mt-5 text-balance text-[22px] font-semibold leading-tight tracking-[-0.015em]">
            {isNew ? "Create a new workspace" : `Welcome to Locus${firstName ? `, ${firstName}` : ""}`}
          </h1>
          <p className="mt-2 max-w-[360px] text-balance text-[13px] leading-relaxed text-dim">
            {hasInvites
              ? "You’ve been invited to join a workspace. Join your team, or start a fresh workspace of your own."
              : "Workspaces are where your team tracks issues, plans cycles and ships projects. You can invite teammates right after."}
          </p>
        </div>

        {invitesError && (
          <div className="mb-6">
            <FormAlert
              action={
                <button
                  type="button"
                  onClick={() => void loadInvites()}
                  disabled={loadingInvites}
                  className="focus-ring inline-flex items-center gap-1 rounded font-medium text-accent hover:underline disabled:opacity-50"
                >
                  <RotateCw size={12} className={loadingInvites ? "animate-spin" : ""} /> Try again
                </button>
              }
            >
              Couldn’t load your invitations. {invitesError}
            </FormAlert>
          </div>
        )}

        {!hasInvites && loadingInvites && !invitesError && (
          <div className="mb-6 space-y-2" aria-busy="true" aria-label="Loading invitations">
            <div className="skeleton h-[60px] rounded-xl" />
          </div>
        )}

        {hasInvites && (
          <section className="anim-fade" aria-labelledby="invites-heading">
            <h2 id="invites-heading" className="mb-2 px-1 text-[12px] font-medium text-faint">
              Pending invitations
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              {invites.map((inv) => (
                <li key={inv.token} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-[14px] font-semibold text-accent-ink">
                    {(inv.workspace_name.trim()[0] ?? "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{inv.workspace_name}</div>
                    <div className="truncate text-xxs text-faint">
                      {inv.inviter_name ? `Invited by ${inv.inviter_name}` : "You’re invited"} · {inv.role === "admin" ? "Admin" : "Member"}
                    </div>
                    {joinErrors[inv.token] && <div role="alert" className="anim-fade mt-1 text-xxs text-danger">{joinErrors[inv.token]}</div>}
                  </div>
                  <Button
                    variant="primary"
                    size="md"
                    loading={joining === inv.token}
                    disabled={busy && joining !== inv.token}
                    onClick={() => join(inv)}
                    aria-label={`Join ${inv.workspace_name}`}
                  >
                    Join
                  </Button>
                </li>
              ))}
            </ul>
            <div className="py-3"><AuthDivider label="or create a workspace" /></div>
          </section>
        )}

        <section aria-labelledby="create-heading">
          <h2 id="create-heading" className="sr-only">Create a workspace</h2>
          <form onSubmit={onCreate} noValidate className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
            {serverError?.field === "form" && (
              <FormAlert action={serverError.relogin ? <a href="/login?next=%2Fonboarding" className="focus-ring rounded font-medium text-accent hover:underline">Log in again</a> : undefined}>
                {serverError.message}
              </FormAlert>
            )}

            <TextField
              ref={nameRef}
              label="Workspace name"
              name="workspace-name"
              autoComplete="organization"
              autoFocus
              maxLength={64}
              placeholder="Acme Inc."
              value={wsName}
              onChange={(e) => { setWsName(e.target.value); clearServer("name"); if (!slugEdited) clearServer("slug"); }}
              onBlur={() => touch("name")}
              error={fieldError("name")}
              disabled={busy}
            />

            <FieldShell
              id={slugId}
              label="Workspace URL"
              error={fieldError("slug")}
              hint="Lowercase letters, numbers and dashes."
            >
              <div
                className={`flex h-10 items-stretch overflow-hidden rounded-md border bg-surface transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft ${fieldError("slug") ? "border-danger" : "border-line-strong"} ${busy ? "opacity-60" : ""}`}
              >
                <span className="flex max-w-[55%] shrink-0 select-none items-center border-r border-line bg-raised px-3 text-[13px] text-faint" title={host}>
                  <span className="truncate">{host}</span>/
                </span>
                <input
                  ref={slugRef}
                  id={slugId}
                  name="workspace-url"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={48}
                  placeholder="acme"
                  value={slug}
                  aria-invalid={fieldError("slug") ? true : undefined}
                  aria-describedby={`${slugId}-msg`}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 48));
                    clearServer("slug");
                  }}
                  onBlur={() => touch("slug")}
                  disabled={busy}
                  className="min-w-0 flex-1 bg-transparent px-3 text-[16px] text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed sm:text-[13.5px]"
                />
              </div>
            </FieldShell>

            <div className="border-t border-line pt-4">
              <div className="mb-3">
                <div className="text-[12.5px] font-medium text-ink">Your first team</div>
                <p className="mt-0.5 text-xxs leading-relaxed text-faint">Teams own issues, workflows and cycles. You can add more teams later.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_132px]">
                <TextField
                  ref={teamNameRef}
                  label="Team name"
                  name="team-name"
                  autoComplete="off"
                  maxLength={64}
                  placeholder="Engineering"
                  value={teamName}
                  onChange={(e) => { setTeamName(e.target.value); clearServer("teamName"); if (!keyEdited) clearServer("teamKey"); }}
                  onBlur={() => touch("teamName")}
                  error={fieldError("teamName")}
                  disabled={busy}
                />
                <TextField
                  ref={teamKeyRef}
                  label="Identifier"
                  name="team-key"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={7}
                  placeholder="ENG"
                  value={teamKey}
                  onChange={(e) => {
                    setKeyEdited(true);
                    setKeyInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7));
                    clearServer("teamKey");
                  }}
                  onBlur={() => touch("teamKey")}
                  error={fieldError("teamKey")}
                  disabled={busy}
                  className="font-medium uppercase tracking-[0.04em]"
                />
              </div>
              <p className="mt-2 text-xxs text-faint">
                Issues will be numbered{" "}
                <span className="font-medium text-dim">{keyPreview}-1</span>,{" "}
                <span className="font-medium text-dim">{keyPreview}-2</span>…
              </p>
            </div>

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={creating} disabled={Boolean(joining) || loggingOut}>
              Create workspace
            </Button>
          </form>
          <p className="mt-4 text-center text-xxs leading-relaxed text-faint">
            Got an invite link from a teammate? Open it to join their workspace.
          </p>
        </section>
      </main>
    </div>
  );
}
