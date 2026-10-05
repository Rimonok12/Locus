"use client";
/* ─── Locus · settings › labels (workspace labels page + reusable labels editor) ─── */

import { useMemo, useRef, useState } from "react";
import { Plus, Search, Tag, Trash2 } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui } from "@/lib/ui";
import { COLORS } from "@/lib/model";
import { createLabel, deleteLabel, updateLabel } from "@/lib/sync/actions";
import { Button, Input } from "@/components/primitives/controls";
import { LabelDot } from "@/components/primitives/icons";
import type { Label } from "@/lib/types";
import { Card, ColorMenu, Count, Section, SettingsPage, TextField, plural, sameName } from "./kit";

export default function LabelsSettings() {
  return (
    <SettingsPage
      title="Labels"
      description="Workspace labels are available to every team. Teams can add their own labels in their team settings."
    >
      <LabelsEditor teamId={null} searchable />
    </SettingsPage>
  );
}

/** Label list editor for one scope: workspace labels (teamId null) or one team's labels. */
export function LabelsEditor({ teamId, searchable = false, title }: { teamId: string | null; searchable?: boolean; title?: string }) {
  const all = useSync((s) => s.labels);
  const issues = useSync((s) => s.issues);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const labels = useMemo(
    () => Object.values(all).filter((l) => (teamId ? l.team_id === teamId : !l.team_id)).sort((a, b) => a.name.localeCompare(b.name)),
    [all, teamId],
  );
  /** labels a new / renamed one must not collide with: a workspace label shows up in every team's picker,
   *  a team label shares its picker with the workspace labels */
  const visibleNames = useMemo(
    () => Object.values(all).filter((l) => !teamId || !l.team_id || l.team_id === teamId),
    [all, teamId],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of Object.values(issues)) for (const l of i.label_ids) c[l] = (c[l] ?? 0) + 1;
    return c;
  }, [issues]);

  const q = query.trim().toLowerCase();
  const shown = q ? labels.filter((l) => l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)) : labels;

  const nameError = (name: string, selfId?: string) => {
    if (!name) return "Label name can't be empty";
    if (name.length > 48) return "48 characters max";
    const clash = visibleNames.find((l) => l.id !== selfId && sameName(l.name, name));
    if (!clash) return null;
    if (!clash.team_id) return `A workspace label named “${clash.name}” already exists`;
    const owner = useSync.getState().teams[clash.team_id];
    return `${owner ? owner.name : "A team"} already has a label named “${clash.name}”`;
  };

  const newButton = (
    <Button size="sm" className="max-sm:h-8" variant={searchable ? "primary" : "secondary"} icon={<Plus size={13} />} onClick={() => setCreating(true)} disabled={creating}>
      New label
    </Button>
  );

  return (
    <Section
      title={<>{title ?? (teamId ? "Team labels" : "Workspace labels")} <Count n={labels.length} /></>}
      description={teamId ? "Only available to issues in this team." : undefined}
      action={searchable ? undefined : newButton}
    >
      {searchable && (
        <div className="mb-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-[280px]">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); } }}
              placeholder="Search labels"
              aria-label="Search labels"
              className="pl-7"
            />
          </div>
          <span className="ml-auto">{newButton}</span>
        </div>
      )}
      <Card>
        {creating && (
          <NewLabelRow
            teamId={teamId}
            initialColor={COLORS[labels.length % COLORS.length]}
            validate={(n) => nameError(n)}
            onClose={() => setCreating(false)}
          />
        )}
        {shown.map((l) => (
          <LabelRow key={l.id} label={l} count={counts[l.id] ?? 0} validate={(n) => nameError(n, l.id)} />
        ))}
        {!shown.length && !creating && (
          <div className="flex flex-col items-center px-4 py-9 text-center">
            <Tag size={20} strokeWidth={1.6} className="mb-2.5 text-faint" />
            <div className="text-[13px] text-dim">
              {q ? <>No labels match &ldquo;{query.trim()}&rdquo;</> : teamId ? "This team has no labels of its own yet" : "No workspace labels yet"}
            </div>
            {!q && (
              <button type="button" onClick={() => setCreating(true)} className="mt-1.5 text-[12.5px] font-medium text-accent hover:underline">
                Create the first one
              </button>
            )}
          </div>
        )}
      </Card>
    </Section>
  );
}

function LabelRow({ label, count, validate }: { label: Label; count: number; validate: (name: string) => string | null }) {
  const confirmDelete = () => {
    ui.askConfirm({
      title: `Delete label “${label.name}”?`,
      body: count
        ? `Remove from ${plural(count, "issue")}? The label is removed from every issue that uses it. This can't be undone.`
        : "No issues use this label. This can't be undone.",
      confirmLabel: "Delete label",
      destructive: true,
      onConfirm: async () => { if (await deleteLabel(label.id)) toast.success(`Deleted label ${label.name}`); },
    });
  };

  return (
    <div className="group flex flex-wrap md:flex-nowrap min-h-[44px] items-center gap-1 py-1 pl-2 pr-2 sm:pl-3">
      <ColorMenu value={label.color} onChange={(color) => updateLabel(label.id, { color })} label={`Change color of ${label.name}`} />
      <TextField
        variant="inline"
        ariaLabel="Label name"
        value={label.name}
        maxLength={48}
        validate={validate}
        onSave={(name) => updateLabel(label.id, { name })}
        className="min-w-0 flex-1 font-medium md:w-[220px] md:flex-none"
      />
      <TextField
        variant="inline"
        ariaLabel="Label description"
        value={label.description}
        placeholder="Add description…"
        maxLength={240}
        onSave={(description) => updateLabel(label.id, { description })}
        muted
        className="order-last ml-9 min-w-0 basis-[calc(100%-2.25rem)] md:order-none md:ml-0 md:flex-1 md:basis-0"
      />
      <span className="w-[68px] shrink-0 text-right text-xxs tabular-nums text-faint">{plural(count, "issue")}</span>
      <button
        type="button"
        onClick={confirmDelete}
        aria-label={`Delete label ${label.name}`}
        title="Delete label"
        className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-[color,background-color,opacity] hover:bg-wash hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 md:[@media(hover:hover)]:opacity-0"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function NewLabelRow({
  teamId, initialColor, validate, onClose,
}: { teamId: string | null; initialColor: string; validate: (name: string) => string | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(initialColor);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const n = name.trim();
    const err = validate(n);
    if (err) { setError(err); return; }
    setBusy(true);
    const created = await createLabel(n, color, teamId);
    setBusy(false);
    if (!created) return;
    toast.success(`Created label ${created.name}`);
    // stay open for rapid entry with the next color
    setName("");
    setError(null);
    setColor(COLORS[(COLORS.indexOf(color) + 1) % COLORS.length]);
    inputRef.current?.focus();
  };

  return (
    <form
      className="anim-fade bg-raised px-2 py-2 sm:px-3"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <div className="flex items-center gap-1.5">
        <ColorMenu value={color} onChange={setColor} label="Label color" />
        <Input
          ref={inputRef}
          autoFocus
          value={name}
          maxLength={48}
          invalid={Boolean(error)}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
          placeholder="Label name"
          aria-label="New label name"
          className="min-w-0 flex-1"
        />
        <Button type="button" size="sm" className="max-sm:h-8" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" className="max-sm:h-8" variant="primary" loading={busy} disabled={!name.trim()}>Create</Button>
      </div>
      {error && <div className="mt-1 pl-10 text-xxs text-danger">{error}</div>}
      {!error && (
        <div className="mt-1 flex items-center gap-1.5 pl-10 text-xxs text-faint">
          <LabelDot color={color} size={7} /> Enter to create · Esc to close
        </div>
      )}
    </form>
  );
}
