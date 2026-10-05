"use client";
/* ─── Locus · rich text editor ───────────────────────────────────────────────
   CONTRACT (other modules depend on these exports — keep signatures stable):
     default Editor(props: EditorProps)   editable rich text, value is HTML
     RichText({ html, compact })          read-only render of stored HTML
     isEmptyHtml(html)                    true for "", "<p></p>", whitespace
   STUB implementation (textarea) — replaced by the Tiptap implementation.
   ──────────────────────────────────────────────────────────────────────────── */

export interface EditorProps {
  /** HTML. Treated as the initial value; later external changes are applied only when the editor is not focused. */
  value: string;
  /** called on every change with the current HTML */
  onChange?: (html: string) => void;
  /** called when focus leaves the editor (good moment to persist) */
  onBlur?: (html: string) => void;
  /** Cmd/Ctrl+Enter */
  onSubmit?: () => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  /** 13px comment style instead of 14px document style */
  compact?: boolean;
  /** enable @mentions of workspace members (default true) */
  mentions?: boolean;
  minHeight?: number;
  className?: string;
}

export function isEmptyHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  if (/<img|data-type="mention"/.test(html)) return false;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

export function RichText({ html, compact }: { html: string; compact?: boolean }) {
  return <div className={`prose-locus ${compact ? "compact" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function Editor({ value, onChange, onBlur, onSubmit, placeholder, editable = true, autoFocus, compact, minHeight = 24, className = "" }: EditorProps) {
  return (
    <textarea
      defaultValue={value.replace(/<[^>]*>/g, "")}
      readOnly={!editable}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange?.(`<p>${e.target.value}</p>`)}
      onBlur={(e) => onBlur?.(`<p>${e.target.value}</p>`)}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit?.(); }}
      className={`prose-locus ${compact ? "compact" : ""} w-full resize-none bg-transparent outline-none ${className}`}
      style={{ minHeight }}
    />
  );
}
