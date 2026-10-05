"use client";
/* ─── Locus · issue relations (blocked by / blocking / related / duplicates) ─── */

import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeftRight, ChevronLeft, Copy, Link2, OctagonAlert, OctagonX, X } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { issueKey } from "@/lib/model";
import { linkProps } from "@/lib/router";
import { addRelation, removeRelation } from "@/lib/sync/actions";
import { StateGlyph } from "@/components/pickers";
import { SelectMenu, type MenuItem } from "@/components/primitives/SelectMenu";
import { Dropdown } from "@/components/primitives/overlay";
import type { Issue, IssueRelation, RelationType } from "@/lib/types";

/** Relation kinds as seen from the current issue. */
type Kind = "blocked_by" | "blocking" | "related" | "duplicate_of" | "duplicated_by";

const KINDS: { kind: Kind; label: string; add: string; icon: ReactNode }[] = [
  { kind: "blocked_by", label: "Blocked by", add: "Blocked by…", icon: <OctagonX size={14} className="text-danger" /> },
  { kind: "blocking", label: "Blocking", add: "Blocking…", icon: <OctagonAlert size={14} className="text-warning" /> },
  { kind: "related", label: "Related", add: "Related to…", icon: <ArrowLeftRight size={14} className="text-dim" /> },
  { kind: "duplicate_of", label: "Duplicate of", add: "Duplicate of…", icon: <Copy size={13} className="text-dim" /> },
  { kind: "duplicated_by", label: "Duplicated by", add: "", icon: <Copy size={13} className="text-dim" /> },
];

interface Linked { rel: IssueRelation; other: Issue }

/** direction-aware grouping of every relation touching `issueId` */
function useRelationGroups(issueId: string) {
  const relations = useSync((s) => s.issue_relations);
  const issues = useSync((s) => s.issues);
  return useMemo(() => {
    const g: Record<Kind, Linked[]> = { blocked_by: [], blocking: [], related: [], duplicate_of: [], duplicated_by: [] };
    for (const rel of Object.values(relations)) {
      const outgoing = rel.issue_id === issueId;
      if (!outgoing && rel.related_issue_id !== issueId) continue;
      const other = issues[outgoing ? rel.related_issue_id : rel.issue_id];
      if (!other) continue;
      const kind: Kind = rel.type === "blocks" ? (outgoing ? "blocking" : "blocked_by")
        : rel.type === "duplicate" ? (outgoing ? "duplicate_of" : "duplicated_by")
          : "related";
      g[kind].push({ rel, other });
    }
    for (const k of Object.keys(g) as Kind[]) g[k].sort((a, b) => a.rel.created_at.localeCompare(b.rel.created_at));
    return g;
  }, [relations, issues, issueId]);
}

/** the row to insert for "this issue <kind> other" */
function relationFor(kind: Kind, self: string, other: string): { from: string; to: string; type: RelationType } | null {
  switch (kind) {
    case "blocked_by": return { from: other, to: self, type: "blocks" };
    case "blocking": return { from: self, to: other, type: "blocks" };
    case "related": return { from: self, to: other, type: "related" };
    case "duplicate_of": return { from: self, to: other, type: "duplicate" };
    default: return null;
  }
}

/* ─── add-relation popover: pick a type, then an issue ─── */

function AddRelationMenu({ issue, close }: { issue: Issue; close: () => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const groups = useRelationGroups(issue.id);
  const issues = useSync((s) => s.issues);
  const teams = useSync((s) => s.teams);
  const states = useSync((s) => s.workflow_states);

  const issueItems: MenuItem[] = useMemo(() => {
    if (!kind) return [];
    const taken = new Set(groups[kind].map((l) => l.other.id));
    // the opposite direction of a block would create a cycle of two
    if (kind === "blocked_by") groups.blocking.forEach((l) => taken.add(l.other.id));
    if (kind === "blocking") groups.blocked_by.forEach((l) => taken.add(l.other.id));
    if (kind === "duplicate_of") groups.duplicated_by.forEach((l) => taken.add(l.other.id));
    return Object.values(issues)
      .filter((i) => i.id !== issue.id && !i.archived_at && !taken.has(i.id))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 400)
      .map((i) => ({
        id: i.id,
        label: `${issueKey(i, teams)} ${i.title}`,
        icon: <StateGlyph stateId={i.state_id} />,
        keywords: [states[i.state_id]?.name ?? ""],
      }));
  }, [kind, groups, issues, teams, states, issue.id]);

  if (!kind) {
    return (
      <SelectMenu
        items={KINDS.filter((k) => k.add).map((k, i) => ({ id: k.kind, label: k.add, icon: k.icon, hint: i + 1 }))}
        placeholder="Add relation…"
        onSelect={(id) => setKind(id as Kind)}
      />
    );
  }

  const meta = KINDS.find((k) => k.kind === kind)!;
  return (
    <div>
      <div className="flex h-9 items-center gap-1 border-b border-line px-1 text-xxs font-medium text-dim">
        <button aria-label="Back to relation types" title="Back" onClick={() => setKind(null)} className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink sm:h-7 sm:w-7">
          <ChevronLeft size={14} />
        </button>
        {meta.icon}
        <span>{meta.label}</span>
      </div>
      <SelectMenu
        items={issueItems}
        placeholder="Search issues…"
        emptyText="No matching issues"
        digitShortcuts={false}
        onSelect={(otherId) => {
          const r = relationFor(kind, issue.id, otherId);
          if (r) void addRelation(r.from, r.to, r.type);
          close();
        }}
      />
    </div>
  );
}

export function AddRelationButton({ issue, children }: { issue: Issue; children: (p: { ref: (el: HTMLElement | null) => void; onClick: (e: React.MouseEvent) => void; open: boolean }) => ReactNode }) {
  return (
    <Dropdown width={340} trigger={(p) => children({ ref: p.ref, onClick: p.onClick, open: p.open })}>
      {(close) => <AddRelationMenu issue={issue} close={close} />}
    </Dropdown>
  );
}

/* ─── section ─── */

function RelationRow({ link }: { link: Linked }) {
  const teams = useSync((s) => s.teams);
  const key = issueKey(link.other, teams);
  return (
    <div className="group flex h-9 items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-wash">
      <StateGlyph stateId={link.other.state_id} />
      <a {...linkProps({ kind: "issue", identifier: key })} className="flex h-full min-w-0 flex-1 items-center gap-2 text-[13px]">
        <span className="w-[62px] shrink-0 truncate text-[12px] tabular-nums text-faint">{key}</span>
        <span className={`min-w-0 truncate ${link.other.archived_at ? "text-faint line-through" : "text-ink"}`}>{link.other.title}</span>
      </a>
      <button
        aria-label={`Remove relation to ${key}`}
        title="Remove relation"
        onClick={() => void removeRelation(link.rel.id)}
        className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-opacity hover:bg-raised hover:text-ink focus:opacity-100 group-hover:opacity-100 sm:h-7 sm:w-7 [@media(hover:hover)]:opacity-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Relations({ issue }: { issue: Issue }) {
  const groups = useRelationGroups(issue.id);
  const total = KINDS.reduce((n, k) => n + groups[k.kind].length, 0);
  if (!total) return null;
  return (
    <section className="mt-8">
      <div className="mb-1 flex h-8 items-center gap-2">
        <h2 className="text-[13px] font-medium text-ink">Relations</h2>
        <AddRelationButton issue={issue}>
          {(p) => (
            <button
              ref={p.ref}
              onClick={p.onClick}
              aria-label="Add relation"
              title="Add relation"
              className={`focus-ring ml-auto flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink ${p.open ? "bg-wash text-ink" : ""}`}
            >
              <Link2 size={15} />
            </button>
          )}
        </AddRelationButton>
      </div>
      <div className="space-y-3">
        {KINDS.filter((k) => groups[k.kind].length).map((k) => (
          <div key={k.kind}>
            <div className="mb-0.5 flex items-center gap-1.5 px-1.5 text-xxs font-medium text-faint">
              {k.icon}
              {k.label}
              <span className="tabular-nums">{groups[k.kind].length}</span>
            </div>
            <div className="space-y-px">
              {groups[k.kind].map((l) => <RelationRow key={l.rel.id} link={l} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
