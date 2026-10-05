"use client";
/* ─── Locus · inline issue title (auto-growing; Enter / blur saves, Escape reverts) ─── */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { updateIssue } from "@/lib/sync/actions";
import type { Issue } from "@/lib/types";

const MAX_TITLE = 512;

export function IssueTitle({ issue, size = "page" }: { issue: Issue; size?: "page" | "peek" }) {
  const [draft, setDraft] = useState(issue.title);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const skipCommit = useRef(false);

  // follow remote / optimistic changes while not editing
  useEffect(() => {
    if (!editing) setDraft(issue.title);
  }, [issue.title, editing]);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [draft, size]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) { w = el.clientWidth; fit(); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const commit = () => {
    const next = draft.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
    if (!next) { setDraft(issue.title); return; }
    if (next !== draft) setDraft(next);
    if (next !== issue.title) void updateIssue(issue.id, { title: next });
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      maxLength={MAX_TITLE}
      aria-label="Issue title"
      placeholder="Issue title"
      enterKeyHint="done"
      spellCheck
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          skipCommit.current = true;
          setDraft(issue.title);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setEditing(false);
        if (skipCommit.current) { skipCommit.current = false; return; }
        commit();
      }}
      className={`block w-full resize-none overflow-hidden rounded-md bg-transparent font-semibold tracking-[-0.012em] text-ink outline-none placeholder:text-faint ${
        size === "page" ? "text-[20px] leading-[1.3] sm:text-[22px]" : "text-[18px] leading-[1.3]"
      }`}
    />
  );
}
