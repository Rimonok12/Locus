"use client";
/* ─── Locus · toasts ─── */

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { dismissToast, useUI } from "@/lib/ui";
import { Portal } from "@/components/primitives/overlay";

export default function Toaster() {
  const toasts = useUI((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <Portal>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="anim-toast pointer-events-auto flex items-start gap-2.5 rounded-lg bg-surface px-3 py-2.5 shadow-pop">
            <span className="mt-px shrink-0">
              {t.kind === "error" ? <XCircle size={15} className="text-danger" /> : t.kind === "success" ? <CheckCircle2 size={15} className="text-success" /> : <Info size={15} className="text-accent" />}
            </span>
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{t.message}</p>
            {t.action && (
              <button
                onClick={() => { t.action!.run(); dismissToast(t.id); }}
                className="shrink-0 rounded px-1.5 text-[12.5px] font-medium text-accent hover:bg-wash"
              >
                {t.action.label}
              </button>
            )}
            <button aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="shrink-0 text-faint hover:text-ink"><X size={14} /></button>
          </div>
        ))}
      </div>
    </Portal>
  );
}
