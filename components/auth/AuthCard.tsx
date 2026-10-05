"use client";
/* ─── Locus · auth layout: centered card with logo, title, body and footer links ─── */

import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { LocusMark } from "@/components/primitives/icons";
import { useThemeSync } from "./ThemeSync";

/**
 * Shared frame for every public auth screen.
 * `icon` replaces the Locus mark (e.g. a mail glyph on "Check your email" states);
 * `plain` renders children without the bordered card (status pages).
 */
export function AuthCard({
  title, subtitle, icon, children, footer, plain = false, wide = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  plain?: boolean;
  wide?: boolean;
}) {
  useThemeSync();
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-canvas text-ink">
      <AuthGlow />
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
        <div className={`anim-modal w-full ${wide ? "max-w-[440px]" : "max-w-[380px]"}`}>
          <div className="mb-6 flex flex-col items-center text-center">
            {icon ?? (
              <a href="/" aria-label="Locus home" className="focus-ring rounded-[10px] transition-transform hover:scale-[1.04]">
                <LocusMark size={40} />
              </a>
            )}
            <h1 className="mt-5 text-balance text-[20px] font-semibold leading-tight tracking-[-0.012em] text-ink">{title}</h1>
            {subtitle && <p className="mt-2 max-w-[340px] text-balance text-[13px] leading-relaxed text-dim">{subtitle}</p>}
          </div>
          {children != null && (plain ? children : (
            <div className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">{children}</div>
          ))}
          {footer && <div className="mt-6 space-y-1.5 text-center text-[12.5px] text-dim">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

/** Soft accent glow behind public pages. */
export function AuthGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[480px]"
      style={{ background: "radial-gradient(56% 64% at 50% 0%, var(--accent-soft), transparent 72%)" }}
    />
  );
}

/** Square glyph badge used in place of the logo on status screens. */
export function AuthIcon({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "danger" | "success" }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "success" ? "var(--success)" : "var(--accent)";
  return (
    <span
      className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface shadow-card"
      style={{ color, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {children}
    </span>
  );
}

export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="my-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.06em] text-faint" role="separator">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Inline message banner for forms. */
export function FormAlert({ tone = "error", children, action }: { tone?: "error" | "success" | "info"; children: ReactNode; action?: ReactNode }) {
  const color = tone === "error" ? "var(--danger)" : tone === "success" ? "var(--success)" : "var(--accent)";
  const Icon = tone === "error" ? CircleAlert : tone === "success" ? CircleCheck : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="anim-fade flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12.5px] leading-snug text-ink"
      style={{
        borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <Icon size={14} className="mt-px shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">
        {children}
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  );
}

/** Text link styled for auth footers. */
export function AuthLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={`focus-ring rounded font-medium text-ink underline-offset-[3px] transition-colors hover:text-accent hover:underline ${className}`}>
      {children}
    </a>
  );
}
