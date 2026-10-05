"use client";
/* ─── Locus · copy-to-clipboard button for code snippets (setup page) ─── */

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={state === "failed" ? "Clipboard unavailable" : label}
      className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-faint transition-colors hover:bg-wash hover:text-ink"
    >
      {state === "copied" ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Select & copy" : "Copy"}</span>
    </button>
  );
}
