"use client";
/* ─── Locus · auth form fields (40px inputs, 16px text on phones to avoid iOS zoom) ─── */

import { forwardRef, useCallback, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type RefObject } from "react";
import { Eye, EyeOff } from "lucide-react";
import { passwordScore } from "./utils";

export const inputClass = (invalid?: boolean, extra = "") =>
  `h-10 w-full rounded-md border bg-surface px-3 text-[16px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60 sm:text-[13.5px] ${invalid ? "border-danger" : "border-line-strong"} ${extra}`;

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  /** right side of the label row (e.g. "Forgot password?") */
  aside?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
};

export function FieldShell({ id, label, aside, error, hint, children }: { id: string; label: string; aside?: ReactNode; error?: string | null; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[12.5px] font-medium text-ink">{label}</label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="anim-fade mt-1.5 text-xxs text-danger">{error}</p>
      ) : hint ? (
        <div id={`${id}-msg`} className="mt-1.5 text-xxs text-faint">{hint}</div>
      ) : null}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField(
  { label, aside, error, hint, className = "", ...rest }, ref,
) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} aside={aside} error={error} hint={hint}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={inputClass(Boolean(error), className)}
        {...rest}
      />
    </FieldShell>
  );
});

export const PasswordField = forwardRef<HTMLInputElement, Omit<InputProps, "type"> & { meter?: boolean }>(function PasswordField(
  { label, aside, error, hint, meter = false, className = "", value, ...rest }, ref,
) {
  const id = useId();
  const [show, setShow] = useState(false);
  const pw = typeof value === "string" ? value : "";
  const strength = meter ? passwordScore(pw) : null;
  return (
    <FieldShell
      id={id}
      label={label}
      aside={aside}
      error={error}
      hint={strength && pw ? <StrengthMeter score={strength.score} label={strength.label} /> : hint}
    >
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={show ? "text" : "password"}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint || (strength && pw) ? `${id}-msg` : undefined}
          className={inputClass(Boolean(error), `pr-11 ${className}`)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          title={show ? "Hide password" : "Show password"}
          className="focus-ring absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors hover:bg-wash hover:text-ink"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </FieldShell>
  );
});

function StrengthMeter({ score, label }: { score: number; label: string }) {
  const color = score <= 1 ? "var(--danger)" : score === 2 ? "var(--warning)" : "var(--success)";
  return (
    <span className="flex items-center gap-2">
      <span className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full transition-colors duration-200"
            style={{ background: i <= score ? color : "var(--line-strong)" }}
          />
        ))}
      </span>
      <span className="w-[132px] shrink-0 text-right" style={{ color: score <= 1 ? "var(--danger)" : undefined }}>{label}</span>
    </span>
  );
}

/**
 * Focus an input once it is enabled again. Fields are disabled while a request
 * is in flight, so focusing straight after an async failure would be a no-op;
 * this waits for the commit that re-enables the field.
 */
export function useDeferredFocus() {
  const pending = useRef<RefObject<HTMLInputElement> | null>(null);
  useEffect(() => {
    const el = pending.current?.current;
    if (!el || el.disabled) return;
    pending.current = null;
    el.focus();
    el.select();
  });
  return useCallback((ref: RefObject<HTMLInputElement>) => {
    pending.current = ref;
  }, []);
}

/** Countdown used to throttle "resend email" buttons (Supabase rate-limits to ~60s). */
export function useCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      if (n >= until) { clearInterval(t); setUntil(0); }
    };
    const t = setInterval(tick, 250);
    tick();
    return () => clearInterval(t);
  }, [until]);
  const start = useCallback((seconds = 60) => {
    const n = Date.now();
    setNow(n);
    setUntil(n + seconds * 1000);
  }, []);
  const remaining = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
  return { remaining, start };
}
