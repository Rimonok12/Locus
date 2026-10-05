"use client";
/* ─── Locus · project-level actions shared by the list context menu and the project header ─── */

import { Archive, ArchiveRestore, ArrowUpRight, Link2, Star, Trash2 } from "lucide-react";
import { copyText, deleteProject, isFavorite, toggleFavorite, updateProject } from "@/lib/sync/actions";
import { navigate } from "@/lib/router";
import { toast, ui } from "@/lib/ui";
import type { ActionItem } from "@/components/primitives/SelectMenu";
import type { Project } from "@/lib/types";
import { projectUrl } from "./shared";

export async function setProjectArchived(p: Pick<Project, "id" | "name">, archived: boolean) {
  const ok = await updateProject(p.id, { archived_at: archived ? new Date().toISOString() : null });
  if (!ok) return;
  if (archived) toast(`Archived ${p.name}`, { label: "Undo", run: () => { void updateProject(p.id, { archived_at: null }); } });
  else toast.success(`Restored ${p.name}`);
}

/** Projects being deleted from their own page — the page renders nothing (not "not found") while it unmounts. */
export const leavingProjects = new Set<string>();

export function confirmDeleteProject(p: Pick<Project, "id" | "name">, opts: { leave?: boolean } = {}) {
  ui.askConfirm({
    title: `Delete “${p.name}”?`,
    body: "Its milestones and updates are deleted too. Issues are kept but removed from the project. This can’t be undone.",
    confirmLabel: "Delete project",
    destructive: true,
    onConfirm: async () => {
      if (opts.leave) {
        leavingProjects.add(p.id);
        navigate({ kind: "projects", tab: "all" });
      }
      const ok = await deleteProject(p.id);
      leavingProjects.delete(p.id);
      if (!ok) return;
      // favorites aren't foreign-keyed to their target — drop ours so it doesn't linger
      if (isFavorite("project", p.id)) void toggleFavorite("project", p.id);
      toast(`Deleted ${p.name}`);
    },
  });
}

export const copyProjectLink = (id: string) => copyText(projectUrl(id), "Project link copied");

export function projectActionItems(
  p: Project,
  opts: { favorite: boolean; onOpen?: () => void; leaveOnDelete?: boolean },
): ActionItem[] {
  const items: ActionItem[] = [];
  if (opts.onOpen) items.push({ id: "open", label: "Open project", icon: <ArrowUpRight size={14} />, onSelect: opts.onOpen });
  items.push(
    {
      id: "favorite",
      label: opts.favorite ? "Remove from favorites" : "Add to favorites",
      icon: <Star size={14} className={opts.favorite ? "fill-current" : ""} />,
      onSelect: () => { void toggleFavorite("project", p.id); },
    },
    { id: "copy", label: "Copy link", icon: <Link2 size={14} />, onSelect: () => copyProjectLink(p.id) },
    {
      id: "archive",
      label: p.archived_at ? "Unarchive" : "Archive",
      icon: p.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />,
      onSelect: () => { void setProjectArchived(p, !p.archived_at); },
    },
    {
      id: "delete",
      divider: true,
      danger: true,
      label: "Delete project…",
      icon: <Trash2 size={14} />,
      onSelect: () => confirmDeleteProject(p, { leave: opts.leaveOnDelete }),
    },
  );
  return items;
}
