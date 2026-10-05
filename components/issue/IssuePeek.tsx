"use client";
/* ─── Locus · issue peek panel ───────────────────────────────────────────────
   default IssuePeek() — mounted once by Shell. Opens when ui.peek(id) sets
   peekIssueId: a right-side sheet (full screen on phones) with properties,
   editable title + description and the latest activity. Escape closes it
   (unless typing / another overlay is open). Global property shortcuts target
   the peeked issue through ui.targetIds().
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from "react";
import { Archive, Maximize2, X } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { ui, useUI } from "@/lib/ui";
import { issueKey } from "@/lib/model";
import { navigate } from "@/lib/router";
import { archiveIssues } from "@/lib/sync/actions";
import { StateGlyph } from "@/components/pickers";
import { TeamIcon } from "@/components/primitives/icons";
import { Button, IconButton } from "@/components/primitives/controls";
import type { Issue } from "@/lib/types";
import { isBareEscape, useIssueDetails } from "./shared";
import { IssueTitle } from "./IssueTitle";
import { IssueDescription } from "./IssueDescription";
import { PropertyChips } from "./IssueProperties";
import { RecentActivity } from "./Activity";
import { IssueMoreMenu } from "./IssueActions";

export default function IssuePeek() {
  const id = useUI((s) => s.peekIssueId);
  const issue = useSync((s) => (id ? s.issues[id] : undefined));
  const ready = useSync((s) => s.status === "ready");

  // the issue disappeared (deleted here or elsewhere) → close
  useEffect(() => {
    if (id && ready && !issue) ui.peek(null);
  }, [id, issue, ready]);

  if (!id || !issue) return null;
  return <PeekPanel issue={issue} />;
}

function PeekPanel({ issue }: { issue: Issue }) {
  const teams = useSync((s) => s.teams);
  const team = teams[issue.team_id];
  const key = issueKey(issue, teams);
  const scrollRef = useRef<HTMLDivElement>(null);

  useIssueDetails(issue.id);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [issue.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isBareEscape(e)) return;
      e.preventDefault();
      ui.peek(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const openFull = () => {
    navigate({ kind: "issue", identifier: key });
    ui.peek(null);
  };

  return (
    <div
      role="dialog"
      aria-label={`${key} ${issue.title}`}
      className="anim-slide fixed bottom-0 right-0 top-0 z-[60] flex w-[min(600px,100vw)] flex-col border-l border-line bg-surface shadow-panel"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2 sm:pl-5">
        <TeamIcon team={team} size={16} />
        <StateGlyph stateId={issue.state_id} />
        <button
          onClick={openFull}
          className="focus-ring min-w-0 truncate rounded px-1 text-[13px] font-medium tabular-nums text-dim hover:bg-wash hover:text-ink"
          title="Open full page"
        >
          {key}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="md" icon={<Maximize2 size={14} />} onClick={openFull} className="hidden sm:inline-flex">
            Open
          </Button>
          <IconButton label="Open full page" size={32} onClick={openFull} className="sm:hidden">
            <Maximize2 size={15} />
          </IconButton>
          <IssueMoreMenu issue={issue} issueKey={key} context="peek" />
          <IconButton label="Close (Esc)" size={32} onClick={() => ui.peek(null)}>
            <X size={16} />
          </IconButton>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 pb-12 pt-4 sm:px-6 sm:pt-5">
          {issue.archived_at && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-1.5 text-[12.5px] text-dim">
              <Archive size={14} className="shrink-0 text-faint" />
              <span className="flex-1">This issue is archived.</span>
              <Button size="md" variant="ghost" onClick={() => void archiveIssues([issue.id], false)}>Unarchive</Button>
            </div>
          )}
          <PropertyChips issue={issue} className="mb-4" />
          <IssueTitle key={issue.id} issue={issue} size="peek" />
          <div className="mt-2">
            <IssueDescription issue={issue} minHeight={56} />
          </div>
          <RecentActivity issue={issue} limit={5} onOpenAll={openFull} />
        </div>
      </div>
    </div>
  );
}
