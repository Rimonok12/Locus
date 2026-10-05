"use client";
/* ─── Locus · comment / reply composer (⌘/Ctrl+Enter sends, optimistic clear, draft kept per issue) ─── */

import { useRef, useState } from "react";
import { modKey } from "@/lib/format";
import { toast } from "@/lib/ui";
import { Button } from "@/components/primitives/controls";
import Editor, { isEmptyHtml } from "@/components/editor/Editor";

const MAX_BODY = 50000;

function readDraft(key: string | undefined): string {
  if (!key) return "";
  try { return window.localStorage.getItem(`locus:draft:${key}`) ?? ""; } catch { return ""; }
}
function writeDraft(key: string | undefined, html: string) {
  if (!key) return;
  try {
    if (isEmptyHtml(html)) window.localStorage.removeItem(`locus:draft:${key}`);
    else window.localStorage.setItem(`locus:draft:${key}`, html);
  } catch { /* storage unavailable */ }
}

export function Composer({
  send, placeholder, submitLabel = "Comment", draftKey, focusTick = 0, onCancel, variant = "card", minHeight = 44,
}: {
  /** resolves truthy when the comment was saved */
  send: (body: string) => Promise<unknown>;
  placeholder: string;
  submitLabel?: string;
  /** persist an unsent draft in this browser under this key */
  draftKey?: string;
  /** bump to (re)focus the composer */
  focusTick?: number;
  /** shows a Cancel button while empty */
  onCancel?: () => void;
  variant?: "card" | "inline";
  minHeight?: number;
}) {
  const [initial] = useState(() => readDraft(draftKey));
  const htmlRef = useRef(initial);
  const [html, setHtml] = useState(initial);
  const [version, setVersion] = useState(0);
  const [keepFocus, setKeepFocus] = useState(false);

  const store = (v: string) => {
    htmlRef.current = v;
    setHtml(v);
    writeDraft(draftKey, v);
  };

  const submit = async () => {
    const body = htmlRef.current;
    if (isEmptyHtml(body)) return;
    if (body.length > MAX_BODY) {
      toast.error("Comments are limited to 50,000 characters.");
      return;
    }
    // optimistic: clear now (remount the editor so it empties even while focused)
    store("");
    setKeepFocus(true);
    setVersion((v) => v + 1);
    const ok = await send(body);
    if (!ok && isEmptyHtml(htmlRef.current)) {
      store(body); // give the text back so nothing is lost
      setVersion((v) => v + 1);
    }
  };

  const empty = isEmptyHtml(html);
  const card = variant === "card";
  return (
    <div
      className={card
        ? "rounded-lg border border-line bg-surface px-3 pb-2 pt-2.5 shadow-card transition-colors focus-within:border-line-strong sm:px-4"
        : "px-3 pb-2.5 pt-2 sm:px-4"}
    >
      <Editor
        key={`${version}:${focusTick}`}
        value={html}
        onChange={store}
        onSubmit={() => void submit()}
        placeholder={placeholder}
        compact
        minHeight={minHeight}
        autoFocus={keepFocus || focusTick > 0}
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <span className={`mr-auto hidden text-xxs text-faint transition-opacity sm:inline ${empty ? "opacity-0" : "opacity-100"}`}>
          <kbd>{modKey()}</kbd> <kbd>↵</kbd> to send
        </span>
        {onCancel && empty && <Button variant="ghost" size="md" onClick={onCancel}>Cancel</Button>}
        <Button variant={empty ? "secondary" : "primary"} size="md" disabled={empty} onClick={() => void submit()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
