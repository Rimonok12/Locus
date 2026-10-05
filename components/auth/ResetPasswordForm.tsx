"use client";
/* ─── Locus · choose a new password (recovery session) ─── */

import { useRef, useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button, Spinner } from "@/components/primitives/controls";
import { AuthCard, AuthIcon, AuthLink, FormAlert } from "./AuthCard";
import { PasswordField, useDeferredFocus } from "./fields";
import { MIN_PASSWORD, authErrorMessage } from "./utils";

export default function ResetPasswordForm({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const focusLater = useDeferredFocus();

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const errs: { password?: string; confirm?: string } = {};
    if (password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`;
    else if (confirm !== password) errs.confirm = "Passwords don’t match.";
    setFieldErrors(errs);
    if (errs.password) { passwordRef.current?.focus(); return; }
    if (errs.confirm) { confirmRef.current?.focus(); return; }

    setBusy(true);
    setError(null);
    setExpired(false);
    try {
      const { error: err } = await supabase().auth.updateUser({ password });
      if (err) {
        setBusy(false);
        setError(authErrorMessage(err));
        if (/session/i.test(err.message) || err.code === "session_not_found" || err.code === "session_expired") setExpired(true);
        if (err.code === "weak_password" || err.code === "same_password") focusLater(passwordRef);
        return;
      }
    } catch (e) {
      setBusy(false);
      setError(authErrorMessage(e));
      return;
    }
    setDone(true);
    window.location.assign("/");
  }

  if (done) {
    return (
      <AuthCard
        key="done"
        icon={<AuthIcon tone="success"><ShieldCheck size={20} /></AuthIcon>}
        title="Password updated"
        subtitle="You’re all set. Taking you to Locus…"
        plain
      >
        <div className="flex justify-center"><Spinner size={18} /></div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={<AuthIcon><KeyRound size={19} /></AuthIcon>}
      title="Choose a new password"
      subtitle={email ? <>For <span className="font-medium text-ink">{email}</span></> : undefined}
      footer={<p>Changed your mind? <AuthLink href="/">Go to Locus</AuthLink></p>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-3.5">
        {error && (
          <FormAlert
            action={expired ? (
              <a href="/forgot-password" className="focus-ring rounded font-medium text-accent hover:underline">Request a new link</a>
            ) : undefined}
          >
            {error}
          </FormAlert>
        )}
        {/* lets password managers associate the new password with the account */}
        <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
        <PasswordField
          ref={passwordRef}
          label="New password"
          name="new-password"
          autoComplete="new-password"
          autoFocus
          meter
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={password}
          onChange={(e) => { setPassword(e.target.value); setFieldErrors((f) => ({ ...f, password: undefined })); }}
          error={fieldErrors.password}
          disabled={busy}
        />
        <PasswordField
          ref={confirmRef}
          label="Confirm new password"
          name="confirm-password"
          autoComplete="new-password"
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => { setConfirm(e.target.value); setFieldErrors((f) => ({ ...f, confirm: undefined })); }}
          error={fieldErrors.confirm}
          disabled={busy}
        />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
