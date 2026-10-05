"use client";
/* ─── Locus · a saved view's own filters as chips (owner can remove them) ─── */

import { useState } from "react";
import { Check, Layers, Pencil, X } from "lucide-react";
import { updateView } from "@/lib/sync/actions";
import type { View } from "@/lib/types";
import { useFilterText } from "./filterText";
import { viewFilters } from "./viewData";

export default function BaseFilters({ view, canEdit }: { view: View; canEdit: boolean }) {
  const { describe } = useFilterText();
  const [editing, setEditing] = useState(false);
  const filters = viewFilters(view);
  if (!filters.length) return null;

  // writes back the cleaned list, so removing a chip also drops any malformed stored entries
  const remove = (id: string) => updateView(view.id, { filters: filters.filter((f) => f.id !== id) });

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-t border-line px-3 py-1.5 md:px-4">
      <span className="mr-0.5 flex shrink-0 items-center gap-1.5 text-[12px] text-faint">
        <Layers size={12} />View filters
      </span>
      {filters.map((f) => (
        <span
          key={f.id}
          className={`inline-flex h-8 max-w-full items-center gap-0.5 rounded-md border bg-surface pl-2 text-[12px] text-dim sm:h-6 ${
            editing ? "border-line-strong pr-0.5" : "border-line pr-2"
          }`}
        >
          <span className="truncate">{describe(f)}</span>
          {editing && (
            <button
              type="button"
              aria-label={`Remove filter: ${describe(f)}`}
              onClick={() => remove(f.id)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-faint hover:bg-wash hover:text-danger sm:h-5 sm:w-5"
            >
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-dim hover:bg-wash hover:text-ink sm:h-6"
        >
          {editing ? <><Check size={12} />Done</> : <><Pencil size={12} />Edit</>}
        </button>
      )}
    </div>
  );
}
