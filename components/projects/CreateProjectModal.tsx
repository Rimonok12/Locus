"use client";
/* ─── Locus · create project modal ───────────────────────────────────────────
   CONTRACT: default CreateProjectModal({ open, onClose, defaultTeamId? })
   Creates the project through createProject(…) and navigates to it.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Hexagon, X } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { DOC_TOO_LONG, useMyTeams } from "@/lib/model";
import { createProject } from "@/lib/sync/actions";
import { navigate } from "@/lib/router";
import { modKey } from "@/lib/format";
import { toast } from "@/lib/ui";
import { Modal, Dropdown } from "@/components/primitives/overlay";
import { Button } from "@/components/primitives/controls";
import { ProjectIcon } from "@/components/primitives/icons";
import Editor, { isEmptyHtml } from "@/components/editor/Editor";
import { IconColorPicker, ProjectPropertyChips, type ProjectFields } from "./menus";
import { DocTooLongNote, docTooLong } from "./shared";
import type { Project } from "@/lib/types";

export default function CreateProjectModal({
  open, onClose, defaultTeamId,
}: { open: boolean; onClose: () => void; defaultTeamId?: string }) {
  return (
    <Modal open={open} onClose={onClose} width={720} label="New project">
      {open && <CreateProjectForm onClose={onClose} defaultTeamId={defaultTeamId} />}
    </Modal>
  );
}

function CreateProjectForm({ onClose, defaultTeamId }: { onClose: () => void; defaultTeamId?: string }) {
  const me = useSync((s) => s.userId);
  const myTeams = useMyTeams();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState("#3f72af");
  const [fields, setFields] = useState<ProjectFields>(() => ({
    status: "planned",
    priority: 0,
    lead_id: me || null,
    member_ids: [],
    team_ids: defaultTeamId ? [defaultTeamId] : myTeams[0] ? [myTeams[0].id] : [],
    start_date: null,
    target_date: null,
  }));
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const summaryRef = useRef<HTMLInputElement>(null);
  const valid = name.trim().length > 0;
  const descriptionTooLong = docTooLong(description);

  const submit = async () => {
    setTouched(true);
    if (!valid || busyRef.current) return;
    // the DB would reject it: keep the modal (and everything typed) open so it can be trimmed
    if (descriptionTooLong) { toast.error(DOC_TOO_LONG); return; }
    busyRef.current = true;
    setBusy(true);
    const input: Partial<Project> & { name: string } = {
      name: name.trim(),
      summary: summary.trim(),
      description: isEmptyHtml(description) ? "" : description,
      icon,
      color,
      ...fields,
    };
    const p = await createProject(input);
    busyRef.current = false;
    // closed while saving: the project still exists (and toasts with "Open"), but don't yank the user away
    if (!mounted.current) return;
    setBusy(false);
    if (p) {
      onClose();
      navigate({ kind: "project", id: p.id, tab: "overview" });
    }
  };

  // the editor may keep the first onSubmit it receives — always call the latest submit
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const onPatch = (patch: Partial<Project>) => setFields((f) => ({ ...f, ...patch }));

  return (
    <div
      className="flex max-h-[calc(100dvh-32px)] flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) { e.preventDefault(); submit(); }
      }}
    >
      {/* top bar */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 px-4 text-[12.5px]">
        <span className="flex items-center gap-1.5 text-dim"><Hexagon size={13} className="text-faint" /> Projects</span>
        <ChevronRight size={12} className="text-faint" />
        <span className="font-medium text-ink">New project</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="focus-ring -mr-1.5 ml-auto flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5">
        <Dropdown
          width={300}
          trigger={(p) => (
            <button
              ref={p.ref}
              type="button"
              onClick={p.onClick}
              aria-label="Choose icon and color"
              title="Choose icon and color"
              className={`focus-ring mb-3 mt-1 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-raised transition-colors hover:bg-wash ${p.open ? "bg-wash" : ""}`}
            >
              <ProjectIcon icon={icon} color={color} size={20} />
            </button>
          )}
        >
          {(close) => (
            <IconColorPicker
              icon={icon}
              color={color}
              onChange={(patch) => {
                if (patch.color) setColor(patch.color);
                if (patch.icon !== undefined) { setIcon(patch.icon); close(); }
              }}
            />
          )}
        </Dropdown>

        <input
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) { e.preventDefault(); summaryRef.current?.focus(); }
          }}
          placeholder="Project name"
          aria-label="Project name"
          aria-invalid={touched && !valid}
          className="w-full bg-transparent text-[20px] font-semibold leading-tight text-ink outline-none placeholder:text-faint"
        />
        {touched && !valid && <p className="mt-1 text-xxs text-danger">A project needs a name.</p>}
        <input
          ref={summaryRef}
          value={summary}
          maxLength={255}
          onChange={(e) => setSummary(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault(); }}
          placeholder="Add a short summary…"
          aria-label="Summary"
          className="mt-2 w-full bg-transparent text-[16px] text-dim outline-none placeholder:text-faint sm:text-[14px]"
        />

        <div className="mt-4">
          <ProjectPropertyChips value={fields} onChange={onPatch} />
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <Editor
            value=""
            onChange={setDescription}
            onSubmit={() => submitRef.current()}
            placeholder="Write a description, a project brief, or collect ideas…"
            minHeight={120}
          />
          {descriptionTooLong && <DocTooLongNote className="mt-2" />}
        </div>
      </div>

      {/* footer */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
        <span className="mr-auto hidden text-xxs text-faint sm:inline">
          <kbd>{modKey()}</kbd> <kbd>↵</kbd> to create
        </span>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit} loading={busy} disabled={!valid}>
          Create project
        </Button>
      </div>
    </div>
  );
}
