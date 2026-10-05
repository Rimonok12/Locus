"use client";
/* ─── Locus · saved views list (+ "New view", also via ?create=1) ─── */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, Plus } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { setQueryParam, useQueryParam } from "@/lib/router";
import { ViewHeader } from "@/components/app/Header";
import { Button, EmptyState } from "@/components/primitives/controls";
import CreateViewModal from "@/components/saved-views/CreateViewModal";
import ViewRow from "@/components/saved-views/ViewRow";

export default function ViewsView() {
  const views = useSync((s) => s.views);
  const me = useSync((s) => s.userId);
  const createParam = useQueryParam("create");
  const [open, setOpen] = useState(createParam === "1");

  useEffect(() => {
    if (createParam === "1") setOpen(true);
  }, [createParam]);

  const close = useCallback(() => {
    setOpen(false);
    if (new URL(window.location.href).searchParams.has("create")) setQueryParam("create", null);
  }, []);

  const sections = useMemo(() => {
    const all = Object.values(views).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const mine = all.filter((v) => v.owner_id === me);
    // someone else's personal view is never listed (RLS hides them too; this guards cached rows)
    const others = all.filter((v) => v.owner_id !== me && v.shared);
    return [
      { id: "mine", label: "Created by you", views: mine },
      { id: "others", label: "Shared with the workspace", views: others },
    ].filter((s) => s.views.length);
  }, [views, me]);

  return (
    <>
      <ViewHeader
        title="Views"
        icon={<Layers size={15} className="text-dim" />}
        actions={
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)} className="max-md:h-8">
            New view
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sections.length ? (
          sections.map((s) => (
            <section key={s.id}>
              <h2 className="sticky top-0 z-[2] flex h-9 items-center gap-2 border-b border-line bg-raised px-4 text-[12.5px] font-medium text-ink md:px-6">
                {s.label}
                <span className="tabular-nums text-faint">{s.views.length}</span>
                <span className="ml-auto hidden items-center gap-3 text-xxs font-normal text-faint lg:flex">
                  <span className="w-[140px]">Team</span>
                  <span className="w-6" />
                  <span className="w-[60px]" />
                </span>
              </h2>
              {s.views.map((v) => <ViewRow key={v.id} view={v} />)}
            </section>
          ))
        ) : (
          <EmptyState
            icon={<Layers size={28} strokeWidth={1.5} />}
            title="No views yet"
            body="Views save a set of filters and display options so you can get back to any slice of issues in one click — share them with the workspace or keep them personal."
            action={<Button variant="primary" size="md" icon={<Plus size={14} />} onClick={() => setOpen(true)}>New view</Button>}
          />
        )}
      </div>

      <CreateViewModal open={open} onClose={close} />
    </>
  );
}
