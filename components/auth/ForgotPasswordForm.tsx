"use client";
/* ─── Locus · forgot password: email a recovery link ─── */

import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/primitives/controls";
import { AuthCard, AuthIcon, AuthLink, FormAlert } from "./AuthCard";
import { TextField, useCooldown } from "./fields";
import { EMAIL_RE, authErrorMessage, callbackUrl, withNext } from "./utils";

export default function ForgotPasswordForm({ next = null }: { next?: string | null }) {
  const loginHref = withNext("/login", next);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cooldown = useCooldown();
  const emailRef = useRef<HTMLInputElement>(null);

  async function send(address: string) {
    const { error: err } = await supabase().auth.resetPasswordForEmail(address, {
      redirectTo: callbackUrl("/reset-password"),
    });
    if (err) throw err;
    cooldown.start(60);
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!address) { setFieldError("Enter your email address."); emailRef.current?.focus(); return; }
    if (!EMAIL_RE.test(address)) { setFieldError("That doesn’t look like an email address."); emailRef.current?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      await send(address);
      setSentTo(address);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!sentTo || busy || cooldown.remaining) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await send(sentTo);
      setNotice("Sent again. It can take a minute to arrive.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthCard
        key="sent"
        icon={<AuthIcon><MailCheck size={20} /></AuthIcon>}
        title="Check your email"
        subtitle={<>If an account exists for <span className="break-all font-medium text-ink">{sentTo}</span>, you’ll get a link to choose a new password.</>}
        footer={
          <a href={loginHref} className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded font-medium text-dim transition-colors hover:text-ink">
            <ArrowLeft size={13} /> Back to log in
          </a>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-dim">
            Open the link in this browser. It expires in one hour and can only be used once.
          </p>
          {notice && <FormAlert tone="success">{notice}</FormAlert>}
          {error && <FormAlert>{error}</FormAlert>}
          <Button type="button" variant="secondary" size="lg" className="w-full" loading={busy} disabled={cooldown.remaining > 0} onClick={resend}>
            {cooldown.remaining ? `Resend in ${cooldown.remaining}s` : "Resend link"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full"
            onClick={() => { setSentTo(null); setNotice(null); setError(null); }}
          >
            Use a different email
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={<AuthIcon><KeyRound size={19} /></AuthIcon>}
      title="Reset your password"
      subtitle="Enter the email you use for Locus and we’ll send you a link to choose a new password."
      footer={<p>Remembered it? <AuthLink href={loginHref}>Back to log in</AuthLink></p>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-3.5">
        {error && <FormAlert>{error}</FormAlert>}
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
          onChange={(e) => { setEmail(e.target.value); setFieldError(null); }}
          error={fieldError}
          disabled={busy}
        />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
