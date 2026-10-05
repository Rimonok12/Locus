"use client";
/* ─── Locus · rich text editor ───────────────────────────────────────────────
   CONTRACT (other modules depend on these exports — keep signatures stable):
     default Editor(props: EditorProps)   editable rich text, value is HTML
     RichText({ html, compact })          read-only render of stored HTML
     isEmptyHtml(html)                    true for "", "<p></p>", whitespace
   Tiptap v3: StarterKit (H1–H3, lists, code, quotes, autolinks), nested task
   lists, images (paste / drop → Supabase Storage), @mentions of workspace
   members, a selection toolbar, ⌘/Ctrl+Enter submit, Escape blurs.
   ──────────────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, Extension, useEditor, type Editor as TiptapEditor, type EditorOptions } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import { uploadAttachment } from "@/lib/sync/actions";
import { toast } from "@/lib/ui";
import { Spinner } from "@/components/primitives/controls";
import { coreExtensions, editorInput, sanitizeHtml } from "./extensions";
import { mentionSuggestion } from "./MentionList";
import { BubbleToolbar } from "./BubbleToolbar";

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

/** Read-only render of stored HTML. The HTML is re-parsed through the editor schema first (XSS-safe). */
export function RichText({ html, compact }: { html: string; compact?: boolean }) {
  const safe = useMemo(() => sanitizeHtml(html), [html]);
  return (
    <div
      className={`prose-locus ${compact ? "compact" : ""} min-w-0 [&_input]:pointer-events-none`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const imageFiles = (list: FileList | null | undefined): File[] =>
  Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));

export default function Editor({
  value, onChange, onBlur, onSubmit, placeholder = "", editable = true, autoFocus = false, compact = false,
  mentions = true, minHeight = 24, className = "",
}: EditorProps) {
  // Latest callbacks / flags, read by long-lived editor closures (no stale props).
  const live = useRef({ onChange, onBlur, onSubmit, placeholder, mentions });
  live.current = { onChange, onBlur, onSubmit, placeholder, mentions };

  const editorRef = useRef<TiptapEditor | null>(null);
  const [uploading, setUploading] = useState(0);
  const [initialContent] = useState(() => editorInput(value || ""));

  const extensions = useMemo(() => [
    ...coreExtensions(mentionSuggestion(() => live.current.mentions)),
    Placeholder.configure({
      placeholder: ({ editor }) => (editor.isEmpty ? live.current.placeholder : ""),
    }),
    Extension.create({
      name: "locusKeys",
      addKeyboardShortcuts() {
        return {
          "Mod-Enter": () => {
            const submit = live.current.onSubmit;
            if (!submit) return false;
            submit();
            return true;
          },
          // Blur but leave the event unhandled, so surrounding UI (modals, pages) still sees a plain Escape.
          Escape: () => {
            this.editor.commands.blur();
            return false;
          },
        };
      },
    }),
  ], []);

  const editorProps = useMemo((): EditorOptions["editorProps"] => {
    const insertImages = async (files: File[], at: number | null) => {
      let pos = at;
      for (const file of files) {
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error(`${file.name || "Image"} is larger than 20 MB`);
          continue;
        }
        setUploading((n) => n + 1);
        try {
          const url = await uploadAttachment(file);
          const ed = editorRef.current;
          if (url && ed && !ed.isDestroyed) {
            const node = { type: "image", attrs: { src: url, alt: file.name || null } };
            // uploads finish later: only pull focus back if the user is still in this editor
            const chain = ed.isFocused ? ed.chain().focus() : ed.chain();
            if (pos != null) chain.setTextSelection(Math.min(pos, ed.state.doc.content.size));
            chain.insertContent(node).run();
            pos = null; // following files land after the previous one
          }
        } catch (e) {
          console.error("[locus] image upload", e);
          toast.error("Couldn't upload image — please try again.");
        } finally {
          setUploading((n) => n - 1);
        }
      }
    };

    return {
      // a function so the accessible name follows the latest placeholder without rebuilding the view
      attributes: () => ({
        class: `prose-locus ${compact ? "compact" : ""} min-w-0 outline-none`,
        style: `min-height:${minHeight}px`,
        spellcheck: "true",
        "aria-multiline": "true",
        "aria-label": live.current.placeholder.replace(/…$/, "") || "Text editor",
      }),
      transformPastedHTML: (html) => editorInput(html),
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        // Office apps put a rendered image next to the text — only upload pure image pastes.
        if (!files.length || event.clipboardData?.getData("text/plain")) return false;
        event.preventDefault();
        void insertImages(files, null);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = imageFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void insertImages(files, hit ? hit.pos : null);
        return true;
      },
    };
  }, [compact, minHeight]);

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    autofocus: autoFocus ? "end" : false,
    content: initialContent,
    extensions,
    editorProps,
    onUpdate: ({ editor: e }) => live.current.onChange?.(e.getHTML()),
    onBlur: ({ editor: e }) => live.current.onBlur?.(e.getHTML()),
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // editable can change after creation
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  // external value changes (realtime, another tab, reset after submit) — never while the user is typing
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return;
    if (isEmptyHtml(value) && editor.isEmpty) return;
    if (editor.getHTML() === value) return;
    editor.commands.setContent(editorInput(value || ""), { emitUpdate: false });
  }, [editor, value]);

  const cls = `prose-locus ${compact ? "compact" : ""}`;
  return (
    <div className={`relative min-w-0 ${className}`}>
      {editor ? (
        <>
          <EditorContent editor={editor} />
          {editable && <BubbleToolbar editor={editor} />}
        </>
      ) : (
        // first paint (the editor mounts client-side right after) — same typography, no layout jump
        <div className={cls} style={{ minHeight }}>
          {isEmptyHtml(value) ? <p className="text-faint">{placeholder}</p> : <RichText html={value} compact={compact} />}
        </div>
      )}
      {uploading > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xxs text-faint">
          <Spinner size={12} /> Uploading {uploading > 1 ? `${uploading} images` : "image"}…
        </div>
      )}
    </div>
  );
}
