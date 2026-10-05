"use client";
/* ─── Locus · basic controls ─── */

import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "xs" | "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover shadow-card",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-wash shadow-card",
  outline: "bg-transparent text-ink border border-line-strong hover:bg-wash",
  ghost: "bg-transparent text-dim hover:bg-wash hover:text-ink",
  danger: "bg-danger text-white hover:opacity-90 shadow-card",
};
const SIZE: Record<Size, string> = {
  xs: "h-6 px-2 text-xxs gap-1 rounded-[5px]",
  sm: "h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  lg: "h-10 px-4 text-[14px] gap-2 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", loading, icon, className = "", children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn("focus-ring inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { size?: number; active?: boolean; label: string }>(
  function IconButton({ size = 28, active, label, className = "", children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cn("focus-ring inline-flex shrink-0 items-center justify-center rounded-md transition-colors", active ? "bg-wash text-ink" : "text-faint hover:bg-wash hover:text-ink", className)}
        style={{ width: size, height: size }}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className = "", invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn("h-9 w-full rounded-md border bg-surface px-2.5 text-[16px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft sm:h-8 sm:text-[13px]", invalid ? "border-danger" : "border-line-strong", className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = "", ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn("w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[16px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft sm:text-[13px]", className)}
        {...rest}
      />
    );
  },
);

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xxs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xxs text-faint">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={`focus-ring relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-accent" : "bg-line-strong"}`}
    >
      <span className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[14px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <kbd className={className}>{children}</kbd>;
}

/** Hover tooltip with optional shortcut hint. */
export function Tooltip({ label, shortcut, children, side = "bottom" }: { label: ReactNode; shortcut?: string[]; children: ReactNode; side?: "top" | "bottom" | "right" }) {
  const [show, setShow] = useState(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pos = side === "top" ? "bottom-full mb-1.5 left-1/2 -translate-x-1/2" : side === "right" ? "left-full ml-1.5 top-1/2 -translate-y-1/2" : "top-full mt-1.5 left-1/2 -translate-x-1/2";
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => { timer = setTimeout(() => setShow(true), 450); }}
      onMouseLeave={() => { clearTimeout(timer); setShow(false); }}
      onMouseDown={() => { clearTimeout(timer); setShow(false); }}
    >
      {children}
      {show && (
        <span className={`anim-fade pointer-events-none absolute z-[95] flex items-center gap-1.5 whitespace-nowrap rounded-md bg-surface px-2 py-1 text-xxs font-medium text-ink shadow-pop ${pos}`}>
          {label}
          {shortcut?.map((k) => <kbd key={k}>{k}</kbd>)}
        </span>
      )}
    </span>
  );
}

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn("animate-spin text-faint", className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
      {icon && <div className="mb-4 text-faint">{icon}</div>}
      <h3 className="text-[14px] font-medium text-ink">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-dim">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Segmented control (tabs) used in headers. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-line bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`focus-ring flex h-6 items-center gap-1 rounded-[5px] px-2 text-[12px] font-medium transition-colors ${value === o.value ? "bg-surface text-ink shadow-card" : "text-faint hover:text-dim"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A thin progress bar. */
export function ProgressBar({ value, color = "var(--accent)", className = "" }: { value: number; color?: string; className?: string }) {
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full bg-wash ${className}`}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, background: color }} />
    </div>
  );
}
