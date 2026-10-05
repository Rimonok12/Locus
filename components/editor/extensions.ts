"use client";
/* ─── Locus · Tiptap extension set + schema-based HTML sanitizer ─────────────
   One extension list feeds both the live editor and the read-only renderer, so
   stored HTML is always re-parsed through the exact schema that produced it:
   unknown tags, event-handler attributes, `javascript:` links and data: images
   are dropped by the parser, never injected.
   ──────────────────────────────────────────────────────────────────────────── */

import { getSchema, type Extensions } from "@tiptap/react";
import { DOMParser as PMDOMParser, DOMSerializer, type Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import Mention, { type MentionOptions } from "@tiptap/extension-mention";

export const LINK_ATTRS = { rel: "noopener noreferrer nofollow", target: "_blank" } as const;

export type MentionSuggestion = MentionOptions["suggestion"];

/**
 * The document schema: StarterKit (headings 1–3, lists, code, quotes, links…),
 * nested task lists, block images and @mentions.
 * Mentions serialize as `<span data-type="mention" class="mention" data-id="<uuid>" data-label="Name">@Name</span>`.
 */
export function coreExtensions(suggestion?: MentionSuggestion): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { ...LINK_ATTRS },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: false, allowBase64: false }),
    Mention.configure({
      HTMLAttributes: { class: "mention" },
      ...(suggestion ? { suggestion } : {}),
    }),
  ];
}

/* ─── untrusted input ─── */

/* The Link mark keeps any `class` it finds on <a>, so crafted HTML could style a link as a
   full-screen overlay (`fixed inset-0 …`). Everything else the schema keeps is inert. */
function scrubLinks(root: ParentNode) {
  root.querySelectorAll("a[class]").forEach((a) => a.removeAttribute("class"));
}

/** Stored HTML made safe to load into the live editor (the schema drops everything else). */
export function editorInput(html: string): string {
  if (!html || typeof window === "undefined" || !/<a\b[^>]*\bclass\s*=/i.test(html)) return html;
  const parsed = new window.DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  scrubLinks(parsed.body);
  return parsed.body.innerHTML;
}

/* ─── read-only rendering ─── */

let schema: Schema | null = null;
const cache = new Map<string, string>();
const CACHE_MAX = 400;

/** Parse stored HTML through the editor schema and serialize it back (inert document, no script/handler survives). */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined") return "";
  const hit = cache.get(html);
  if (hit !== undefined) return hit;

  schema ??= getSchema(coreExtensions());
  // DOMParser documents are inert: no scripts run, no images load, no handlers fire.
  const parsed = new window.DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  scrubLinks(parsed.body);
  const doc = PMDOMParser.fromSchema(schema).parse(parsed.body);

  const out = document.implementation.createHTMLDocument("");
  const container = out.createElement("div");
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: out }));
  container.querySelectorAll("input").forEach((el) => {
    el.setAttribute("disabled", "");
    el.setAttribute("tabindex", "-1");
  });
  container.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("target", LINK_ATTRS.target);
    a.setAttribute("rel", LINK_ATTRS.rel);
    a.removeAttribute("class");
  });
  const result = container.innerHTML;

  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(html, result);
  return result;
}
