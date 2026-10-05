"use client";
/* ─── Locus · @mention suggestion: member search + popup ─────────────────────
   The popup is a React component rendered by Tiptap's ReactRenderer into a
   fixed-position container placed at the caret (props.clientRect()). Keyboard:
   ↑/↓ move, Enter/Tab pick, Escape closes (handled by the suggestion plugin);
   the popup also closes when the editor loses focus (click outside, Tab away).
   ──────────────────────────────────────────────────────────────────────────── */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ReactRenderer, type Editor } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { useSync } from "@/lib/sync/store";
import { displayName } from "@/lib/model";
import { Avatar } from "@/components/primitives/Avatar";
import type { Profile } from "@/lib/types";
import type { MentionSuggestion } from "./extensions";

export interface MentionItem {
  id: string;
  label: string;
  profile: Profile;
}

/** Workspace members matching `query` by name, display name or email (prefix matches first). */
export function searchMembers(query: string, limit = 8): MentionItem[] {
  const s = useSync.getState();
  const q = query.trim().toLowerCase();
  const ranked: { item: MentionItem; rank: number }[] = [];
  for (const m of Object.values(s.workspace_members)) {
    const p = s.profiles[m.user_id];
    if (!p) continue;
    const hay = [p.name, p.display_name, p.email].filter(Boolean).map((x) => x.toLowerCase());
    let rank = 2;
    if (!q) rank = p.id === s.userId ? 1 : 0;
    else if (hay.some((h) => h.startsWith(q) || h.split(/[\s._-]+/).some((w) => w.startsWith(q)))) rank = 0;
    else if (hay.some((h) => h.includes(q))) rank = 1;
    else continue;
    ranked.push({ item: { id: p.id, label: displayName(p), profile: p }, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.item.label.localeCompare(b.item.label));
  return ranked.slice(0, limit).map((r) => r.item);
}

/* ─── popup ─── */

export interface MentionListProps {
  items: MentionItem[];
  command: (attrs: MentionNodeAttrs) => void;
  loading: boolean;
  query: string;
}
export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList({ items, command, loading, query }, ref) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const pick = (i: number) => {
    const it = items[i];
    if (it) command({ id: it.id, label: it.label });
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      // ⌘/Ctrl+Enter still submits the surrounding form; only bare keys drive the list
      if (!items.length || event.metaKey || event.ctrlKey || event.altKey) return false;
      if (event.key === "ArrowDown") { setIndex((i) => (i + 1) % items.length); return true; }
      if (event.key === "ArrowUp") { setIndex((i) => (i - 1 + items.length) % items.length); return true; }
      if (event.key === "Enter" || event.key === "Tab") { pick(Math.min(index, items.length - 1)); return true; }
      return false;
    },
  }), [items, index, command]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !items.length) return null;
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Mention a teammate"
      className="anim-pop max-h-[280px] w-[260px] overflow-y-auto rounded-lg bg-surface p-1 shadow-pop"
      onMouseDown={(e) => e.preventDefault() /* keep editor focus */}
    >
      {items.length === 0 ? (
        <div className="px-2 py-2 text-[12.5px] text-faint">{query ? `No one matches “${query}”` : "No teammates yet"}</div>
      ) : (
        items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            role="option"
            aria-selected={i === index}
            data-index={i}
            onMouseEnter={() => setIndex(i)}
            onClick={() => pick(i)}
            className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink ${i === index ? "bg-wash" : ""}`}
          >
            <Avatar profile={it.profile} size={18} />
            <span className="min-w-0 truncate font-medium">{it.label}</span>
            <span className="ml-auto min-w-0 truncate pl-2 text-xxs text-faint">{it.profile.email}</span>
          </button>
        ))
      )}
    </div>
  );
});

/* ─── suggestion config ─── */

/** Suggestion options for the Mention extension. `enabled()` is read on every keystroke. */
export function mentionSuggestion(enabled: () => boolean): MentionSuggestion {
  // one key per editor, so this popup can be closed programmatically
  const pluginKey = new PluginKey("locusMention");
  return {
    pluginKey,
    char: "@",
    allowSpaces: false,
    decorationClass: "mention-query",
    decorationEmptyClass: "mention-query-empty",
    items: ({ query }) => searchMembers(query),
    allow: ({ state, range }) => {
      if (!enabled()) return false;
      const type = state.schema.nodes.mention;
      const $from = state.doc.resolve(range.from);
      return Boolean(type && $from.parent.type.contentMatch.matchType(type));
    },
    render: () => {
      let renderer: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
      let wrap: HTMLDivElement | null = null;
      let rectOf: SuggestionProps["clientRect"] = null;
      let frame = 0;
      let blurTimer: ReturnType<typeof setTimeout> | undefined;
      let host: Editor | null = null;

      // Item clicks keep focus (mousedown is prevented), so a real blur means the user left the editor.
      const onBlur = () => {
        clearTimeout(blurTimer);
        blurTimer = setTimeout(() => {
          const ed = host;
          if (ed && !ed.isDestroyed && !ed.isFocused) exitSuggestion(ed.view, pluginKey);
        }, 0);
      };

      const place = () => {
        if (!wrap) return;
        const rect = rectOf?.();
        if (!rect) { wrap.style.visibility = "hidden"; return; }
        const w = wrap.offsetWidth || 260;
        const h = wrap.offsetHeight || 0;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let top = rect.bottom + 6;
        if (top + h > vh - 8 && rect.top - h - 6 > 8) top = rect.top - h - 6;
        const left = Math.max(8, Math.min(rect.left, vw - w - 8));
        wrap.style.top = `${Math.max(8, top)}px`;
        wrap.style.left = `${left}px`;
        wrap.style.visibility = "visible";
      };
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(place);
      };
      const toProps = (p: SuggestionProps): MentionListProps => ({
        items: p.items as MentionItem[],
        command: p.command as (a: MentionNodeAttrs) => void,
        loading: p.loading,
        query: p.query,
      });
      const teardown = () => {
        cancelAnimationFrame(frame);
        clearTimeout(blurTimer);
        host?.off("blur", onBlur);
        host = null;
        window.removeEventListener("scroll", schedule, true);
        window.removeEventListener("resize", schedule);
        renderer?.destroy();
        renderer = null;
        wrap?.remove();
        wrap = null;
      };

      return {
        onStart: (props) => {
          teardown();
          rectOf = props.clientRect;
          renderer = new ReactRenderer(MentionList, { editor: props.editor, props: toProps(props) });
          wrap = document.createElement("div");
          wrap.setAttribute("data-locus-mention", "");
          wrap.style.position = "fixed";
          wrap.style.zIndex = "100";
          wrap.style.visibility = "hidden";
          wrap.appendChild(renderer.element);
          document.body.appendChild(wrap);
          host = props.editor;
          host.on("blur", onBlur);
          place();
          schedule();
          window.addEventListener("scroll", schedule, true);
          window.addEventListener("resize", schedule);
        },
        onUpdate: (props) => {
          rectOf = props.clientRect;
          renderer?.updateProps(toProps(props));
          place();
          schedule();
        },
        onKeyDown: ({ event }) => {
          if (event.key === "Escape") return true;
          return renderer?.ref?.onKeyDown(event) ?? false;
        },
        onExit: () => teardown(),
      };
    },
  };
}
