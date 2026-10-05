"use client";
/* ─── Locus · selection toolbar (bold / italic / strike / code / link / headings) ─── */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isNodeSelection, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Check, Code, Heading1, Heading2, Heading3, Italic, Link2, Strikethrough, Unlink } from "lucide-react";
import { modKey } from "@/lib/format";
import { EDITOR_UI_ATTR } from "./extensions";

function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^(https?:|mailto:|tel:)/i.test(v) || v.startsWith("/") || v.startsWith("#")) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  return `https://${v}`;
}

/** nearest scrolling ancestor — the menu must follow the page when it scrolls inside a container */
function scrollParentOf(el: HTMLElement | null): HTMLElement | Window {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") return n;
  }
  return window;
}

type ShouldShow = NonNullable<React.ComponentProps<typeof BubbleMenu>["shouldShow"]>;

const shouldShow: ShouldShow = ({ editor: e, element, view, state, from, to }) => {
  if (!e.isEditable) return false;
  if (!(view.hasFocus() || element.contains(document.activeElement))) return false;
  if (state.selection.empty || isNodeSelection(state.selection)) return false;
  if (e.isActive("codeBlock")) return false;
  return state.doc.textBetween(from, to, " ").trim().length > 0;
};

function Tool({ active, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors sm:h-7 sm:w-7 ${active ? "bg-accent-soft text-accent" : "text-dim hover:bg-wash hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/* Memoized and fed stable props: every prop change makes BubbleMenu dispatch an options transaction.
   `onLeave` runs when focus leaves the link field for somewhere outside the editor (the editor's own
   blur skipped it because focus was moving into this toolbar). */
export const BubbleToolbar = memo(function BubbleToolbar({ editor, onLeave }: { editor: Editor; onLeave?: (editor: Editor) => void }) {
  const [linkMode, setLinkMode] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<HTMLElement | Window | null>(null);
  const [href, setHref] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
    }),
  });

  useEffect(() => {
    if (linkMode) requestAnimationFrame(() => inputRef.current?.focus());
  }, [linkMode]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      try { setScrollTarget(scrollParentOf(editor.view.dom)); } catch { /* view not mounted */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [editor]);

  const onHide = useCallback(() => setLinkMode(false), []);
  const options = useMemo(() => ({
    strategy: "fixed" as const,
    placement: "top" as const,
    offset: 8,
    flip: true,
    shift: { padding: 8 },
    onHide,
    ...(scrollTarget ? { scrollTarget } : {}),
  }), [onHide, scrollTarget]);

  const applyLink = () => {
    const url = normalizeUrl(href);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (url) chain.setLink({ href: url }).run();
    else chain.unsetLink().run();
    setLinkMode(false);
  };

  const mod = modKey();

  return (
    <BubbleMenu
      editor={editor}
      className="z-[100]"
      options={options}
      shouldShow={shouldShow}
    >
      <div {...{ [EDITOR_UI_ATTR]: "" }} className="flex items-center gap-0.5 rounded-lg bg-surface p-1 shadow-pop">
        {linkMode ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => { e.preventDefault(); applyLink(); }}
          >
            <input
              ref={inputRef}
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onBlur={(e) => {
                const to = e.relatedTarget;
                if (editor.isDestroyed || (to instanceof Node && (editor.view.dom.contains(to) || e.currentTarget.form?.contains(to)))) return;
                onLeave?.(editor);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setLinkMode(false);
                  editor.commands.focus();
                }
              }}
              placeholder="Paste or type a link…"
              className="h-7 w-[min(240px,60vw)] rounded-md bg-transparent px-2 text-[12.5px] text-ink outline-none placeholder:text-faint"
            />
            <Tool label="Apply link" onClick={applyLink}><Check size={14} /></Tool>
            {st.link && (
              <Tool label="Remove link" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkMode(false); }}>
                <Unlink size={14} />
              </Tool>
            )}
          </form>
        ) : (
          <>
            <Tool label={`Bold (${mod}+B)`} active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} strokeWidth={2.4} /></Tool>
            <Tool label={`Italic (${mod}+I)`} active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></Tool>
            <Tool label={`Strikethrough (${mod}+Shift+S)`} active={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={14} /></Tool>
            <Tool label={`Code (${mod}+E)`} active={st.code} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={14} /></Tool>
            <Tool
              label="Link"
              active={st.link}
              onClick={() => {
                setHref(String(editor.getAttributes("link").href ?? ""));
                setLinkMode(true);
              }}
            >
              <Link2 size={14} />
            </Tool>
            <span className="mx-0.5 h-4 w-px bg-line" />
            <Tool label="Heading 1" active={st.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={15} /></Tool>
            <Tool label="Heading 2" active={st.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></Tool>
            <Tool label="Heading 3" active={st.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={15} /></Tool>
          </>
        )}
      </div>
    </BubbleMenu>
  );
});
