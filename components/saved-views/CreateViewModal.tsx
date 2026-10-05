"use client";
/* ─── Locus · "New view" modal: name, color, team, visibility, live filter builder ─── */

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Globe, Layers, Lock, X } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui, useUI } from "@/lib/ui";
import { navigate } from "@/lib/router";
import { COLORS, useIssueQuery } from "@/lib/model";
import { createView } from "@/lib/sync/actions";
import { DisplayMenu, FilterBar, FilterButton } from "@/components/issues/IssuesSurface";
import { Button, IconButton, Switch } from "@/components/primitives/controls";
import { Dropdown, Modal } from "@/components/primitives/overlay";
import { TeamIcon } from "@/components/primitives/icons";
import { TeamMenu } from "@/components/pickers";
import { modKey } from "@/lib/format";
import type { Issue } from "@/lib/types";
import { HIDE_SAVE_VIEW, VIEW_NAME_MAX } from "./viewActions";
import PopFix from "@/components/inbox/PopFix";

export const DRAFT_KEY = "view-draft";

export default function CreateViewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} width={620} position="top" label="New view">
      {open && <CreateViewForm onClose={onClose} />}
    </Modal>
  );
}

function resetDraft() {
  ui.setFilters(DRAFT_KEY, []);
  ui.resetDisplay(DRAFT_KEY);
}

/** Switching to a team drops draft values that belong to another team (statuses, cycles, team labels). */
function pruneDraftForTeam(teamId: string) {
  const s = useSync.getState();
  const draft = useUI.getState().filters[DRAFT_KEY] ?? [];
  const belongs = (field: string, v: string) => {
    if (v === "none" || v === "me" || v === "current") return true;
    if (field === "status") return s.workflow_states[v]?.team_id === teamId;
    if (field === "cycle") return s.cycles[v]?.team_id === teamId;
    if (field === "label") return !s.labels[v]?.team_id || s.labels[v]?.team_id === teamId;
    if (field === "team") return v === teamId;
    return true;
  };
  const next = draft
    .map((f) => ({ ...f, values: f.values.filter((v) => belongs(f.field, v)) }))
    .filter((f) => f.values.length);
  if (next.length !== draft.length || next.some((f, i) => f.values.length !== draft[i].values.length)) ui.setFilters(DRAFT_KEY, next);
}

function CreateViewForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const team = useSync((s) => (teamId ? s.teams[teamId] : undefined));
  const draftCount = useUI((u) => u.filters[DRAFT_KEY]?.length ?? 0);

  // a fresh draft every time the modal opens; nothing leaks into the next one
  useEffect(() => {
    resetDraft();
    return resetDraft;
  }, []);

  const scope = useCallback((i: Issue) => !teamId || i.team_id === teamId, [teamId]);
  const query = useIssueQuery({ viewKey: DRAFT_KEY, scope, teamId: teamId ?? undefined, deps: [scope] });

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const st = useUI.getState();
    const view = await createView({
      name: trimmed,
      color,
      team_id: teamId,
      shared,
      filters: st.filters[DRAFT_KEY] ?? [],
      display: st.display[DRAFT_KEY] ?? {},
    });
    setBusy(false);
    if (!view) return;
    resetDraft();
    onClose();
    navigate({ kind: "view", id: view.id });
    toast.success(`Created view ${view.name}`);
  };

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
      }}
    >
      <div className="flex h-12 items-center justify-between border-b border-line pl-5 pr-3">
        <h2 className="text-[14px] font-semibold text-ink">New view</h2>
        <IconButton label="Close" size={30} onClick={onClose}><X size={15} /></IconButton>
      </div>

      <div className="max-h-[calc(100dvh-12vh-140px)] space-y-5 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised">
            <Layers size={17} style={{ color }} />
          </span>
          <input
            autoFocus
            value={name}
            maxLength={VIEW_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); submit(); } }}
            placeholder="View name"
            aria-label="View name"
            className="h-9 min-w-0 flex-1 bg-transparent text-[16px] font-medium text-ink outline-none placeholder:text-faint md:text-[15px]"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Color</span>
          <div className="flex flex-wrap gap-0.5" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className="focus-ring flex h-8 w-8 items-center justify-center rounded-md hover:bg-wash"
              >
                <span
                  className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${color === c ? "ring-2 ring-offset-2 ring-offset-[var(--surface)]" : ""}`}
                  style={{ background: c, ["--tw-ring-color" as string]: c }}
                >
                  {color === c && <Check size={11} strokeWidth={3} className="text-white" />}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Team</span>
            <div className="flex items-center gap-1">
              <Dropdown
                width={260}
                trigger={(p) => (
                  <button
                    ref={p.ref}
                    type="button"
                    onClick={p.onClick}
                    aria-expanded={p["aria-expanded"]}
                    className="focus-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink hover:bg-wash"
                  >
                    {team ? <TeamIcon team={team} size={16} /> : <Globe size={14} className="text-faint" />}
                    <span className="min-w-0 flex-1 truncate text-left">{team ? team.name : "All teams"}</span>
                    <ChevronDown size={13} className="shrink-0 text-faint" />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <PopFix focus />
                    <TeamMenu value={teamId} onChange={(id) => { setTeamId(id); pruneDraftForTeam(id); close(); }} />
                  </>
                )}
              </Dropdown>
              {team && (
                <IconButton label="Show all teams" size={32} onClick={() => setTeamId(null)}><X size={14} /></IconButton>
              )}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[12.5px] font-medium text-ink">Visibility</span>
            <label className="flex h-8 cursor-pointer items-center gap-2.5 text-[13px] text-dim">
              <Switch checked={shared} onChange={setShared} label="Visible to everyone in the workspace" />
              <span className="flex min-w-0 items-center gap-1.5">
                {shared ? <Globe size={13} className="shrink-0 text-faint" /> : <Lock size={13} className="shrink-0 text-faint" />}
                <span className="truncate">{shared ? "Visible to everyone in the workspace" : "Only visible to you"}</span>
              </span>
            </label>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-ink">Filters</span>
            <span className="text-xxs tabular-nums text-faint">
              {query.total} matching issue{query.total === 1 ? "" : "s"}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-raised">
            <div className="flex flex-wrap items-center gap-1.5 p-2">
              <FilterButton viewKey={DRAFT_KEY} teamId={teamId ?? undefined} />
              <DisplayMenu viewKey={DRAFT_KEY} query={query} />
              {!draftCount && (
                <span className="px-1 text-[12.5px] text-faint">
                  No filters yet — the view will show every issue{team ? ` in ${team.name}` : ""}.
                </span>
              )}
            </div>
            {/* this modal *is* the save step — hide the filter bar's own "Save view" shortcut */}
            {draftCount > 0 && (
              <div className={HIDE_SAVE_VIEW}>
                <FilterBar viewKey={DRAFT_KEY} query={query} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
        <span className="hidden text-xxs text-faint sm:inline"><kbd>{modKey()}</kbd> <kbd>↵</kbd> to create</span>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>Create view</Button>
        </div>
      </div>
    </div>
  );
}
