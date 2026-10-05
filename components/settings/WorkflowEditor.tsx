"use client";
/* ─── Locus · team workflow editor (statuses grouped by type) ─── */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast } from "@/lib/ui";
import { STATE_TYPES, STATE_TYPE_COLOR, STATE_TYPE_LABEL, between, useTeamStates } from "@/lib/model";
import { createState, deleteState, updateState } from "@/lib/sync/actions";
import { Button, Input } from "@/components/primitives/controls";
import { Dropdown, Modal } from "@/components/primitives/overlay";
import { SelectMenu } from "@/components/primitives/SelectMenu";
import { StateIcon } from "@/components/primitives/icons";
import { StateGlyph } from "@/components/pickers";
import type { StateType, Team, WorkflowState } from "@/lib/types";
import { ColorMenu, TextField, plural, sameName } from "./kit";

const TYPE_HINT: Record<StateType, string> = {
  backlog: "Ideas and issues not yet planned",
  unstarted: "Planned, ready to be picked up",
  started: "Actively being worked on",
  completed: "Finished work",
  canceled: "Won't be done",
};

export default function WorkflowEditor({ team }: { team: Team }) {
  const states = useTeamStates(team.id);
  const issues = useSync((s) => s.issues);
  const [adding, setAdding] = useState<StateType | null>(null);
  const [deleting, setDeleting] = useState<WorkflowState | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of Object.values(issues)) if (i.team_id === team.id) c[i.state_id] = (c[i.state_id] ?? 0) + 1;
    return c;
  }, [issues, team.id]);

  const nameError = (name: string, selfId?: string) => {
    if (!name) return "Status name can't be empty";
    if (name.length > 48) return "48 characters max";
    if (states.some((s) => s.id !== selfId && sameName(s.name, name))) return `This team already has a “${name}” status`;
    return null;
  };

  /** Move a status up/down within its type: swap positions with the neighbour (or slot in by midpoint on ties). */
  const move = (list: WorkflowState[], index: number, dir: -1 | 1) => {
    const j = index + dir;
    const a = list[index];
    const b = list[j];
    if (!a || !b) return;
    if (a.position !== b.position) {
      void updateState(a.id, { position: b.position });
      void updateState(b.id, { position: a.position });
      return;
    }
    const beyond = list[j + dir];
    const pos = dir < 0 ? between(beyond?.position, b.position) : between(b.position, beyond?.position);
    void updateState(a.id, { position: pos });
  };

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        {STATE_TYPES.map((type) => {
          const list = states.filter((s) => s.type === type);
          return (
            <div key={type} className="border-b border-line last:border-b-0">
              <div className="flex h-9 items-center gap-2 bg-raised pl-4 pr-2">
                <StateIcon type={type} color={STATE_TYPE_COLOR[type]} size={13} />
                <span className="text-[12.5px] font-medium text-ink">{STATE_TYPE_LABEL[type]}</span>
                <span className="hidden truncate text-xxs text-faint sm:inline">· {TYPE_HINT[type]}</span>
                <button
                  type="button"
                  onClick={() => setAdding(type)}
                  aria-label={`Add ${STATE_TYPE_LABEL[type]} status`}
                  className="focus-ring ml-auto flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-faint transition-colors hover:bg-wash hover:text-ink"
                >
                  <Plus size={13} /> <span className="hidden sm:inline">Add status</span>
                </button>
              </div>
              {list.map((st, i) => (
                <StateRow
                  key={st.id}
                  state={st}
                  count={counts[st.id] ?? 0}
                  first={i === 0}
                  last={i === list.length - 1}
                  canDelete={states.length > 1}
                  validate={(n) => nameError(n, st.id)}
                  onMove={(dir) => move(list, i, dir)}
                  onDelete={() => setDeleting(st)}
                />
              ))}
              {!list.length && adding !== type && (
                <div className="px-4 py-2.5 text-[12.5px] text-faint">No {STATE_TYPE_LABEL[type].toLowerCase()} statuses</div>
              )}
              {adding === type && (
                <NewStateRow team={team} type={type} validate={(n) => nameError(n)} onClose={() => setAdding(null)} />
              )}
            </div>
          );
        })}
      </div>

      <DeleteStateModal
        state={deleting}
        states={states}
        count={deleting ? counts[deleting.id] ?? 0 : 0}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function StateRow({
  state, count, first, last, canDelete, validate, onMove, onDelete,
}: {
  state: WorkflowState; count: number; first: boolean; last: boolean; canDelete: boolean;
  validate: (name: string) => string | null; onMove: (dir: -1 | 1) => void; onDelete: () => void;
}) {
  const btn =
    "focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-wash hover:text-ink disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="group flex flex-wrap md:flex-nowrap min-h-[44px] items-center gap-1 border-t border-line py-1 pl-2 pr-2 sm:pl-3">
      <ColorMenu
        value={state.color}
        onChange={(color) => updateState(state.id, { color })}
        label={`Change color of ${state.name}`}
        glyph={<StateGlyph stateId={state.id} />}
      />
      <TextField
        variant="inline"
        ariaLabel="Status name"
        value={state.name}
        maxLength={48}
        validate={validate}
        onSave={(name) => updateState(state.id, { name })}
        className="min-w-0 flex-1 font-medium md:w-[200px] md:flex-none"
      />
      <TextField
        variant="inline"
        muted
        ariaLabel="Status description"
        value={state.description}
        placeholder="Add description…"
        maxLength={240}
        onSave={(description) => updateState(state.id, { description })}
        className="order-last ml-9 min-w-0 basis-[calc(100%-2.25rem)] md:order-none md:ml-0 md:flex-1 md:basis-0"
      />
      <span className="hidden w-[64px] shrink-0 text-right text-xxs tabular-nums text-faint sm:block">{plural(count, "issue")}</span>
      <div className="flex shrink-0 items-center transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:[@media(hover:hover)]:opacity-0">
        <button type="button" className={btn} disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${state.name} up`} title="Move up">
          <ArrowUp size={13} />
        </button>
        <button type="button" className={btn} disabled={last} onClick={() => onMove(1)} aria-label={`Move ${state.name} down`} title="Move down">
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          className={`${btn} hover:text-danger`}
          disabled={!canDelete}
          onClick={onDelete}
          aria-label={`Delete ${state.name}`}
          title={canDelete ? "Delete status" : "A team needs at least one status"}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function NewStateRow({
  team, type, validate, onClose,
}: { team: Team; type: StateType; validate: (name: string) => string | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(STATE_TYPE_COLOR[type]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const submit = async () => {
    const n = name.trim();
    const err = validate(n);
    if (err) { setError(err); return; }
    setBusy(true);
    const created = await createState(team.id, n, type, color);
    setBusy(false);
    if (!created) return;
    toast.success(`Added status ${created.name}`);
    onClose();
  };

  return (
    <form
      className="anim-fade border-t border-line bg-raised px-2 py-2 sm:px-3"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <div className="flex items-center gap-1.5">
        <ColorMenu value={color} onChange={setColor} label="Status color" glyph={<StateIcon type={type} color={color} />} />
        <Input
          ref={ref}
          value={name}
          maxLength={48}
          invalid={Boolean(error)}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
          placeholder={`New ${STATE_TYPE_LABEL[type].toLowerCase()} status`}
          aria-label="New status name"
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink sm:hidden"
        >
          <X size={14} />
        </button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} className="hidden sm:inline-flex">Cancel</Button>
        <Button type="submit" size="sm" className="max-sm:h-8" variant="primary" loading={busy} disabled={!name.trim()}>Add</Button>
      </div>
      {error && <div className="mt-1 pl-10 text-xxs text-danger">{error}</div>}
    </form>
  );
}

function DeleteStateModal({
  state, states, count, onClose,
}: { state: WorkflowState | null; states: WorkflowState[]; count: number; onClose: () => void }) {
  const busy = useRef(false);
  return (
    <Modal open={Boolean(state)} onClose={() => { if (!busy.current) onClose(); }} width={440} label="Delete status">
      {state && <DeleteStateForm key={state.id} state={state} states={states} count={count} onClose={onClose} busyRef={busy} />}
    </Modal>
  );
}

function DeleteStateForm({
  state, states, count, onClose, busyRef,
}: { state: WorkflowState; states: WorkflowState[]; count: number; onClose: () => void; busyRef: { current: boolean } }) {
  const options = useMemo(() => states.filter((s) => s.id !== state.id), [state.id, states]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { busyRef.current = false; }, [busyRef]);

  // default: another status of the same category, else the first one; survives a picked status being deleted meanwhile
  const target = options.find((s) => s.id === picked) ?? options.find((s) => s.type === state.type) ?? options[0];
  const lastOfType = !options.some((s) => s.type === state.type);

  const confirm = async () => {
    if (!target || busy) return;
    setBusy(true);
    busyRef.current = true;
    const ok = await deleteState(state.id, target.id);
    busyRef.current = false;
    setBusy(false);
    if (!ok) return;
    toast.success(count ? `Deleted ${state.name} · moved ${plural(count, "issue")} to ${target.name}` : `Deleted status ${state.name}`);
    onClose();
  };

  return (
    <form className="p-5" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
      <h2 className="text-[15px] font-semibold text-ink">Delete status “{state.name}”?</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-dim">
        {count
          ? <>{plural(count, "issue")} {count === 1 ? "is" : "are"} in this status. Choose where to move {count === 1 ? "it" : "them"}:</>
          : "No issues use this status. This can't be undone."}
      </p>
      {count > 0 && (
        <div className="mt-3">
          <Dropdown
            width="anchor"
            trigger={(p) => (
              <button
                ref={p.ref}
                type="button"
                onClick={p.onClick}
                aria-expanded={p["aria-expanded"]}
                aria-label="Replacement status"
                className="focus-ring flex h-9 w-full items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-left text-[13px] text-ink hover:bg-wash"
              >
                {target ? <StateGlyph stateId={target.id} /> : null}
                <span className="min-w-0 flex-1 truncate">{target?.name ?? "Choose a status"}</span>
                {target && <span className="shrink-0 text-xxs text-faint">{STATE_TYPE_LABEL[target.type]}</span>}
                <ChevronDown size={13} className="shrink-0 text-faint" />
              </button>
            )}
          >
            {(close) => (
              <SelectMenu
                items={options.map((s) => ({ id: s.id, label: s.name, icon: <StateGlyph stateId={s.id} />, hint: STATE_TYPE_LABEL[s.type], keywords: [s.type] }))}
                selected={target?.id ?? null}
                onSelect={(id) => { setPicked(id); close(); }}
                placeholder="Move issues to…"
                digitShortcuts={false}
              />
            )}
          </Dropdown>
        </div>
      )}
      {lastOfType && (
        <p className="mt-3 rounded-md border border-line bg-raised px-3 py-2 text-[12.5px] leading-snug text-dim">
          This is the team&apos;s only <span className="font-medium text-ink">{STATE_TYPE_LABEL[state.type]}</span> status.
          Add another one later if you need this category.
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" className="max-sm:h-8" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="danger" className="max-sm:h-8" loading={busy} disabled={!target}>Delete status</Button>
      </div>
    </form>
  );
}
