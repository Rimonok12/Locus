"use client";
/* ─── Locus · one inbox notification row ─── */

import { memo, useState, type ReactNode } from "react";
import {
  AlarmClock, AlarmClockOff, Archive, AtSign, CircleDot, Hexagon, Mail, MailOpen, MessageSquare, MoreHorizontal,
  Sunrise, CalendarClock, UserMinus, UserPlus,
} from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { HEALTH_LABEL, displayName } from "@/lib/model";
import { timeAgo } from "@/lib/format";
import { Avatar } from "@/components/primitives/Avatar";
import { IconButton } from "@/components/primitives/controls";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import { HealthDot, PriorityIcon, ProjectIcon } from "@/components/primitives/icons";
import { StateGlyph } from "@/components/pickers";
import type { Health, Notification } from "@/lib/types";
import { snoozePresets, snoozedUntilLabel, type InboxTab } from "./util";

const TYPE_ICON: Record<Notification["type"], ReactNode> = {
  assigned: <UserPlus size={9} strokeWidth={2.4} />,
  unassigned: <UserMinus size={9} strokeWidth={2.4} />,
  comment: <MessageSquare size={9} strokeWidth={2.4} />,
  mention: <AtSign size={9} strokeWidth={2.4} />,
  status: <CircleDot size={9} strokeWidth={2.4} />,
  priority: <PriorityIcon priority={1} size={10} />,
  project_update: <Hexagon size={9} strokeWidth={2.4} />,
};

/** "assigned you", "changed status to Done", "posted an update · On track" … */
export function NotificationSentence({ n }: { n: Notification }) {
  const data = n.data ?? {};
  switch (n.type) {
    case "assigned": return <>assigned you</>;
    case "unassigned": return <>unassigned you</>;
    case "comment": return <>commented</>;
    case "mention": return <>mentioned you</>;
    case "status": {
      const to = typeof data.to === "string" ? data.to : null;
      return to ? <>changed status to <span className="text-ink">{to}</span></> : <>changed the status</>;
    }
    case "priority": return <>marked as <span className="text-ink">Urgent</span></>;
    case "project_update": {
      const health = (typeof data.health === "string" ? data.health : null) as Health | null;
      return (
        <>
          posted an update
          {health && HEALTH_LABEL[health] && (
            <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-ink">
              <HealthDot health={health} size={7} />{HEALTH_LABEL[health]}
            </span>
          )}
        </>
      );
    }
  }
}

export interface InboxRowProps {
  n: Notification;
  selected: boolean;
  tab: InboxTab;
  /** clock tick so relative times stay fresh */
  tick: number;
  /** the snooze popover is anchored to this row */
  menuOpen: boolean;
  register: (id: string, el: HTMLDivElement | null) => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  onToggleRead: (id: string) => void;
  onSnooze: (id: string, anchor: HTMLElement) => void;
  onSnoozeUntil: (id: string, until: Date) => void;
  onUnsnooze: (id: string) => void;
}

function InboxRowImpl({
  n, selected, tab, menuOpen, register, onSelect, onArchive, onToggleRead, onSnooze, onSnoozeUntil, onUnsnooze,
}: InboxRowProps) {
  const issue = useSync((s) => (n.issue_id ? s.issues[n.issue_id] : undefined));
  const project = useSync((s) => (n.project_id ? s.projects[n.project_id] : undefined));
  const teamKey = useSync((s) => (issue ? s.teams[issue.team_id]?.key : undefined));
  const actor = useSync((s) => (n.actor_id ? s.profiles[n.actor_id] : undefined));
  const [mobileMenu, setMobileMenu] = useState(false);

  const unread = !n.read_at;
  const key = issue && teamKey && issue.number ? `${teamKey}-${issue.number}` : null;
  const title = issue?.title ?? project?.name ?? (n.issue_id ? "Issue unavailable" : n.project_id ? "Project unavailable" : "Notification");
  const actorName = n.actor_id ? displayName(actor) : "Locus";
  const actionsVisible = menuOpen || mobileMenu;
  const snoozedTab = tab === "snoozed";

  return (
    <div
      ref={(el) => register(n.id, el)}
      role="option"
      aria-selected={selected}
      data-id={n.id}
      onClick={() => onSelect(n.id)}
      className={`group relative flex cursor-pointer select-none items-center gap-3 border-b border-line py-2.5 pl-5 pr-3 transition-colors md:pr-4 ${
        selected ? "bg-wash" : "hover:bg-wash"
      }`}
    >
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
      {unread && <span role="img" aria-label="Unread" className="absolute left-2 top-1/2 h-[6px] w-[6px] -translate-y-1/2 rounded-full bg-accent" />}

      <span className="relative shrink-0">
        {n.type === "project_update" && project && !actor
          ? <span className="flex h-7 w-7 items-center justify-center rounded-full bg-raised"><ProjectIcon icon={project.icon} color={project.color} size={14} /></span>
          : <Avatar userId={n.actor_id} size={28} />}
        <span className="absolute -bottom-0.5 -right-1 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-surface text-dim ring-1 ring-line">
          {TYPE_ICON[n.type]}
        </span>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {issue && <span className="shrink-0"><StateGlyph stateId={issue.state_id} size={13} /></span>}
          {!issue && project && <span className="shrink-0"><ProjectIcon icon={project.icon} color={project.color} size={13} /></span>}
          <span className={`min-w-0 flex-1 truncate text-[13px] ${unread ? "font-semibold text-ink" : "text-dim"}`}>{title}</span>
          <span className={`shrink-0 text-xxs tabular-nums text-faint ${actionsVisible ? "md:[@media(hover:hover)]:invisible" : "md:[@media(hover:hover)]:group-hover:invisible"}`}>
            {snoozedTab && n.snoozed_until
              ? <span className="inline-flex items-center gap-1"><AlarmClock size={11} />{snoozedUntilLabel(n.snoozed_until)}</span>
              : timeAgo(n.created_at)}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-faint">
          {key && <span className="shrink-0 tabular-nums">{key}</span>}
          {key && <span className="shrink-0">·</span>}
          <span className="min-w-0 truncate">
            <span className={unread ? "text-ink" : "text-dim"}>{actorName}</span>{" "}
            <NotificationSentence n={n} />
          </span>
        </div>
      </div>

      {/* hover actions: md+ with a pointer that can hover (touch tablets use the "…" menu) */}
      <div
        className={`absolute right-2 top-2 hidden items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 shadow-card ${
          actionsVisible ? "md:[@media(hover:hover)]:flex" : "md:[@media(hover:hover)]:group-hover:flex"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton size={26} label={unread ? "Mark as read (U)" : "Mark as unread (U)"} onClick={() => onToggleRead(n.id)}>
          {unread ? <MailOpen size={14} /> : <Mail size={14} />}
        </IconButton>
        {snoozedTab ? (
          <IconButton size={26} label="Unsnooze" onClick={() => onUnsnooze(n.id)}><AlarmClockOff size={14} /></IconButton>
        ) : (
          <IconButton size={26} label="Snooze (H)" active={menuOpen} onClick={(e) => onSnooze(n.id, e.currentTarget.closest("[role='option']") as HTMLElement)}>
            <AlarmClock size={14} />
          </IconButton>
        )}
        <IconButton size={26} label="Archive (E)" onClick={() => onArchive(n.id)}><Archive size={14} /></IconButton>
      </div>

      {/* touch actions: below md, and on any screen without hover */}
      <div className="shrink-0 md:[@media(hover:hover)]:hidden" onClick={(e) => e.stopPropagation()}>
        <Dropdown
          align="end"
          width={230}
          onOpenChange={setMobileMenu}
          trigger={(p) => (
            <IconButton ref={p.ref} onClick={p.onClick} aria-expanded={p["aria-expanded"]} size={32} label="Notification actions">
              <MoreHorizontal size={16} />
            </IconButton>
          )}
        >
          {(close) => (
            <ActionMenu
              onDone={close}
              items={[
                { id: "read", label: unread ? "Mark as read" : "Mark as unread", icon: unread ? <MailOpen size={14} /> : <Mail size={14} />, onSelect: () => onToggleRead(n.id) },
                ...(snoozedTab
                  ? [{ id: "unsnooze", label: "Unsnooze", icon: <AlarmClockOff size={14} />, onSelect: () => onUnsnooze(n.id) }]
                  : snoozePresets().map((p, i) => ({
                      id: `snooze-${p.id}`,
                      divider: i === 0,
                      label: `Snooze · ${p.label}`,
                      hint: p.hint,
                      icon: p.id === "hour" ? <AlarmClock size={14} /> : p.id === "tomorrow" ? <Sunrise size={14} /> : <CalendarClock size={14} />,
                      onSelect: () => onSnoozeUntil(n.id, p.until),
                    }))),
                { id: "archive", divider: true, label: "Archive", icon: <Archive size={14} />, onSelect: () => onArchive(n.id) },
              ]}
            />
          )}
        </Dropdown>
      </div>
    </div>
  );
}

const InboxRow = memo(InboxRowImpl);
export default InboxRow;
