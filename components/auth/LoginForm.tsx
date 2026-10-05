"use client";
/* ─── Locus · log in: email + password, magic link, Google ─── */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, Mail, MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/primitives/controls";
import { AuthCard, AuthDivider, AuthIcon, AuthLink, FormAlert } from "./AuthCard";
import { GoogleButton, googleEnabled } from "./GoogleButton";
import { PasswordField, TextField, useCooldown, useDeferredFocus } from "./fields";
import { EMAIL_RE, authErrorMessage, callbackUrl, withNext } from "./utils";

type Mode = "password" | "magic";

const isUnconfirmed = (err: { code?: string; message?: string }) =>
  err.code === "email_not_confirmed" || /email not confirmed/i.test(err.message ?? "");

export default function LoginForm({ next, initialError }: { next: string | null; initialError: string | null }) {
  const dest = next ?? "/";
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(initialError ? authErrorMessage(initialError) : null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const cooldown = useCooldown();
  const focusLater = useDeferredFocus();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);

  // The ?error= param has been shown — drop it so a refresh doesn't show it again.
  useEffect(() => {
    if (!initialError) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, [initialError]);

  // Move focus to the right field when switching modes.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (sentTo) return;
    if (mode === "password" && EMAIL_RE.test(email.trim())) passwordRef.current?.focus();
    else emailRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sentTo]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
    setUnconfirmed(false);
    setFieldErrors({});
  };

  function validate(): string | null {
    const e = email.trim();
    const errs: { email?: string; password?: string } = {};
    if (!e) errs.email = "Enter your email address.";
    else if (!EMAIL_RE.test(e)) errs.email = "That doesn’t look like an email address.";
    if (mode === "password" && !password) errs.password = "Enter your password.";
    setFieldErrors(errs);
    if (errs.email) emailRef.current?.focus();
    else if (errs.password) passwordRef.current?.focus();
    return errs.email || errs.password ? null : e;
  }

  async function sendMagicLink(address: string) {
    const { error: err } = await supabase().auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: callbackUrl(dest) },
    });
    if (err) throw err;
    cooldown.start(60);
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (busy || resending) return;
    const address = validate();
    if (!address) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setUnconfirmed(false);

    if (mode === "magic") {
      try {
        await sendMagicLink(address);
        setSentTo(address);
      } catch (err) {
        setError(authErrorMessage(err));
        focusLater(emailRef);
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const { error: err } = await supabase().auth.signInWithPassword({ email: address, password });
      if (err) {
        setBusy(false);
        setError(authErrorMessage(err));
        if (isUnconfirmed(err)) setUnconfirmed(true);
        else { setPassword(""); focusLater(passwordRef); }
        return;
      }
    } catch (err) {
      setBusy(false);
      setError(authErrorMessage(err));
      return;
    }
    // Keep the spinner up while the browser navigates.
    window.location.assign(dest);
  }

  async function resendConfirmation() {
    const address = email.trim();
    if (!address || resending || cooldown.remaining) return;
    setResending(true);
    try {
      const { error: err } = await supabase().auth.resend({
        type: "signup",
        email: address,
        options: { emailRedirectTo: callbackUrl(dest) },
      });
      if (err) throw err;
      cooldown.start(60);
      setUnconfirmed(false);
      setError(null);
      setNotice(`We sent a new confirmation link to ${address}.`);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  async function resendMagic() {
    if (!sentTo || busy || cooldown.remaining) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendMagicLink(sentTo);
      setNotice("A new link is on its way.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /* ─── "check your email" state ─── */
  if (sentTo) {
    return (
      <AuthCard
        key="sent"
        icon={<AuthIcon><MailCheck size={20} /></AuthIcon>}
        title="Check your email"
        subtitle={<>We sent a sign-in link to <span className="break-all font-medium text-ink">{sentTo}</span>. It expires in one hour.</>}
        footer={
          <button
            type="button"
            onClick={() => { setSentTo(null); setNotice(null); setError(null); setMode("password"); }}
            className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded font-medium text-dim transition-colors hover:text-ink"
          >
            <ArrowLeft size={13} /> Back to log in
          </button>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-dim">
            Open the link on this device to continue. Can’t find it? Check your spam or promotions folder.
          </p>
          {notice && <FormAlert tone="success">{notice}</FormAlert>}
          {error && <FormAlert>{error}</FormAlert>}
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            loading={busy}
            disabled={cooldown.remaining > 0}
            onClick={resendMagic}
          >
            {cooldown.remaining ? `Resend link in ${cooldown.remaining}s` : "Resend link"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => { setSentTo(null); setNotice(null); setError(null); setEmail(""); setMode("magic"); }}
          >
            Use a different email
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Log in to Locus"
      subtitle="Welcome back. Pick up right where your team left off."
      footer={
        <p>
          Don’t have an account? <AuthLink href={withNext("/signup", next)}>Sign up</AuthLink>
        </p>
      }
    >
      {next === "/reset-password" && !error && (
        <div className="mb-4">
          <FormAlert
            tone="info"
            action={<a href="/forgot-password" className="focus-ring rounded font-medium text-accent hover:underline">Request a new reset link</a>}
          >
            Password reset links work once, in the browser you requested them from. Log in, or get a fresh link.
          </FormAlert>
        </div>
      )}

      {googleEnabled && (
        <>
          <GoogleButton next={dest} context="signin" />
          <AuthDivider />
        </>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-3.5">
        {error && (
          <FormAlert
            action={unconfirmed ? (
              <button
                type="button"
                onClick={resendConfirmation}
                disabled={resending || cooldown.remaining > 0}
                className="focus-ring rounded font-medium text-accent hover:underline disabled:opacity-50"
              >
                {resending ? "Sending…" : cooldown.remaining ? `Resend in ${cooldown.remaining}s` : "Resend confirmation email"}
              </button>
            ) : undefined}
          >
            {error}
          </FormAlert>
        )}
        {notice && <FormAlert tone="success">{notice}</FormAlert>}

        <TextField
          ref={emailRef}
          label="Email"
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          placeholder="you@company.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined })); }}
          error={fieldErrors.email}
          disabled={busy}
        />

        {mode === "password" && (
          <PasswordField
            ref={passwordRef}
            label="Password"
            name="password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined })); }}
            error={fieldErrors.password}
            disabled={busy}
            aside={
              <a href={withNext("/forgot-password", next)} className="focus-ring rounded text-[12px] text-dim transition-colors hover:text-ink">
                Forgot password?
              </a>
            }
          />
        )}

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          {mode === "password" ? "Log in" : "Email me a magic link"}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => switchMode(mode === "password" ? "magic" : "password")}
        disabled={busy}
        className="focus-ring mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-medium text-dim transition-colors hover:bg-wash hover:text-ink disabled:opacity-50"
      >
        {mode === "password" ? <><Mail size={14} /> Email me a magic link instead</> : <><KeyRound size={14} /> Log in with a password instead</>}
      </button>
    </AuthCard>
  );
}
