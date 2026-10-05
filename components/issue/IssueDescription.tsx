"use client";
/* ─── Locus · issue description (debounced autosave + save on blur) ─── */

import { useCallback, useEffect, useRef } from "react";
import { useSync } from "@/lib/sync/store";
import { updateIssue } from "@/lib/sync/actions";
import Editor, { isEmptyHtml } from "@/components/editor/Editor";
import type { Issue } from "@/lib/types";

const SAVE_DELAY = 700;

export function IssueDescription({ issue, minHeight = 72 }: { issue: Issue; minHeight?: number }) {
  const issueId = issue.id;
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const html = pending.current;
    pending.current = null;
    if (html == null) return;
    const next = isEmptyHtml(html) ? "" : html;
    const current = useSync.getState().issues[issueId];
    if (current && next !== current.description) void updateIssue(issueId, { description: next });
  }, [issueId]);

  // never lose keystrokes: flush when the issue changes or the view unmounts
  useEffect(() => () => flush(), [flush]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  return (
    <Editor
      key={issueId}
      value={issue.description}
      placeholder="Add description…"
      minHeight={minHeight}
      onChange={(html) => {
        pending.current = html;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY);
      }}
      onBlur={() => {
        if (pending.current != null) flush();
      }}
    />
  );
}
