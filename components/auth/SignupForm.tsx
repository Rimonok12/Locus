"use client";
/* ─── Locus · sign up: name, email, password (+ Google) → onboarding ─── */

import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import type { AuthResponse } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/primitives/controls";
import { AuthCard, AuthDivider, AuthIcon, AuthLink, FormAlert } from "./AuthCard";
import { GoogleButton, googleEnabled } from "./GoogleButton";
import { PasswordField, TextField, useCooldown, useDeferredFocus } from "./fields";
import { EMAIL_RE, MIN_PASSWORD, authErrorMessage, callbackUrl, withNext } from "./utils";

type Errors = { name?: string; email?: string; password?: string };

export default function SignupForm({ next }: { next: string | null }) {
  const dest = next ?? "/onboarding";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cooldown = useCooldown();
  const focusLater = useDeferredFocus();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const clearField = (k: keyof Errors) => { if (fieldErrors[k]) setFieldErrors((f) => ({ ...f, [k]: undefined })); };

  function validate(): boolean {
    const errs: Errors = {};
    if (!name.trim()) errs.name = "Tell us what to call you.";
    const e = email.trim();
    if (!e) errs.email = "Enter your email address.";
    else if (!EMAIL_RE.test(e)) errs.email = "That doesn’t look like an email address.";
    if (password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`;
    setFieldErrors(errs);
    if (errs.name) nameRef.current?.focus();
    else if (errs.email) emailRef.current?.focus();
    else if (errs.password) passwordRef.current?.focus();
    return !errs.name && !errs.email && !errs.password;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (busy || !validate()) return;
    const address = email.trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    setExists(false);

    let result: AuthResponse;
    try {
      result = await supabase().auth.signUp({
        email: address,
        password,
        options: { data: { name: name.trim() }, emailRedirectTo: callbackUrl(dest) },
      });
    } catch (e) {
      setBusy(false);
      setError(authErrorMessage(e));
      return;
    }
    const { data, error: err } = result;
    if (err) {
      setBusy(false);
      setError(authErrorMessage(err));
      if (err.code === "user_already_exists" || err.code === "email_exists" || /already registered/i.test(err.message)) setExists(true);
      else if (err.code === "weak_password") focusLater(passwordRef);
      else if (err.code === "email_address_invalid") focusLater(emailRef);
      return;
    }
    // With email confirmation on, Supabase hides existing accounts behind a user with no identities.
    if (!data.session && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setBusy(false);
      setExists(true);
      setError("An account with this email already exists.");
      return;
    }
    if (data.session) {
      window.location.assign(dest);
      return;
    }
    setBusy(false);
    cooldown.start(60);
    setSentTo(address);
  }

  async function resend() {
    if (!sentTo || busy || cooldown.remaining) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: err } = await supabase().auth.resend({
        type: "signup",
        email: sentTo,
        options: { emailRedirectTo: callbackUrl(dest) },
      });
      if (err) throw err;
      cooldown.start(60);
      setNotice("Sent! Give it a minute to arrive.");
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /* ─── confirmation pending ─── */
  if (sentTo) {
    return (
      <AuthCard
        key="sent"
        icon={<AuthIcon><MailCheck size={20} /></AuthIcon>}
        title="Check your inbox"
        subtitle={<>We sent a confirmation link to <span className="break-all font-medium text-ink">{sentTo}</span>. Click it to activate your account.</>}
        footer={
          <button
            type="button"
            onClick={() => { setSentTo(null); setNotice(null); setError(null); }}
            className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded font-medium text-dim transition-colors hover:text-ink"
          >
            <ArrowLeft size={13} /> Use a different email
          </button>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-dim">
            Open the link on this device and you’ll land straight in Locus. Nothing yet? Check your spam folder, or resend it.
          </p>
          {notice && <FormAlert tone="success">{notice}</FormAlert>}
          {error && <FormAlert>{error}</FormAlert>}
          <Button type="button" variant="secondary" size="lg" className="w-full" loading={busy} disabled={cooldown.remaining > 0} onClick={resend}>
            {cooldown.remaining ? `Resend email in ${cooldown.remaining}s` : "Resend confirmation email"}
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Keyboard-first, real-time issue tracking for software teams."
      footer={
        <p>
          Already have an account? <AuthLink href={withNext("/login", next)}>Log in</AuthLink>
        </p>
      }
    >
      {googleEnabled && (
        <>
          <GoogleButton next={next ?? "/"} context="signup" />
          <AuthDivider />
        </>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-3.5">
        {error && (
          <FormAlert
            action={exists ? (
              <a href={withNext("/login", next)} className="focus-ring rounded font-medium text-accent hover:underline">
                Log in instead
              </a>
            ) : undefined}
          >
            {error}
          </FormAlert>
        )}

        <TextField
          ref={nameRef}
          label="Full name"
          name="name"
          autoComplete="name"
          autoFocus
          maxLength={80}
          placeholder="Ada Lovelace"
          value={name}
          onChange={(e) => { setName(e.target.value); clearField("name"); }}
          error={fieldErrors.name}
          disabled={busy}
        />
        <TextField
          ref={emailRef}
          label="Work email"
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@company.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); clearField("email"); if (exists) { setExists(false); setError(null); } }}
          error={fieldErrors.email}
          disabled={busy}
        />
        <PasswordField
          ref={passwordRef}
          label="Password"
          name="new-password"
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
          meter
          value={password}
          onChange={(e) => { setPassword(e.target.value); clearField("password"); }}
          error={fieldErrors.password}
          disabled={busy}
        />

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
