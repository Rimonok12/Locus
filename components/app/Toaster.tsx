"use client";
/* ─── Locus · toasts ─── */

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { dismissToast, useUI } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { Portal } from "@/components/primitives/overlay";

export default function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const barUp = useUI((s) => s.selected.length > 0); // BulkActionBar is showing (before the early return: stable hook order)
  if (!toasts.length) return null;
  return (
    <Portal>
      <div
        className={cn(
          "pointer-events-none fixed right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2",
          // sit above the bulk action bar (its top edge: 64px below md, 72px from md) instead of covering it
          barUp ? "bottom-20 md:bottom-24" : "bottom-4",
        )}
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div key={t.id} className="anim-toast pointer-events-auto flex items-start gap-2.5 rounded-lg bg-surface px-3 py-2.5 shadow-pop">
            <span className="mt-px shrink-0">
              {t.kind === "error" ? <XCircle size={15} className="text-danger" /> : t.kind === "success" ? <CheckCircle2 size={15} className="text-success" /> : <Info size={15} className="text-accent" />}
            </span>
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{t.message}</p>
            {/* 32px hit areas; negative margins keep the toast as compact as the text */}
            {t.action && (
              <button
                type="button"
                onClick={() => { t.action!.run(); dismissToast(t.id); }}
                className="focus-ring -my-1.5 inline-flex h-8 shrink-0 items-center rounded-md px-2 text-[12.5px] font-medium text-accent hover:bg-wash"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismissToast(t.id)}
              className="focus-ring -my-1.5 -mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Portal>
  );
}
