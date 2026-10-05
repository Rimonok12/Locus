"use client";
/* ─── Locus · keyboard property picker (S, P, A, L, ⇧P …) ─── */

import { useEffect } from "react";
import { ui, useUI, type PickerKind } from "@/lib/ui";
import { useSync } from "@/lib/sync/store";
import { issueKey } from "@/lib/model";
import { Modal } from "@/components/primitives/overlay";
import { Button } from "@/components/primitives/controls";
import { IssuePicker, PICKER_TITLE, StateGlyph } from "@/components/pickers";
import type { Issue } from "@/lib/types";

export default function PickerDialog() {
  const picker = useUI((s) => s.picker);
  return (
    <Modal open={Boolean(picker)} onClose={ui.closePicker} position="top" width={440} label={picker ? PICKER_TITLE[picker.kind] : undefined}>
      {picker && <PickerBody kind={picker.kind} issueIds={picker.issueIds} />}
    </Modal>
  );
}

function PickerBody({ kind, issueIds }: { kind: PickerKind; issueIds: string[] }) {
  const issues = useSync((s) => s.issues);
  const teams = useSync((s) => s.teams);
  const list = issueIds.map((id) => issues[id]).filter(Boolean) as Issue[];
  const empty = list.length === 0;

  // every target vanished (deleted elsewhere) — nothing left to edit
  useEffect(() => {
    if (empty) ui.closePicker();
  }, [empty]);
  if (empty) return null;

  const single = list.length === 1 ? list[0] : undefined;
  const multi = kind === "labels";

  return (
    <div className="flex flex-col">
      <div className="flex min-w-0 items-center gap-2 px-3 pb-1 pt-3">
        <span className="shrink-0 text-xxs font-medium text-faint">{PICKER_TITLE[kind]}</span>
        <span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md bg-wash px-2 text-[12px] text-dim">
          {single ? (
            <>
              <StateGlyph stateId={single.state_id} size={12} />
              <span className="shrink-0 font-medium text-ink">{issueKey(single, teams)}</span>
              <span className="truncate">{single.title}</span>
            </>
          ) : (
            <span className="font-medium text-ink">{list.length} issues</span>
          )}
        </span>
      </div>
      <div className={kind === "due" ? "flex justify-center" : ""}>
        <IssuePicker kind={kind} issueIds={list.map((i) => i.id)} onDone={ui.closePicker} />
      </div>
      {multi && (
        <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-xxs text-faint">
          <span className="hidden sm:inline">↵ toggles · Esc when done</span>
          <Button size="xs" variant="ghost" className="ml-auto h-8 sm:h-6" onClick={ui.closePicker}>Done</Button>
        </div>
      )}
    </div>
  );
}
