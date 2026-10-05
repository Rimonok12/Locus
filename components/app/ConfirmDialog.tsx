"use client";
/* ─── Locus · confirm dialog (ui.askConfirm) ─── */

import { useState } from "react";
import { ui, useUI } from "@/lib/ui";
import { Modal } from "@/components/primitives/overlay";
import { Button } from "@/components/primitives/controls";

export default function ConfirmDialog() {
  const req = useUI((s) => s.confirm);
  const [busy, setBusy] = useState(false);
  if (!req) return null;
  const cancel = () => { req.onCancel?.(); ui.closeConfirm(); };
  const run = async () => {
    setBusy(true);
    try { await req.onConfirm(); } finally { setBusy(false); ui.closeConfirm(); }
  };
  return (
    <Modal open onClose={cancel} width={420} label={req.title}>
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">{req.title}</h2>
        {req.body && <p className="mt-2 text-[13px] leading-relaxed text-dim">{req.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
          <Button type="submit" autoFocus variant={req.destructive ? "danger" : "primary"} loading={busy}>
            {req.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
