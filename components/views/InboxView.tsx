"use client";
/* ─── Locus · Inbox: notifications list + selected item pane ─────────────────
   Keyboard (while no overlay is open and focus isn't in a text field):
     J / K  move · Enter open full page · E / Backspace archive · U read toggle
     H snooze menu (unsnooze on the Snoozed tab) · Esc clear selection
   Selecting or opening a snoozed notification never marks it read: it has to
   come back as new when its snooze ends.
   One bubble-phase window listener: anything inside the page that handles a
   key first (fields, menus, inline forms) marks it defaultPrevented and wins;
   Escape defers to the global handler by state (selection / peek / drawer),
   not by listener order. Two panes from lg; narrower screens open full pages.
   ──────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, CheckCheck, Inbox, MoreHorizontal } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toast, ui, useUI } from "@/lib/ui";
import { navigate } from "@/lib/router";
import {
  archiveNotifications, markAllNotificationsRead, markNotificationsRead, snoozeNotifications, unsnoozeNotifications,
} from "@/lib/sync/actions";
import { HeaderTab, ViewHeader } from "@/components/app/Header";
import { Button, EmptyState, IconButton, Tooltip } from "@/components/primitives/controls";
import { Dropdown, Popover } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import InboxRow from "@/components/inbox/InboxRow";
import InboxDetail from "@/components/inbox/InboxDetail";
import SnoozeMenu from "@/components/inbox/SnoozeMenu";
import { isSnoozed, routeForNotification, snoozedUntilLabel, type InboxTab } from "@/components/inbox/util";
import { isActivatable, isTypingTarget, overlayOpen, useMediaQuery, useNow } from "@/components/inbox/hooks";
import type { Notification } from "@/lib/types";

const CHORD_MS = 1200;
/** list + detail side by side; below this a notification opens its full page */
const TWO_PANE = "(min-width: 1024px)";
const plural = (n: number) => `${n} notification${n === 1 ? "" : "s"}`;

export default function InboxView() {
  const me = useSync((s) => s.userId);
  const notifications = useSync((s) => s.notifications);
  const [tab, setTabState] = useState<InboxTab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** read during this visit — kept visible in the Unread tab so the selection doesn't vanish */
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  /** open snooze menu, anchored to its row (hover action / H) */
  const [snooze, setSnooze] = useState<{ ids: string[]; anchor: HTMLElement } | null>(null);
  const now = useNow(30_000);
  const desktop = useMediaQuery(TWO_PANE);
  const rowEls = useRef(new Map<string, HTMLDivElement>());

  const mine = useMemo(
    () => Object.values(notifications).filter((n) => n.user_id === me && !n.archived_at),
    [notifications, me],
  );

  const list = useMemo(() => {
    const t = Date.now(); // fresh clock on every recompute; `now` only forces a periodic refresh
    /** when the row (re)entered the inbox: an expired snooze resurfaces it at its wake time */
    const at = (n: Notification) => {
      const c = Date.parse(n.created_at);
      if (!n.snoozed_until) return c;
      const s = Date.parse(n.snoozed_until);
      return s <= t ? Math.max(c, s) : c;
    };
    return mine
      .filter((n) => {
        const snoozed = isSnoozed(n, t);
        if (tab === "snoozed") return snoozed;
        if (snoozed) return false;
        return tab === "all" || !n.read_at || kept.has(n.id);
      })
      .sort(tab === "snoozed"
        ? (a, b) => Date.parse(a.snoozed_until as string) - Date.parse(b.snoozed_until as string) // wakes soonest first
        : (a, b) => at(b) - at(a) || b.created_at.localeCompare(a.created_at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, tab, kept, now]);

  const counts = useMemo(() => {
    const t = Date.now();
    let unread = 0;
    let snoozed = 0;
    for (const n of mine) {
      if (isSnoozed(n, t)) snoozed++;
      else if (!n.read_at) unread++;
    }
    return { unread, snoozed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, now]);

  const readIds = useMemo(() => {
    const t = Date.now();
    return mine.filter((n) => n.read_at && !isSnoozed(n, t)).map((n) => n.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, now]);

  const selected = selectedId ? list.find((n) => n.id === selectedId) : undefined;

  /* ─── commands (latest state via a ref so callbacks stay stable for memoised rows) ─── */
  const live = useRef({ list, selectedId, desktop, tab });
  live.current = { list, selectedId, desktop, tab };

  /** Snoozed reminders stay unread while you look at them, so they resurface as new when they wake. */
  const staysUnread = useCallback((n: Notification | undefined) => !n || live.current.tab === "snoozed" || isSnoozed(n), []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (!id || staysUnread(useSync.getState().notifications[id])) return;
    setKept((k) => (k.has(id) ? k : new Set(k).add(id)));
    markNotificationsRead([id]);
  }, [staysUnread]);

  /** When `ids` leave the current list, move the selection to the row that takes their place. */
  const advancePast = useCallback((ids: string[]) => {
    const { list: l, selectedId: sel, desktop: d } = live.current;
    if (!sel || !ids.includes(sel)) return;
    const idx = l.findIndex((n) => n.id === sel);
    const rest = l.filter((n) => !ids.includes(n.id));
    const next = rest[Math.min(Math.max(idx, 0), rest.length - 1)];
    if (d && next) select(next.id);
    else setSelectedId(null);
  }, [select]);

  /** Resolves true once the server accepted it (the rows drop then); failures revert and toast on their own. */
  const archive = useCallback(async (ids: string[]): Promise<boolean> => {
    if (!ids.length) return false;
    advancePast(ids);
    return archiveNotifications(ids);
  }, [advancePast]);

  const snoozeUntil = useCallback((ids: string[], until: Date) => {
    if (!ids.length) return;
    // snoozing clears read_at; undo puts the read state back (one write after the other, never racing)
    const notes = useSync.getState().notifications;
    const wasRead = ids.filter((id) => notes[id]?.read_at);
    if (live.current.tab !== "snoozed") advancePast(ids);
    void snoozeNotifications(ids, until).then((ok) => {
      if (!ok) return; // reverted + toasted by the store
      const what = ids.length === 1 ? "Snoozed" : `Snoozed ${plural(ids.length)}`;
      toast(`${what} until ${snoozedUntilLabel(until.toISOString())}`, {
        label: "Undo",
        run: () => {
          void unsnoozeNotifications(ids).then((back) => { if (back) markNotificationsRead(wasRead); });
        },
      });
    });
  }, [advancePast]);

  const unsnooze = useCallback((id: string) => {
    const prev = useSync.getState().notifications[id]?.snoozed_until ?? null;
    if (live.current.tab === "snoozed") advancePast([id]);
    void unsnoozeNotifications([id]).then((ok) => {
      if (!ok) return;
      toast("Moved back to your inbox", prev && Date.parse(prev) > Date.now() ? {
        label: "Undo",
        run: () => {
          // the original wake time may have passed while the toast was up
          if (Date.parse(prev) > Date.now()) void snoozeNotifications([id], new Date(prev));
        },
      } : undefined);
    });
  }, [advancePast]);

  const toggleRead = useCallback((id: string) => {
    const n = useSync.getState().notifications[id];
    if (!n) return;
    if (!n.read_at) setKept((k) => (k.has(id) ? k : new Set(k).add(id)));
    markNotificationsRead([id], !n.read_at);
  }, []);

  const openFull = useCallback((n: Notification) => {
    const route = routeForNotification(n, useSync.getState());
    if (!staysUnread(n)) markNotificationsRead([n.id]);
    if (route) navigate(route);
    else toast.error("This item is no longer available.");
  }, [staysUnread]);

  const onRowSelect = useCallback((id: string) => {
    if (live.current.desktop) { select(id); return; }
    const n = useSync.getState().notifications[id];
    if (n) openFull(n);
  }, [select, openFull]);

  const onArchiveOne = useCallback((id: string) => { void archive([id]); }, [archive]);
  const onSnoozeOpen = useCallback((id: string, anchor: HTMLElement) => setSnooze({ ids: [id], anchor }), []);
  const onSnoozeOne = useCallback((id: string, until: Date) => snoozeUntil([id], until), [snoozeUntil]);
  const register = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  }, []);

  const setTab = (t: InboxTab) => {
    setTabState(t);
    setKept(new Set());
  };

  /* an issue page opened from here must not offer prev/next through some list that isn't on screen */
  useEffect(() => { ui.setVisibleIds([]); }, []);

  /* global property shortcuts (S, P, A, L, I…) act on the selected notification's issue */
  const focusIssueId = selected?.issue_id ?? null;
  useEffect(() => { ui.setFocused(focusIssueId); }, [focusIssueId]);

  /* keep the selected row in view */
  useEffect(() => {
    if (selectedId) rowEls.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  /* drop a selection that left this tab (archived on another device, tab switch…) */
  useEffect(() => {
    if (selectedId && !list.some((n) => n.id === selectedId)) setSelectedId(null);
  }, [list, selectedId]);

  /* the snooze menu is anchored to a row: close it if that row goes away */
  useEffect(() => {
    if (snooze && !snooze.ids.every((id) => list.some((n) => n.id === id))) setSnooze(null);
  }, [list, snooze]);

  /* ─── keyboard ─── */
  useEffect(() => {
    let chordAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      // claimed elsewhere (a field, a menu, the global "G then …" navigation) — that also ends any chord
      if (e.defaultPrevented || isTypingTarget(e.target) || overlayOpen()) { chordAt = 0; return; }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === "g" && !e.shiftKey) { chordAt = Date.now(); return; }
      if (chordAt && Date.now() - chordAt < CHORD_MS) { chordAt = 0; return; } // second key of a "G then …" chord
      chordAt = 0;
      if (e.shiftKey) return;

      const { list: l, selectedId: sel, desktop: d, tab: t } = live.current;
      const idx = sel ? l.findIndex((n) => n.id === sel) : -1;
      const current = idx >= 0 ? l[idx] : undefined;
      /** claim the key; one-shot actions don't repeat while it is held */
      const handled = () => { e.preventDefault(); return !e.repeat; };

      switch (key) {
        case "j":
        case "ArrowDown": {
          if (!l.length) return;
          handled();
          const next = l[idx < 0 ? 0 : Math.min(idx + 1, l.length - 1)];
          if (d) select(next.id); else setSelectedId(next.id);
          return;
        }
        case "k":
        case "ArrowUp": {
          if (!l.length) return;
          handled();
          const prev = l[idx < 0 ? 0 : Math.max(idx - 1, 0)];
          if (d) select(prev.id); else setSelectedId(prev.id);
          return;
        }
        case "Enter": {
          if (!current || isActivatable(e.target)) return;
          if (handled()) openFull(current);
          return;
        }
        case "e":
        case "Backspace": {
          if (!current) return;
          if (handled()) void archive([current.id]);
          return;
        }
        case "u": {
          if (!current) return;
          if (handled()) toggleRead(current.id);
          return;
        }
        case "h": {
          if (!current) return;
          const el = rowEls.current.get(current.id);
          if (!el) return;
          if (!handled()) return;
          if (t === "snoozed") unsnooze(current.id);
          else setSnooze({ ids: [current.id], anchor: el });
          return;
        }
        case "Escape": {
          // a selection of issues, the peek panel and the drawer belong to the global handler (overlays
          // were excluded above) — whichever listener runs first, only one of them acts on this press
          if (!sel || useUI.getState().selected.length) return;
          e.preventDefault();
          setSelectedId(null);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, archive, toggleRead, openFull, unsnooze]);

  /* ─── header ─── */
  const visibleIds = list.map((n) => n.id);
  const header = (
    <ViewHeader
      title="Inbox"
      icon={<Inbox size={15} className="text-dim" />}
      tabs={
        <>
          <HeaderTab active={tab === "all"} onClick={() => setTab("all")}>All</HeaderTab>
          <HeaderTab active={tab === "unread"} onClick={() => setTab("unread")}>
            Unread
            {counts.unread > 0 && <span className="text-xxs tabular-nums text-faint">{counts.unread}</span>}
          </HeaderTab>
          <HeaderTab active={tab === "snoozed"} onClick={() => setTab("snoozed")}>
            Snoozed
            {counts.snoozed > 0 && <span className="text-xxs tabular-nums text-faint">{counts.snoozed}</span>}
          </HeaderTab>
        </>
      }
      actions={
        <>
          <Tooltip label="Mark all as read">
            <Button variant="ghost" size="sm" icon={<CheckCheck size={14} />} disabled={!counts.unread} onClick={() => markAllNotificationsRead()} aria-label="Mark all as read" className="max-md:h-8 max-md:min-w-8">
              <span className="hidden sm:inline">Mark all read</span>
            </Button>
          </Tooltip>
          <Dropdown
            align="end"
            width={240}
            trigger={(p) => (
              <IconButton ref={p.ref} onClick={p.onClick} aria-expanded={p["aria-expanded"]} active={p.open} size={30} label="Inbox options" className="max-md:!h-8 max-md:!w-8">
                <MoreHorizontal size={15} />
              </IconButton>
            )}
          >
            {(close) => (
              <ActionMenu
                onDone={close}
                items={[
                  {
                    id: "archive-read",
                    label: "Archive all read",
                    hint: readIds.length || undefined,
                    icon: <Archive size={14} />,
                    disabled: !readIds.length,
                    onSelect: () => {
                      const ids = readIds;
                      void archive(ids).then((ok) => { if (ok) toast.success(`Archived ${plural(ids.length)}`); });
                    },
                  },
                  {
                    id: "archive-tab",
                    label: tab === "snoozed" ? "Archive all snoozed" : tab === "unread" ? "Archive all unread" : "Archive everything",
                    icon: <Archive size={14} />,
                    danger: true,
                    divider: true,
                    disabled: !visibleIds.length,
                    onSelect: () => {
                      const ids = visibleIds;
                      ui.askConfirm({
                        title: `Archive ${plural(ids.length)}?`,
                        body: "Archived notifications are removed from your inbox.",
                        confirmLabel: "Archive",
                        destructive: true,
                        onConfirm: async () => {
                          if (await archive(ids)) toast.success(`Archived ${plural(ids.length)}`);
                        },
                      });
                    },
                  },
                ]}
              />
            )}
          </Dropdown>
        </>
      }
    />
  );

  return (
    <>
      {header}
      <div className="flex min-h-0 flex-1">
        <div
          role="listbox"
          aria-label="Notifications"
          className="min-h-0 w-full overflow-y-auto lg:w-[360px] lg:shrink-0 lg:border-r lg:border-line"
        >
          {list.length ? (
            list.map((n) => (
              <InboxRow
                key={n.id}
                n={n}
                tick={now}
                tab={tab}
                selected={n.id === selectedId}
                menuOpen={Boolean(snooze?.ids.includes(n.id))}
                register={register}
                onSelect={onRowSelect}
                onArchive={onArchiveOne}
                onToggleRead={toggleRead}
                onSnooze={onSnoozeOpen}
                onSnoozeUntil={onSnoozeOne}
                onUnsnooze={unsnooze}
              />
            ))
          ) : (
            <InboxEmpty tab={tab} />
          )}
        </div>

        <section aria-label="Notification details" className="hidden min-h-0 min-w-0 flex-1 flex-col lg:flex">
          {desktop && (selected ? (
            <InboxDetail key={selected.id} n={selected} onArchive={onArchiveOne} />
          ) : (
            <NothingSelected hasItems={list.length > 0} />
          ))}
        </section>
      </div>

      <Popover open={Boolean(snooze)} onClose={() => setSnooze(null)} anchor={snooze?.anchor ?? null} align="end" width={260}>
        {snooze && (
          <SnoozeMenu
            onPick={(until) => {
              const ids = snooze.ids;
              setSnooze(null);
              snoozeUntil(ids, until);
            }}
          />
        )}
      </Popover>
    </>
  );
}

function InboxEmpty({ tab }: { tab: InboxTab }) {
  if (tab === "snoozed") {
    return (
      <EmptyState
        icon={<Inbox size={28} strokeWidth={1.5} />}
        title="No snoozed notifications"
        body="Press H on a notification to snooze it until later."
      />
    );
  }
  return (
    <EmptyState
      icon={<Inbox size={28} strokeWidth={1.5} />}
      title="You're all caught up"
      body={tab === "unread" ? "No unread notifications." : "Assignments, comments, mentions and status changes on issues you follow show up here."}
    />
  );
}

function NothingSelected({ hasItems }: { hasItems: boolean }) {
  return (
    <EmptyState
      icon={<Inbox size={28} strokeWidth={1.5} />}
      title={hasItems ? "Select a notification" : "Nothing to show"}
      body={
        hasItems ? (
          <span className="mt-2 inline-grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-left text-[12.5px]">
            <span className="flex gap-1"><kbd>J</kbd><kbd>K</kbd></span><span>Move between notifications</span>
            <span className="flex gap-1"><kbd>↵</kbd></span><span>Open in full page</span>
            <span className="flex gap-1"><kbd>E</kbd></span><span>Archive</span>
            <span className="flex gap-1"><kbd>U</kbd></span><span>Mark as read / unread</span>
            <span className="flex gap-1"><kbd>H</kbd></span><span>Snooze</span>
          </span>
        ) : undefined
      }
    />
  );
}
