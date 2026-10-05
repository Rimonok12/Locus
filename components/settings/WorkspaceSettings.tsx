"use client";
/* ─── Locus · settings › workspace general (logo, name, URL, danger zone) ─── */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Loader2, LogOut, Trash2 } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui } from "@/lib/ui";
import { useIsAdmin, useMeId, useWorkspace } from "@/lib/model";
import { deleteWorkspace, leaveWorkspace, updateWorkspace, uploadWorkspaceLogo } from "@/lib/sync/actions";
import { Button } from "@/components/primitives/controls";
import { AdminNote, Card, DangerOutlineButton, Row, Section, SettingsPage, TextField, TypeToConfirm, acceptImage, plural } from "./kit";

const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const RESERVED = new Set([
  "login", "signup", "logout", "onboarding", "join", "auth", "api", "settings", "forgot-password",
  "reset-password", "invite", "new", "admin", "app", "static", "public", "favicon", "robots", "sitemap", "setup",
]);

function slugError(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters";
  if (slug.length > 48) return "Use at most 48 characters";
  if (!SLUG.test(slug)) return "Lowercase letters, numbers and dashes only — can't start or end with a dash";
  if (RESERVED.has(slug)) return "That URL is reserved";
  return null;
}

export default function WorkspaceSettings() {
  const ws = useWorkspace();
  const isAdmin = useIsAdmin();
  const me = useMeId();
  const roles = useSync((s) => s.workspace_members);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!ws) return null;

  const members = Object.values(roles);
  const otherAdmins = members.filter((m) => m.role === "admin" && m.user_id !== me).length;
  const lastAdmin = isAdmin && otherAdmins === 0;
  const leaveBlocked = lastAdmin
    ? members.length > 1
      ? "You're the only admin. Make someone else an admin before leaving."
      : "You're the only member. Delete the workspace instead."
    : null;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = acceptImage(e.target.files?.[0]);
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      if (await uploadWorkspaceLogo(file)) toast.success("Logo updated");
    } finally {
      setUploading(false);
    }
  };

  return (
    <SettingsPage title="Workspace" description="Manage your workspace's name, URL and logo.">
      {!isAdmin && <AdminNote>Only admins can change workspace settings. You can still view them here.</AdminNote>}

      <Section>
        <Card>
          <Row label="Logo" description="Recommended size 256×256. PNG, JPG or SVG up to 2 MB.">
            <button
              type="button"
              disabled={!isAdmin || uploading}
              onClick={() => fileRef.current?.click()}
              aria-label="Upload workspace logo"
              className="focus-ring group relative h-12 w-12 shrink-0 overflow-hidden rounded-lg disabled:cursor-default"
            >
              {ws.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ws.logo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-accent text-[20px] font-semibold text-accent-ink">
                  {ws.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              {isAdmin && (
                <span
                  className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${
                    uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  }`}
                >
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                </span>
              )}
            </button>
            {isAdmin && (
              <>
                <Button size="sm" className="max-sm:h-8" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {ws.logo_url ? "Replace" : "Upload logo"}
                </Button>
                {ws.logo_url && (
                  <Button
                    size="sm" className="max-sm:h-8"
                    variant="ghost"
                    icon={<Trash2 size={13} />}
                    disabled={uploading}
                    onClick={async () => { if (await updateWorkspace({ logo_url: null })) toast.success("Logo removed"); }}
                  >
                    Remove
                  </Button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
              </>
            )}
          </Row>
          <Row label="Name" description="Usually your company or organization name.">
            <TextField
              className="sm:w-[300px]"
              ariaLabel="Workspace name"
              value={ws.name}
              disabled={!isAdmin}
              maxLength={64}
              validate={(v) => (!v ? "The workspace needs a name" : v.length > 64 ? "64 characters max" : null)}
              onSave={(name) => updateWorkspace({ name })}
            />
          </Row>
          <Row label="URL" description="Every link to your workspace starts with this." top>
            <SlugField slug={ws.slug} disabled={!isAdmin} />
          </Row>
        </Card>
      </Section>

      <Section title="Danger zone" tone="danger">
        <Card tone="danger">
          <Row
            label="Leave workspace"
            description={leaveBlocked ?? `You'll lose access to ${ws.name} until someone invites you again.`}
          >
            <DangerOutlineButton
              icon={<LogOut size={13} />}
              disabled={Boolean(leaveBlocked)}
              onClick={() =>
                ui.askConfirm({
                  title: `Leave ${ws.name}?`,
                  body: "You'll lose access to its teams, issues and projects. Your issues and comments stay in place.",
                  confirmLabel: "Leave workspace",
                  destructive: true,
                  onConfirm: () => leaveWorkspace(),
                })}
            >
              Leave
            </DangerOutlineButton>
          </Row>
          <Row
            label="Delete workspace"
            description={
              isAdmin
                ? "Permanently delete this workspace and everything in it, for everyone. This can't be undone."
                : "Only admins can delete the workspace."
            }
          >
            <Button size="sm" className="max-sm:h-8" variant="danger" icon={<Trash2 size={13} />} disabled={!isAdmin} onClick={() => setDeleting(true)}>
              Delete workspace
            </Button>
          </Row>
        </Card>
      </Section>

      <TypeToConfirm
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${ws.name}?`}
        expected={ws.name}
        confirmLabel="Delete workspace"
        body={<DeleteWorkspaceSummary memberCount={members.length} />}
        onConfirm={() => deleteWorkspace()}
      />
    </SettingsPage>
  );
}

/** Mounted only while the delete dialog is open, so the whole-workspace counts aren't recomputed on every change. */
function DeleteWorkspaceSummary({ memberCount }: { memberCount: number }) {
  const teamCount = useSync((s) => Object.values(s.teams).filter((t) => !t.archived_at).length);
  const issueCount = useSync((s) => Object.keys(s.issues).length);
  const projectCount = useSync((s) => Object.keys(s.projects).length);
  return (
    <>
      This permanently deletes the workspace for all {plural(memberCount, "member")}, including{" "}
      {plural(teamCount, "team")}, {plural(issueCount, "issue")} and {plural(projectCount, "project")}.{" "}
      <span className="font-medium text-ink">This can&apos;t be undone.</span>
    </>
  );
}

function SlugField({ slug, disabled }: { slug: string; disabled: boolean }) {
  const [draft, setDraft] = useState(slug);
  useEffect(() => setDraft(slug), [slug]);
  const host = typeof window === "undefined" ? "" : window.location.host;
  const next = draft.trim().toLowerCase();
  const changed = next !== slug;
  const error = changed ? slugError(next) : null;

  const save = () => {
    if (!changed || error) return;
    ui.askConfirm({
      title: "Change workspace URL?",
      body: `Links to this workspace will change to ${host}/${next}. Existing links and bookmarks that use /${slug} will stop working.`,
      confirmLabel: "Change URL",
      onConfirm: async () => {
        const ok = await updateWorkspace({ slug: next });
        if (ok) window.location.assign(`/${next}/settings/workspace`);
      },
    });
  };

  return (
    <div className="w-full sm:w-[300px]">
      <div
        className={`flex h-8 items-stretch overflow-hidden rounded-md border transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft ${
          error ? "border-danger" : "border-line-strong"
        } ${disabled ? "bg-raised" : "bg-surface"}`}
      >
        <span className="flex max-w-[55%] select-none items-center truncate border-r border-line bg-raised px-2 text-[12.5px] text-faint">
          {host}/
        </span>
        <input
          value={draft}
          disabled={disabled}
          aria-label="Workspace URL"
          spellCheck={false}
          autoComplete="off"
          maxLength={48}
          onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(slug); e.currentTarget.blur(); }
          }}
          className="min-w-0 flex-1 bg-transparent px-2 text-[13px] text-ink outline-none disabled:cursor-not-allowed disabled:text-dim"
        />
      </div>
      {error && <div className="mt-1 text-xxs text-danger">{error}</div>}
      {changed && !disabled && (
        <div className="mt-2 flex justify-end gap-1.5">
          <Button size="sm" className="max-sm:h-8" variant="ghost" onClick={() => setDraft(slug)}>Cancel</Button>
          <Button size="sm" className="max-sm:h-8" variant="primary" disabled={Boolean(error)} onClick={save}>Update URL</Button>
        </div>
      )}
    </div>
  );
}
