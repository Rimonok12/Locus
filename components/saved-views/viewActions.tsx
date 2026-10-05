"use client";
/* ─── Locus · saved-view helpers: favorite star, duplicate, delete, permissions ─── */

import { Star } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui } from "@/lib/ui";
import { navigate } from "@/lib/router";
import { useIsAdmin, useMeId } from "@/lib/model";
import { createView, deleteView, toggleFavorite } from "@/lib/sync/actions";
import { IconButton } from "@/components/primitives/controls";
import type { DisplayOptions, FavoriteKind, Filter, View } from "@/lib/types";
import { viewDisplay, viewFilters } from "./viewData";

export const VIEW_NAME_MAX = 80;

/** Owner or workspace admin (mirrors the views RLS policy). */
export function useCanEditView(view: Pick<View, "owner_id"> | undefined): boolean {
  const me = useMeId();
  const admin = useIsAdmin();
  return Boolean(view) && (view!.owner_id === me || admin);
}

export function useIsFavorite(kind: FavoriteKind, id: string): boolean {
  return useSync((s) => Object.values(s.favorites).some((f) => f.kind === kind && f.target_id === id && f.user_id === s.userId));
}

export function FavoriteButton({ kind, id, subtle = false, size = 28 }: { kind: FavoriteKind; id: string; subtle?: boolean; size?: number }) {
  const fav = useIsFavorite(kind, id);
  const label = fav ? "Remove from favorites" : "Add to favorites";
  // IconButton already carries the label as its native tooltip
  return (
    <IconButton
      label={label}
      size={size}
      aria-pressed={fav}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(kind, id); }}
      className={`max-md:!h-8 max-md:!w-8 ${subtle && !fav ? "md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100 [@media(hover:none)]:opacity-100" : ""}`}
    >
      <Star size={14} className={fav ? "fill-current text-warning" : ""} />
    </IconButton>
  );
}

export async function duplicateView(view: View, override: { filters?: Filter[]; display?: Partial<DisplayOptions>; shared?: boolean } = {}) {
  const name = `${view.name} (copy)`.slice(0, VIEW_NAME_MAX);
  const copy = await createView({
    name,
    description: view.description,
    icon: view.icon,
    color: view.color,
    team_id: view.team_id,
    shared: override.shared ?? view.shared,
    filters: override.filters ?? viewFilters(view),
    display: override.display ?? viewDisplay(view),
  });
  if (copy) toast.success(`Created ${copy.name}`, { label: "Open", run: () => navigate({ kind: "view", id: copy.id }) });
  return copy;
}

export function confirmDeleteView(view: View, beforeDelete?: () => void) {
  ui.askConfirm({
    title: `Delete “${view.name}”?`,
    body: view.shared
      ? "This view is shared — it will disappear for everyone in the workspace. Issues aren’t affected."
      : "The view will be deleted. Issues aren’t affected.",
    confirmLabel: "Delete view",
    destructive: true,
    onConfirm: async () => {
      beforeDelete?.();
      await deleteView(view.id);
    },
  });
}
