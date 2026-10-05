"use client";
/* ─── Locus · settings building blocks (page, section, card, row, inline fields, pickers) ─── */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Copy, Lock, X } from "lucide-react";
import { COLORS } from "@/lib/model";
import { toast } from "@/lib/ui";
import { UPLOAD_IMAGE_TYPES, copyText } from "@/lib/sync/actions";
import { cn } from "@/lib/cn";
import { Button, Input, Textarea } from "@/components/primitives/controls";
import { Dropdown, Modal } from "@/components/primitives/overlay";
import { LabelDot } from "@/components/primitives/icons";

/* ═══ layout ═══ */

export function SettingsPage({
  title, description, icon, actions, children,
}: { title: ReactNode; description?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="anim-fade">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex min-w-0 items-center gap-2.5 text-[22px] font-semibold tracking-[-0.012em] text-ink">
            {icon}
            <span className="truncate">{title}</span>
          </h2>
          {description && <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-dim">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-10">{children}</div>
    </div>
  );
}

export function Section({
  id, title, description, action, tone, children,
}: { id?: string; title?: ReactNode; description?: ReactNode; action?: ReactNode; tone?: "danger"; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      {(title || action) && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className={`flex items-center gap-2 text-[14px] font-medium ${tone === "danger" ? "text-danger" : "text-ink"}`}>{title}</h3>}
            {description && <p className="mt-0.5 text-[12.5px] leading-snug text-dim">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const DANGER_BORDER = "border-[color:color-mix(in_srgb,var(--danger)_32%,var(--line))]";

/** Hairline-bordered card; direct children are separated by hairlines. */
export function Card({ children, className = "", tone }: { children: ReactNode; className?: string; tone?: "danger" }) {
  return (
    <div
      className={`overflow-hidden rounded-lg border bg-surface shadow-card [&>*+*]:border-t ${
        tone === "danger" ? `${DANGER_BORDER} [&>*+*]:border-line` : "border-line [&>*+*]:border-line"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** "label / description on the left, control on the right" — stacks on mobile. */
export function Row({
  label, description, children, className = "", top = false,
}: { label: ReactNode; description?: ReactNode; children?: ReactNode; className?: string; top?: boolean }) {
  return (
    <div className={`flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:justify-between sm:gap-8 ${top ? "sm:items-start" : "sm:items-center"} ${className}`}>
      <div className="min-w-0 sm:flex-1">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {description && <div className="mt-0.5 text-[12.5px] leading-snug text-dim">{description}</div>}
      </div>
      {children != null && <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap sm:justify-end">{children}</div>}
    </div>
  );
}

/** Small explanatory note for read-only (non-admin) states. */
export function AdminNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-raised px-3 py-2 text-[12.5px] text-dim">
      <Lock size={13} className="shrink-0 text-faint" />
      <span>{children}</span>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "danger" }) {
  const cls = tone === "accent" ? "bg-accent-soft text-accent" : tone === "danger" ? "bg-wash text-danger" : "bg-wash text-dim";
  return <span className={`inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

/** Counter pill used in section titles. */
export function Count({ n }: { n: number }) {
  return <span className="rounded-full bg-wash px-1.5 text-[11px] font-medium leading-[18px] text-dim tabular-nums">{n}</span>;
}

/* ═══ inline text field: saves on blur / Enter, Escape reverts ═══ */

export function TextField({
  value, onSave, validate, normalize = (v) => v.trim(), placeholder, disabled, maxLength, prefix, multiline = false,
  variant = "box", className = "", inputClassName = "", ariaLabel, successMessage = "Saved", rows = 3, autoComplete = "off",
  muted = false,
}: {
  value: string;
  onSave: (v: string) => Promise<boolean | void> | boolean | void;
  validate?: (v: string) => string | null;
  normalize?: (v: string) => string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  prefix?: ReactNode;
  multiline?: boolean;
  /** box = bordered input (forms), inline = borderless until hovered (list rows) */
  variant?: "box" | "inline";
  className?: string;
  /** extra classes for the <input>/<textarea> itself (e.g. `uppercase`) */
  inputClassName?: string;
  ariaLabel?: string;
  successMessage?: string | null;
  rows?: number;
  autoComplete?: string;
  /** secondary text color (inline descriptions) */
  muted?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const skip = useRef(false);
  /** the user typed since the last sync — only then does blur save (never write back a stale value) */
  const dirty = useRef(false);

  // follow external changes (realtime, optimistic revert) unless the user has unsaved typing
  useEffect(() => {
    if (!focused.current || !dirty.current) { setDraft(value); setError(null); dirty.current = false; }
  }, [value]);

  const commit = async () => {
    if (!dirty.current) { setDraft(value); setError(null); return; }
    const next = normalize(draft);
    if (next === value) { dirty.current = false; setDraft(value); setError(null); return; }
    const err = validate?.(next) ?? null;
    if (err) {
      if (variant === "inline") { dirty.current = false; toast.error(err); setDraft(value); setError(null); }
      else setError(err);
      return;
    }
    dirty.current = false;
    setError(null);
    setDraft(next);
    const ok = await onSave(next);
    if (ok === false) { setDraft(value); return; }
    if (successMessage) toast.success(successMessage);
  };

  const change = (v: string) => {
    dirty.current = true;
    setDraft(v);
    if (error) setError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      skip.current = true;
      dirty.current = false;
      setDraft(value);
      setError(null);
      e.currentTarget.blur();
      return;
    }
    if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const handlers = {
    value: draft,
    disabled,
    placeholder,
    maxLength,
    autoComplete,
    spellCheck: false,
    "aria-label": ariaLabel,
    "aria-invalid": error ? true : undefined,
    onFocus: () => { focused.current = true; },
    onBlur: () => {
      focused.current = false;
      if (skip.current) { skip.current = false; return; }
      void commit();
    },
    onKeyDown,
  };

  const inlineCls =
    `h-8 w-full truncate rounded-md border border-transparent bg-transparent px-2 text-[13px] ${muted ? "text-dim" : "text-ink"} outline-none transition-colors placeholder:text-faint hover:border-line-strong focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent-soft disabled:hover:border-transparent`;

  if (variant === "inline") {
    return (
      <input
        {...handlers}
        onChange={(e) => change(e.target.value)}
        className={cn(inlineCls, inputClassName, className)}
      />
    );
  }

  const disabledCls = "disabled:cursor-not-allowed disabled:bg-raised disabled:text-dim";
  return (
    <div className={`w-full ${className}`}>
      {multiline ? (
        <Textarea
          {...handlers}
          rows={rows}
          onChange={(e) => change(e.target.value)}
          className={cn("resize-y leading-relaxed", disabledCls, error && "border-danger", inputClassName)}
        />
      ) : prefix ? (
        // sized like <Input>: 36px / 16px on mobile (no iOS zoom), 32px / 13px from sm
        <div
          className={cn(
            "flex h-9 items-stretch overflow-hidden rounded-md border bg-surface text-[16px] transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft sm:h-8 sm:text-[13px]",
            disabled && "bg-raised",
            error ? "border-danger" : "border-line-strong",
          )}
        >
          <span className="flex select-none items-center pl-2.5 text-faint">{prefix}</span>
          <input
            {...handlers}
            onChange={(e) => change(e.target.value)}
            className={cn("min-w-0 flex-1 bg-transparent pl-0.5 pr-2.5 text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed disabled:text-dim", inputClassName)}
          />
        </div>
      ) : (
        <Input
          {...handlers}
          invalid={Boolean(error)}
          onChange={(e) => change(e.target.value)}
          className={cn(disabledCls, inputClassName)}
        />
      )}
      {error && <div className="mt-1 text-xxs text-danger">{error}</div>}
    </div>
  );
}

/** Compact popover input: keeps the Input primitive's 16px mobile text (no iOS zoom), 28px / 12.5px from sm. */
const compactInput = "h-8 min-w-0 px-2 sm:h-7 sm:text-[12.5px]";

/* ═══ colors ═══ */

const HEX = /^#[0-9a-f]{6}$/i;

export function ColorSwatches({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  const current = value.toLowerCase();
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
      {COLORS.map((c) => {
        const on = current === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c}
            disabled={disabled}
            onClick={() => onChange(c)}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 sm:h-6 sm:w-6"
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full sm:h-[18px] sm:w-[18px]"
              style={{ background: c, boxShadow: on ? `0 0 0 2px var(--surface), 0 0 0 3.5px ${c}` : undefined }}
            >
              {on && <Check size={11} strokeWidth={3} className="text-white" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ColorPanel({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const [hex, setHex] = useState(value);
  const valid = HEX.test(hex.trim());
  const current = value.toLowerCase();
  // the Popover would focus the hex input (popping the mobile keyboard); start on the current swatch instead
  const focusIndex = Math.max(0, COLORS.indexOf(current));
  return (
    <div className="p-2.5">
      <div className="grid grid-cols-6 gap-1">
        {COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={current === c}
            autoFocus={i === focusIndex}
            onClick={() => onPick(c)}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-md hover:bg-wash"
          >
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full" style={{ background: c }}>
              {current === c && <Check size={11} strokeWidth={3} className="text-white" />}
            </span>
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex items-center gap-1.5 border-t border-line pt-2.5"
        onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (valid) onPick(hex.trim().toLowerCase()); }}
      >
        <span className="h-5 w-5 shrink-0 rounded-full border border-line" style={{ background: valid ? hex.trim() : "transparent" }} />
        <Input
          value={hex}
          onChange={(e) => setHex(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)}
          maxLength={7}
          aria-label="Custom hex color"
          invalid={!valid && hex.length > 1}
          aria-invalid={!valid && hex.length > 1 ? true : undefined}
          spellCheck={false}
          autoComplete="off"
          className={`${compactInput} font-mono`}
        />
        <Button type="submit" size="sm" className="max-sm:h-8" disabled={!valid}>Set</Button>
      </form>
    </div>
  );
}

/** Small anchored color menu (swatches + custom hex). `glyph` renders inside the trigger. */
export function ColorMenu({
  value, onChange, disabled, label = "Change color", glyph,
}: { value: string; onChange: (c: string) => void; disabled?: boolean; label?: string; glyph?: ReactNode }) {
  return (
    <Dropdown
      width={226}
      disabled={disabled}
      trigger={(p) => (
        <button
          ref={p.ref}
          type="button"
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-label={label}
          title={disabled ? undefined : label}
          disabled={disabled}
          className={`focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-wash disabled:cursor-default disabled:hover:bg-transparent ${p.open ? "bg-wash" : ""}`}
        >
          {glyph ?? <LabelDot color={value} size={10} />}
        </button>
      )}
    >
      {(close) => <ColorPanel value={value} onPick={(c) => { close(); if (c !== value) onChange(c); }} />}
    </Dropdown>
  );
}

/* ═══ emoji icon ═══ */

const EMOJIS = [
  "🚀", "⚡", "🔥", "✨", "🎯", "🧠", "💡", "🛠️",
  "🧪", "🐛", "📦", "🔒", "🎨", "📱", "💻", "⚙️",
  "🌐", "📊", "📈", "🧭", "🗂️", "📝", "📣", "💬",
  "🤝", "🏗️", "🧩", "🛡️", "🌱", "🌊", "☁️", "🌙",
  "☀️", "⭐", "🍀", "🦄", "🐙", "🦊", "🐝", "🎮",
  "🎧", "📷", "🚚", "💰", "🏆", "❤️", "🔔", "🧾",
];

export function isSingleEmoji(s: string): boolean {
  if (!s || s.length > 16 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s)) return false;
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)).length === 1;
  }
  return true;
}

function EmojiPanel({ value, onPick }: { value: string | null; onPick: (icon: string | null) => void }) {
  const [custom, setCustom] = useState("");
  const valid = isSingleEmoji(custom.trim());
  return (
    <div className="p-2">
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJIS.map((e, i) => (
          <button
            key={e}
            type="button"
            aria-label={`Use ${e}`}
            aria-pressed={value === e}
            autoFocus={value && EMOJIS.includes(value) ? value === e : i === 0}
            onClick={() => onPick(e)}
            className={`focus-ring flex h-8 w-8 items-center justify-center rounded-md text-[17px] leading-none transition-colors hover:bg-wash ${value === e ? "bg-accent-soft" : ""}`}
          >
            {e}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex items-center gap-1.5 border-t border-line pt-2"
        onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (valid) onPick(custom.trim()); }}
      >
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Paste any emoji"
          aria-label="Custom emoji"
          autoComplete="off"
          className={compactInput}
        />
        <Button type="submit" size="sm" className="max-sm:h-8" disabled={!valid}>Use</Button>
      </form>
      {value && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-dim hover:bg-wash hover:text-ink"
        >
          <X size={13} /> Remove icon
        </button>
      )}
    </div>
  );
}

/** Emoji picker button. `preview` renders the current icon (or a fallback glyph). */
export function EmojiMenu({
  value, onChange, disabled, preview,
}: { value: string | null; onChange: (icon: string | null) => void; disabled?: boolean; preview: ReactNode }) {
  return (
    <Dropdown
      width={288}
      disabled={disabled}
      trigger={(p) => (
        <Button
          ref={p.ref}
          type="button"
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          disabled={disabled}
          icon={preview}
          className="h-8 gap-2 px-2 text-dim hover:text-ink"
        >
          {value ? "Change icon" : "Choose emoji"}
        </Button>
      )}
    >
      {(close) => <EmojiPanel value={value} onPick={(icon) => { close(); if (icon !== value) onChange(icon); }} />}
    </Dropdown>
  );
}

/* ═══ copy ═══ */

export function CopyButton({ text, what = "Link copied", label = "Copy", compact = false, disabled }: {
  text: string | null | undefined; what?: string; label?: string; compact?: boolean; disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const run = () => {
    if (!text) return;
    copyText(text, what);
    setCopied(true);
  };
  if (compact) {
    return (
      <button
        type="button"
        onClick={run}
        disabled={disabled || !text}
        aria-label={label}
        title={label}
        className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-wash hover:text-ink disabled:pointer-events-none disabled:opacity-40"
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </button>
    );
  }
  return (
    <Button type="button" size="sm" className="max-sm:h-8" onClick={run} disabled={disabled || !text} icon={copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}>
      {copied ? "Copied" : label}
    </Button>
  );
}

/* ═══ images ═══ */

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * MIME types the `avatars` storage bucket accepts. Both buckets take the same raster-only
 * list (UPLOAD_IMAGE_TYPES) — SVG and other active content is refused.
 */
export const AVATAR_IMAGE_TYPES: readonly string[] = UPLOAD_IMAGE_TYPES;

/** `accept` attribute for settings image inputs: the picker only offers the types storage takes. */
export const IMAGE_ACCEPT = UPLOAD_IMAGE_TYPES.join(",");

const IMAGE_TYPE_LABEL: Record<string, string> = {
  "image/png": "PNG", "image/jpeg": "JPEG", "image/gif": "GIF", "image/webp": "WebP", "image/avif": "AVIF",
};

const typeName = (t: string) => IMAGE_TYPE_LABEL[t] ?? t.replace(/^image\/(x-)?/, "").split(/[+;]/)[0].toUpperCase();

/** "PNG, JPEG, GIF, WebP or AVIF" */
function typeList(types: readonly string[]): string {
  const names = Array.from(new Set(types.map(typeName)));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0] ?? "";
}

/** Row hint for image pickers: "PNG, JPEG, GIF, WebP or AVIF, up to 2 MB." — follows UPLOAD_IMAGE_TYPES. */
export const IMAGE_FORMATS_HINT = `${typeList(UPLOAD_IMAGE_TYPES)}, up to ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`;

/** "SVG images can't be uploaded. Only PNG, JPEG, GIF, WebP or AVIF images are supported." */
function refusedMessage(file: File, allowed: readonly string[]): string {
  const only = ` Only ${typeList(allowed)} images are supported.`;
  const kind = file.type.startsWith("image/") ? typeName(file.type) : "";
  if (/^[A-Z0-9]{2,5}$/.test(kind)) return `${kind} images can't be uploaded.${only}`;
  const name = file.name.length > 40 ? `${file.name.slice(0, 39)}…` : file.name;
  return `${name ? `“${name}”` : "That file"} can't be uploaded.${only}`;
}

/**
 * Validate a picked image file (type + ≤ 2 MB). Toasts and returns null when invalid.
 * Only the raster types storage accepts (UPLOAD_IMAGE_TYPES) ever pass: `types` can narrow
 * that list, and any type outside it (SVG, HEIC…) is ignored rather than allowed.
 */
export function acceptImage(file: File | undefined | null, types?: readonly string[]): File | null {
  if (!file) return null;
  const narrowed = types?.length ? UPLOAD_IMAGE_TYPES.filter((t) => types.includes(t)) : [];
  const allowed = narrowed.length ? narrowed : UPLOAD_IMAGE_TYPES;
  if (!allowed.includes(file.type)) {
    toast.error(refusedMessage(file, allowed));
    return null;
  }
  if (file.size > MAX_IMAGE_BYTES) { toast.error(`Images must be ${MAX_IMAGE_BYTES / (1024 * 1024)} MB or smaller.`); return null; }
  return file;
}

/* ═══ destructive confirmation by typing ═══ */

interface TypeToConfirmProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  expected: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | unknown;
}

export function TypeToConfirm({ open, onClose, title, ...rest }: TypeToConfirmProps) {
  // the form mounts fresh on every open (Modal renders nothing while closed), so no stale text flashes
  const busy = useRef(false);
  return (
    <Modal open={open} onClose={() => { if (!busy.current) onClose(); }} width={440} label={title}>
      <TypeToConfirmForm title={title} onClose={onClose} busyRef={busy} {...rest} />
    </Modal>
  );
}

function TypeToConfirmForm({
  onClose, title, body, expected, confirmLabel, onConfirm, busyRef,
}: Omit<TypeToConfirmProps, "open"> & { busyRef: { current: boolean } }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const match = text.trim() === expected.trim();
  useEffect(() => () => { busyRef.current = false; }, [busyRef]);
  return (
    <form
      className="p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!match || busy) return;
        setBusy(true);
        busyRef.current = true;
        try { await onConfirm(); } finally { busyRef.current = false; setBusy(false); }
      }}
    >
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <div className="mt-2 text-[13px] leading-relaxed text-dim">{body}</div>
      <label className="mt-4 block">
        <span className="block text-[12.5px] text-dim">
          Type <span className="select-all font-semibold text-ink">{expected}</span> to confirm
        </span>
        <Input
          autoFocus
          className="mt-1.5"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Type ${expected} to confirm`}
        />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" className="max-sm:h-8" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="danger" className="max-sm:h-8" disabled={!match} loading={busy}>{confirmLabel}</Button>
      </div>
    </form>
  );
}

/* ═══ misc ═══ */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Case-insensitive name collision check helper. */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
