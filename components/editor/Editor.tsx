"use client";
/* ─── Locus · rich text editor ───────────────────────────────────────────────
   CONTRACT (other modules depend on these exports — keep signatures stable):
     default Editor(props: EditorProps)   editable rich text, value is HTML.
                                          Also takes a ref → EditorApi.
     EditorApi { focus(at?), blur(), editor }   handle from ref / onReady
     RichText({ html, compact })          read-only render of stored HTML
     isEmptyHtml(html)                    true for "", "<p></p>", whitespace
   Tiptap v3: StarterKit (H1–H3, lists, code, quotes, autolinks), nested task
   lists, raster images (paste / drop → Supabase Storage; other files are refused
   with a toast), @mentions of workspace
   members, a selection toolbar, ⌘/Ctrl+Enter submit, Escape blurs.
   External `value` changes never land under the caret: while focused they are
   parked and applied on blur, unless the user edited the text meanwhile.
   ──────────────────────────────────────────────────────────────────────────── */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, Extension, useEditor, type Editor as TiptapEditor, type EditorOptions } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import { UPLOAD_IMAGE_TYPES, uploadAttachment } from "@/lib/sync/actions";
import { toast } from "@/lib/ui";
import { Spinner } from "@/components/primitives/controls";
import { EDITOR_UI_ATTR, coreExtensions, editorInput, sanitizeHtml } from "./extensions";
import { mentionSuggestion } from "./MentionList";
import { BubbleToolbar } from "./BubbleToolbar";

type FocusAt = "start" | "end" | "all";

/** Imperative handle (via `ref` or `onReady`): focus the editor without DOM queries. */
export interface EditorApi {
  /** Focus the editor, caret at the end by default. A call made before the editor has mounted is applied once it exists. */
  focus: (at?: FocusAt) => void;
  blur: () => void;
  /** The underlying Tiptap editor — null until it has mounted and after it is destroyed. */
  readonly editor: TiptapEditor | null;
}

export interface EditorProps {
  /**
   * HTML. Treated as the initial value; later external changes are applied right away while the
   * editor is not focused, otherwise on blur — and dropped if the user edited the text meanwhile.
   */
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
  /** called once the editor instance exists (the same api the ref exposes) */
  onReady?: (api: EditorApi) => void;
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

const TYPE_NAMES: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPEG", "image/gif": "GIF", "image/webp": "WebP", "image/avif": "AVIF" };
/** "PNG, JPEG, GIF, WebP or AVIF" — follows UPLOAD_IMAGE_TYPES */
const ACCEPTED_NAMES = (() => {
  const n = UPLOAD_IMAGE_TYPES.map((t) => TYPE_NAMES[t] ?? t.replace(/^image\//, "").toUpperCase());
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} or ${n[n.length - 1]}` : n.join("");
})();

/** Pasted / dropped files: the raster images storage accepts, and everything else (SVG, HEIC, PDF…). */
function splitFiles(list: FileList | null | undefined): { images: File[]; refused: File[] } {
  const images: File[] = [];
  const refused: File[] = [];
  for (const f of Array.from(list ?? [])) (UPLOAD_IMAGE_TYPES.includes(f.type) ? images : refused).push(f);
  return { images, refused };
}

function toastRefused(files: File[]) {
  if (!files.length) return;
  const name = files.length === 1 ? files[0].name : "";
  const what = files.length > 1 ? `${files.length} files` : name ? `“${name.length > 40 ? `${name.slice(0, 39)}…` : name}”` : "This file";
  toast.error(`${what} can’t be added — only ${ACCEPTED_NAMES} images can be uploaded.`);
}

const Editor = forwardRef<EditorApi, EditorProps>(function Editor({
  value, onChange, onBlur, onSubmit, placeholder = "", editable = true, autoFocus = false, compact = false,
  mentions = true, minHeight = 24, className = "", onReady,
}, ref) {
  // Latest callbacks / flags, read by long-lived editor closures (no stale props).
  const live = useRef({ onChange, onBlur, onSubmit, placeholder, mentions, onReady });
  live.current = { onChange, onBlur, onSubmit, placeholder, mentions, onReady };

  const editorRef = useRef<TiptapEditor | null>(null);
  const [uploading, setUploading] = useState(0);
  const [initialContent] = useState(() => editorInput(value || ""));

  /* external value sync: `synced` is the editor HTML when it last matched `value`; `pending` is a
     `value` that arrived while the user was in the editor (applied on blur if they didn't edit). */
  const synced = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
  const wantFocus = useRef<FocusAt | null>(null);
  const [sync] = useState(() => {
    const apply = (ed: TiptapEditor, html: string) => {
      pending.current = null;
      ed.commands.setContent(editorInput(html || ""), { emitUpdate: false });
      synced.current = ed.getHTML();
    };
    /** focus left the editor: land a parked value unless the user changed the text since the last sync */
    const settle = (ed: TiptapEditor) => {
      const next = pending.current;
      if (next == null || ed.isDestroyed) return;
      pending.current = null;
      if (ed.getHTML() !== synced.current) return; // local edits win — the owner persists them on blur
      apply(ed, next);
    };
    return { apply, settle };
  });

  const api = useMemo<EditorApi>(() => ({
    focus: (at = "end") => {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) { wantFocus.current = at; return; }
      ed.commands.focus(at);
    },
    blur: () => {
      wantFocus.current = null;
      const ed = editorRef.current;
      if (ed && !ed.isDestroyed) ed.commands.blur();
    },
    get editor() {
      const ed = editorRef.current;
      return ed && !ed.isDestroyed ? ed : null;
    },
  }), []);
  useImperativeHandle(ref, () => api, [api]);

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
        const { images, refused } = splitFiles(event.clipboardData?.files);
        // Office apps put a rendered image next to the text — only handle pure file pastes.
        if ((!images.length && !refused.length) || event.clipboardData?.getData("text/plain")) return false;
        event.preventDefault();
        toastRefused(refused);
        if (images.length) void insertImages(images, null);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const { images, refused } = splitFiles(event.dataTransfer?.files);
        if (!images.length && !refused.length) return false;
        // every file drop is ours: left to the browser, an unsupported file would open in place of the page
        event.preventDefault();
        toastRefused(refused);
        if (!images.length) return true;
        const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void insertImages(images, hit ? hit.pos : null);
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
    onBlur: ({ editor: e, event }) => {
      const to = event?.relatedTarget;
      // the link field of the selection toolbar is still "in" the editor
      if (!(to instanceof Element && to.closest(`[${EDITOR_UI_ATTR}]`))) sync.settle(e);
      live.current.onBlur?.(e.getHTML());
    },
  });

  // the instance exists: run a focus() requested before mount, then hand out the api
  useEffect(() => {
    editorRef.current = editor;
    if (!editor || editor.isDestroyed) return;
    synced.current = editor.getHTML();
    const at = wantFocus.current;
    wantFocus.current = null;
    if (at) editor.commands.focus(at);
    live.current.onReady?.(api);
  }, [editor, api]);

  // editable can change after creation
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  // external value changes (realtime, another tab, reset after submit) — never under the caret
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const html = editor.getHTML();
    if (html === value || (isEmptyHtml(value) && editor.isEmpty)) {
      synced.current = html;
      pending.current = null;
      return;
    }
    if (editor.isFocused) pending.current = value;
    else sync.apply(editor, value);
  }, [editor, value, sync]);

  const cls = `prose-locus ${compact ? "compact" : ""}`;
  return (
    <div className={`relative min-w-0 ${className}`}>
      {editor ? (
        <>
          <EditorContent editor={editor} />
          {editable && <BubbleToolbar editor={editor} onLeave={sync.settle} />}
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
});

export default Editor;
