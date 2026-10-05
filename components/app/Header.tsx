"use client";
/* ─── Locus · standard view header (every routed view starts with this) ─── */

import type { ReactNode } from "react";
import { Menu, PanelLeft } from "lucide-react";
import { ui, useUI } from "@/lib/ui";
import { linkProps, type Route } from "@/lib/router";

export interface Crumb { label: ReactNode; to?: Route; icon?: ReactNode }

/**
 * Top bar: [mobile menu] [sidebar toggle when collapsed] breadcrumbs/title · tabs · right-aligned actions.
 * Height 48px, bottom hairline. Put view-specific filters/display controls in `actions`.
 */
export function ViewHeader({
  title, icon, crumbs, tabs, actions, sub,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  crumbs?: Crumb[];
  tabs?: ReactNode;
  actions?: ReactNode;
  /** optional second row (filter bar) rendered under the header */
  sub?: ReactNode;
}) {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  return (
    <header className="shrink-0 border-b border-line bg-canvas">
      <div className="flex h-12 items-center gap-2 px-3 md:px-4">
        <button aria-label="Open navigation" onClick={() => ui.setMobileNav(true)} className="-ml-1 flex h-8 w-8 items-center justify-center rounded-md text-dim hover:bg-wash md:hidden">
          <Menu size={17} />
        </button>
        {collapsed && (
          <button aria-label="Show sidebar" onClick={ui.toggleSidebar} className="-ml-1 hidden h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink md:flex">
            <PanelLeft size={15} />
          </button>
        )}
        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
          {crumbs?.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {c.to ? (
                <a {...linkProps(c.to)} className="flex min-w-0 items-center gap-1.5 truncate rounded px-1 py-0.5 text-dim hover:bg-wash hover:text-ink">
                  {c.icon}<span className="truncate">{c.label}</span>
                </a>
              ) : (
                <span className="flex min-w-0 items-center gap-1.5 truncate px-1 text-dim">{c.icon}<span className="truncate">{c.label}</span></span>
              )}
              <span className="text-faint">›</span>
            </span>
          ))}
          {(title || icon) && (
            <h1 className="flex min-w-0 items-center gap-1.5 truncate px-1 font-medium text-ink">
              {icon}<span className="truncate">{title}</span>
            </h1>
          )}
        </div>
        {tabs && <div className="ml-2 hidden min-w-0 items-center gap-1 overflow-x-auto sm:flex">{tabs}</div>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
      </div>
      {tabs && <div className="flex items-center gap-1 overflow-x-auto px-3 pb-2 sm:hidden">{tabs}</div>}
      {sub}
    </header>
  );
}

/** Pill-style tab used in headers ("All issues · Active · Backlog"). */
export function HeaderTab({ to, active, children, onClick }: { to?: Route; active: boolean; children: ReactNode; onClick?: () => void }) {
  // 32px touch target where the tabs get their own row (phones), 28px in the header from sm up
  const cls = `focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors sm:h-7 ${
    active ? "border-line-strong bg-surface text-ink shadow-card" : "border-transparent text-dim hover:bg-wash hover:text-ink"
  }`;
  if (to) return <a {...linkProps(to)} className={cls}>{children}</a>;
  return <button onClick={onClick} className={cls}>{children}</button>;
}
