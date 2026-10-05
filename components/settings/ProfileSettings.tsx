"use client";
/* ─── Locus · settings › profile (avatar, name, username, password, log out) ─── */

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Camera, KeyRound, LogOut, Trash2 } from "lucide-react";
import { signOut } from "@/lib/sync/store";
import { supabase } from "@/lib/supabase/client";
import { toast } from "@/lib/ui";
import { useMe, useMembers } from "@/lib/model";
import { updateProfile, uploadAvatar } from "@/lib/sync/actions";
import { Avatar } from "@/components/primitives/Avatar";
import { Button, Input, Spinner } from "@/components/primitives/controls";
import { Card, Row, Section, SettingsPage, TextField, acceptImage } from "./kit";

const USERNAME = /^[a-z0-9._-]+$/;

export default function ProfileSettings() {
  const me = useMe();
  const members = useMembers();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const taken = useMemo(
    () => new Set(members.filter((p) => p.id !== me?.id && p.display_name).map((p) => p.display_name.toLowerCase())),
    [members, me?.id],
  );

  if (!me) return null;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = acceptImage(e.target.files?.[0]);
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadAvatar(file);
      if (url) toast.success("Profile picture updated");
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = async () => {
    if (await updateProfile({ avatar_url: null })) toast.success("Profile picture removed");
  };

  return (
    <SettingsPage title="Profile" description="Manage how you appear to your teammates across Locus.">
      <Section>
        <Card>
          <Row label="Profile picture" description="PNG, JPG, GIF or WebP, up to 2 MB.">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Upload profile picture"
              className="focus-ring group relative shrink-0 rounded-full"
            >
              <Avatar profile={me} size={48} />
              <span
                className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white transition-opacity ${
                  uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                }`}
              >
                {uploading ? <Spinner className="text-white" /> : <Camera size={16} />}
              </span>
            </button>
            <Button size="sm" className="max-sm:h-8" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {me.avatar_url ? "Replace" : "Upload image"}
            </Button>
            {me.avatar_url && (
              <Button size="sm" className="max-sm:h-8" variant="ghost" icon={<Trash2 size={13} />} onClick={removeAvatar} disabled={uploading}>
                Remove
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          </Row>
          <Row label="Full name" description="Shown on issues, comments and in the sidebar.">
            <TextField
              className="sm:w-[280px]"
              ariaLabel="Full name"
              value={me.name}
              maxLength={64}
              placeholder="Your name"
              autoComplete="name"
              validate={(v) => (v.length > 64 ? "64 characters max" : null)}
              onSave={(name) => updateProfile({ name })}
            />
          </Row>
          <Row label="Username" description="Used for @mentions. Lowercase letters, numbers, dots, dashes and underscores.">
            <TextField
              className="sm:w-[280px]"
              ariaLabel="Username"
              prefix="@"
              value={me.display_name}
              maxLength={32}
              placeholder="username"
              autoComplete="nickname"
              normalize={(v) => v.trim().replace(/^@+/, "").toLowerCase()}
              validate={(v) =>
                !v ? "Choose a username"
                  : v.length > 32 ? "32 characters max"
                    : !USERNAME.test(v) ? "Use lowercase letters, numbers, dots, dashes or underscores"
                      : taken.has(v) ? `Someone in this workspace already uses @${v}`
                        : null}
              onSave={(display_name) => updateProfile({ display_name })}
            />
          </Row>
          <Row label="Email" description="The address you sign in with. It can't be changed here.">
            <Input className="disabled:cursor-not-allowed disabled:text-dim sm:w-[280px]" value={me.email} disabled readOnly aria-label="Email" />
          </Row>
        </Card>
      </Section>

      <PasswordSection email={me.email} />

      <Section title="Session">
        <Card>
          <Row label="Log out" description="Sign out of Locus on this device. Your local cache is cleared.">
            <Button size="sm" className="max-sm:h-8" icon={<LogOut size={13} />} onClick={() => signOut()}>Log out</Button>
          </Row>
        </Card>
      </Section>
    </SettingsPage>
  );
}

function PasswordSection({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const shortError = password.length > 0 && password.length < 8 ? "Use at least 8 characters" : null;
  const matchError = confirm.length > 0 && confirm !== password ? "Passwords don't match" : null;
  const valid = password.length >= 8 && password === confirm;

  const submit = async () => {
    setAttempted(true);
    if (!valid || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase().auth.updateUser({ password });
      if (error) {
        toast.error(error.message || "Couldn't update your password");
        return;
      }
      toast.success("Password updated");
      setPassword("");
      setConfirm("");
      setAttempted(false);
    } catch {
      toast.error("You're offline — the password wasn't changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Change password" description="Set a new password for signing in with your email address.">
      <Card>
        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          className="[&>*+*]:border-t [&>*+*]:border-line"
        >
          <Row label="New password" description="At least 8 characters.">
            <div className="w-full sm:w-[280px]">
              <Input
                type="password"
                autoComplete="new-password"
                aria-label="New password"
                placeholder="••••••••"
                value={password}
                invalid={Boolean(shortError && attempted)}
                onChange={(e) => setPassword(e.target.value)}
              />
              {attempted && shortError && <div className="mt-1 text-xxs text-danger">{shortError}</div>}
            </div>
          </Row>
          <Row label="Confirm password">
            <div className="w-full sm:w-[280px]">
              <Input
                type="password"
                autoComplete="new-password"
                aria-label="Confirm new password"
                placeholder="••••••••"
                value={confirm}
                invalid={Boolean(matchError)}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {matchError && <div className="mt-1 text-xxs text-danger">{matchError}</div>}
            </div>
          </Row>
          <div className="flex items-center justify-end gap-2 bg-raised px-4 py-2.5">
            <Button type="submit" variant="primary" size="sm" className="max-sm:h-8" icon={<KeyRound size={13} />} loading={busy} disabled={!password || !confirm}>
              Update password
            </Button>
          </div>
          {/* lets password managers associate the new password with the account */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        </form>
      </Card>
    </Section>
  );
}
