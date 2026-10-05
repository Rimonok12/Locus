"use client";
/* ─── Locus · issue relations (blocked by / blocking / related / duplicates) ─── */

import { useMemo, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { ArrowLeftRight, ChevronLeft, Copy, Link2, OctagonAlert, OctagonX, X } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { issueKey } from "@/lib/model";
import { linkProps } from "@/lib/router";
import { addRelation, removeRelation } from "@/lib/sync/actions";
import { StateGlyph } from "@/components/pickers";
import { SelectMenu } from "@/components/primitives/SelectMenu";
import { Dropdown } from "@/components/primitives/overlay";
import type { Issue, IssueRelation, RelationType, Team } from "@/lib/types";

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

const MAX_RESULTS = 50;

/**
 * Candidates for `q`, ranked over the whole pool (not a pre-cut slice), best first:
 * exact key ("eng-12" / "eng 12") → number or key prefix → title prefix → title words → key parts only.
 * Ties go to the most recently updated. An empty query lists the most recently updated issues.
 */
function rankCandidates(pool: Issue[], teams: Record<string, Team>, q: string): Issue[] {
  const query = q.trim().toLowerCase();
  if (!query) return [...pool].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, MAX_RESULTS);
  const spacedKey = query.replace(/^([a-z][a-z0-9]*)\s+(\d+)$/, "$1-$2");
  const num = /^\d+$/.test(query) ? Number(query) : null;
  const keyish = query.includes("-");
  const tokens = query.split(/\s+/).filter(Boolean);
  const scored: { i: Issue; r: number }[] = [];
  for (const i of pool) {
    const teamKey = (teams[i.team_id]?.key ?? "").toLowerCase();
    const key = `${teamKey}-${i.number}`;
    const title = i.title.toLowerCase();
    let r = -1;
    if (key === query || key === spacedKey) r = 0;
    else if ((num !== null && i.number === num) || (keyish && key.startsWith(query))) r = 1;
    else if (title.startsWith(query)) r = 2;
    else {
      let viaTitle = false;
      const ok = tokens.every((t) => {
        if (title.includes(t)) { viaTitle = true; return true; }
        // "eng 12 login" → a team key and a bare number are identifier parts
        return t === teamKey || t === key || (/^\d+$/.test(t) && i.number === Number(t));
      });
      if (ok) r = viaTitle ? 3 : 4;
    }
    if (r >= 0) scored.push({ i, r });
  }
  scored.sort((a, b) => a.r - b.r || b.i.updated_at.localeCompare(a.i.updated_at));
  return scored.slice(0, MAX_RESULTS).map((x) => x.i);
}

function AddRelationMenu({ issue, close }: { issue: Issue; close: () => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [q, setQ] = useState("");
  const groups = useRelationGroups(issue.id);
  const issues = useSync((s) => s.issues);
  const teams = useSync((s) => s.teams);

  // every issue this one can still be linked to as `kind`
  const pool = useMemo(() => {
    if (!kind) return [];
    const taken = new Set(groups[kind].map((l) => l.other.id));
    // the opposite direction of a block would create a cycle of two
    if (kind === "blocked_by") groups.blocking.forEach((l) => taken.add(l.other.id));
    if (kind === "blocking") groups.blocked_by.forEach((l) => taken.add(l.other.id));
    if (kind === "duplicate_of") groups.duplicated_by.forEach((l) => taken.add(l.other.id));
    return Object.values(issues).filter((i) => i.id !== issue.id && !i.archived_at && !taken.has(i.id));
  }, [kind, groups, issues, issue.id]);

  const results = useMemo(() => rankCandidates(pool, teams, q), [pool, teams, q]);

  if (!kind) {
    return (
      <SelectMenu
        items={KINDS.filter((k) => k.add).map((k, i) => ({ id: k.kind, label: k.add, icon: k.icon, hint: i + 1 }))}
        placeholder="Add relation…"
        onSelect={(id) => setKind(id as Kind)}
      />
    );
  }

  const back = () => { setKind(null); setQ(""); };
  const meta = KINDS.find((k) => k.kind === kind)!;
  return (
    <div>
      <div className="flex h-9 items-center gap-1 border-b border-line px-1 text-xxs font-medium text-dim">
        <button aria-label="Back to relation types" title="Back" onClick={back} className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink sm:h-7 sm:w-7">
          <ChevronLeft size={14} />
        </button>
        {meta.icon}
        <span>{meta.label}</span>
      </div>
      {/* cmdk only orders what it is given: rank the whole store here and render the top matches */}
      <Command shouldFilter={false} loop label={`${meta.label} issue`} className="flex flex-col">
        <div className="border-b border-line px-3">
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            onKeyDown={(e) => {
              // Backspace on an empty search steps back to the relation types
              if (e.key === "Backspace" && !q && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); back(); }
            }}
            placeholder="Search issues…"
            className="h-10 w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-faint sm:h-9 sm:text-[13px]"
          />
        </div>
        <Command.List className="overflow-y-auto p-1" style={{ maxHeight: 320 }}>
          <Command.Empty>No matching issues</Command.Empty>
          {results.map((i) => {
            const key = issueKey(i, teams);
            return (
              <Command.Item
                key={i.id}
                value={i.id}
                onSelect={() => {
                  const r = relationFor(kind, issue.id, i.id);
                  if (r) void addRelation(r.from, r.to, r.type);
                  close();
                }}
                className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] text-ink sm:h-8"
              >
                <span className="flex w-4 shrink-0 items-center justify-center"><StateGlyph stateId={i.state_id} /></span>
                <span className="w-[62px] shrink-0 truncate text-[12px] tabular-nums text-faint">{key}</span>
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
              </Command.Item>
            );
          })}
        </Command.List>
      </Command>
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
