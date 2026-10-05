"use client";
/* ─── Locus · a saved view: its base filters + the user's ad-hoc changes ─── */

import { useCallback, useMemo, useState } from "react";
import { Copy, Globe, Layers, Link2, Lock, MoreHorizontal, Pencil, RotateCcw, Star, Trash2 } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui, useUI } from "@/lib/ui";
import { hrefFor, navigate } from "@/lib/router";
import { defaultDisplay, useIssueQuery } from "@/lib/model";
import { copyText, toggleFavorite, updateView } from "@/lib/sync/actions";
import { ViewHeader } from "@/components/app/Header";
import NotFound from "@/components/app/NotFound";
import IssuesSurface, { DisplayMenu, FilterBar, FilterButton } from "@/components/issues/IssuesSurface";
import { Button, EmptyState, IconButton } from "@/components/primitives/controls";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu, type ActionItem } from "@/components/primitives/SelectMenu";
import { TeamIcon } from "@/components/primitives/icons";
import BaseFilters from "@/components/saved-views/BaseFilters";
import { PersonalBadge, RenameInput } from "@/components/saved-views/ViewRow";
import { FavoriteButton, confirmDeleteView, duplicateView, useCanEditView, useIsFavorite } from "@/components/saved-views/viewActions";
import type { DisplayOptions, Issue, View } from "@/lib/types";

export default function SavedView({ id }: { id: string }) {
  const view = useSync((s) => s.views[id]);
  if (!view) return <NotFound what="view" />;
  return <SavedViewBody key={id} view={view} />;
}

/** Merge the user's display tweaks onto the view's saved display. */
function mergeDisplay(base: Partial<DisplayOptions>, patch: Partial<DisplayOptions> | undefined): Partial<DisplayOptions> {
  if (!patch) return base;
  const merged: Partial<DisplayOptions> = { ...base, ...patch };
  if (base.properties || patch.properties) {
    merged.properties = { ...(base.properties ?? {}), ...(patch.properties ?? {}) } as DisplayOptions["properties"];
  }
  return merged;
}

function SavedViewBody({ view }: { view: View }) {
  const viewKey = `view:${view.id}`;
  const canEdit = useCanEditView(view);
  const favorite = useIsFavorite("view", view.id);
  const team = useSync((s) => (view.team_id ? s.teams[view.team_id] : undefined));
  const userFilters = useUI((u) => u.filters[viewKey]);
  const userDisplay = useUI((u) => u.display[viewKey]);
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);

  const teamId = view.team_id ?? undefined;
  const scope = useCallback((i: Issue) => !teamId || i.team_id === teamId, [teamId]);
  const query = useIssueQuery({
    viewKey,
    scope,
    baseFilters: view.filters,
    defaults: view.display,
    teamId,
    deps: [scope],
  });

  /** only count display keys that actually differ from what the view saved */
  const displayChanged = useMemo(() => {
    if (!userDisplay) return false;
    const saved = defaultDisplay(view.display);
    return (Object.keys(userDisplay) as (keyof DisplayOptions)[]).some((k) => {
      if (k === "properties") {
        const props = userDisplay.properties ?? {};
        return Object.entries(props).some(([p, v]) => saved.properties[p as keyof DisplayOptions["properties"]] !== v);
      }
      return JSON.stringify(userDisplay[k]) !== JSON.stringify(saved[k]);
    });
  }, [userDisplay, view.display]);
  const filtersChanged = (userFilters?.length ?? 0) > 0;
  const dirty = filtersChanged || displayChanged;

  const discard = () => {
    ui.setFilters(viewKey, []);
    ui.resetDisplay(viewKey);
  };

  const save = async () => {
    const prevFilters = userFilters ?? [];
    const prevDisplay = userDisplay;
    const patch = {
      filters: [...view.filters, ...prevFilters],
      display: mergeDisplay(view.display, prevDisplay),
    };
    setSaving(true);
    discard(); // optimistic: the view itself now carries the changes
    const ok = await updateView(view.id, patch);
    setSaving(false);
    if (ok) {
      toast.success("View saved");
    } else {
      ui.setFilters(viewKey, prevFilters);
      if (prevDisplay) ui.setDisplay(viewKey, prevDisplay);
    }
  };

  const saveAsNew = async () => {
    setSaving(true);
    const copy = await duplicateView(view, {
      filters: [...view.filters, ...(userFilters ?? [])],
      display: mergeDisplay(view.display, userDisplay),
      shared: false,
    });
    setSaving(false);
    if (copy) {
      discard();
      navigate({ kind: "view", id: copy.id });
    }
  };

  const rename = (name: string | null) => {
    setRenaming(false);
    if (name) updateView(view.id, { name });
  };

  const items: ActionItem[] = [
    ...(canEdit ? [
      { id: "rename", label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
      {
        id: "visibility",
        label: view.shared ? "Make personal" : "Share with workspace",
        icon: view.shared ? <Lock size={14} /> : <Globe size={14} />,
        onSelect: () => updateView(view.id, { shared: !view.shared }),
      },
    ] : []),
    { id: "favorite", label: favorite ? "Remove from favorites" : "Add to favorites", icon: <Star size={14} />, onSelect: () => toggleFavorite("view", view.id) },
    { id: "duplicate", label: "Duplicate", icon: <Copy size={14} />, onSelect: () => duplicateView(view) },
    { id: "link", label: "Copy link", icon: <Link2 size={14} />, onSelect: () => copyText(`${window.location.origin}${hrefFor({ kind: "view", id: view.id })}`, "Link copied") },
    ...(canEdit ? [{
      id: "delete", label: "Delete view", icon: <Trash2 size={14} />, danger: true, divider: true,
      onSelect: () => confirmDeleteView(view, () => navigate({ kind: "views" })),
    }] : []),
  ];

  const title = renaming ? (
    <RenameInput initial={view.name} onDone={rename} className="w-[min(320px,50vw)]" />
  ) : canEdit ? (
    <button
      type="button"
      onClick={() => setRenaming(true)}
      title="Rename view"
      className="focus-ring -mx-1 max-w-full truncate rounded px-1 py-0.5 text-left hover:bg-wash"
    >
      {view.name}
    </button>
  ) : (
    view.name
  );

  return (
    <>
      <ViewHeader
        crumbs={[{ label: "Views", to: { kind: "views" } }]}
        icon={<Layers size={15} style={{ color: view.color }} className="shrink-0" />}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">{title}</span>
            {!view.shared && !renaming && <span className="hidden sm:inline-flex"><PersonalBadge /></span>}
            {team && !renaming && (
              <span className="hidden shrink-0 items-center gap-1 text-[12px] font-normal text-faint md:inline-flex">
                <TeamIcon team={team} size={14} />{team.key}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {dirty && (
              <>
                <Button variant="ghost" size="sm" onClick={discard} disabled={saving} className="hidden sm:inline-flex">Discard</Button>
                <Button variant="primary" size="sm" loading={saving} onClick={canEdit ? save : saveAsNew} className="max-md:h-8">
                  {canEdit
                    ? <><span className="hidden sm:inline">Save changes</span><span className="sm:hidden">Save</span></>
                    : <><span className="hidden sm:inline">Save as new view</span><span className="sm:hidden">Save as…</span></>}
                </Button>
              </>
            )}
            <span className="hidden sm:inline-flex"><FavoriteButton kind="view" id={view.id} /></span>
            <FilterButton viewKey={viewKey} teamId={teamId} />
            <DisplayMenu viewKey={viewKey} query={query} />
            <Dropdown
              align="end"
              width={230}
              trigger={(p) => (
                <IconButton ref={p.ref} onClick={p.onClick} aria-expanded={p["aria-expanded"]} active={p.open} size={30} label="View actions" className="max-md:!h-8 max-md:!w-8">
                  <MoreHorizontal size={15} />
                </IconButton>
              )}
            >
              {(close) => (
                <ActionMenu
                  onDone={close}
                  items={dirty ? [{ id: "discard", label: "Discard changes", icon: <RotateCcw size={14} />, onSelect: discard }, ...items.map((it, i) => (i === 0 ? { ...it, divider: true } : it))] : items}
                />
              )}
            </Dropdown>
          </>
        }
        sub={
          <>
            <BaseFilters view={view} canEdit={canEdit} />
            <FilterBar viewKey={viewKey} query={query} />
          </>
        }
      />

      <IssuesSurface
        query={query}
        viewKey={viewKey}
        createDefaults={view.team_id ? { team_id: view.team_id } : undefined}
        empty={
          <EmptyState
            icon={<Layers size={28} strokeWidth={1.5} />}
            title="No issues match this view"
            body={filtersChanged ? "Your extra filters narrow it down to nothing — clear them to see the whole view." : "Issues that match the view’s filters will show up here as they’re created."}
            action={filtersChanged ? <Button variant="secondary" size="md" onClick={() => ui.setFilters(viewKey, [])}>Clear my filters</Button> : undefined}
          />
        }
      />
    </>
  );
}
