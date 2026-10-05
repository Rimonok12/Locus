"use client";
/* ─── Locus · project property menus and chips ───────────────────────────────
   Value-based menus (status, health, lead, members, teams, dates, icon/color)
   and the controlled <ProjectPropertyChips/> row shared by the create modal
   and the project overview.
   ──────────────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import { CalendarDays, Check, Flag, UserRound, Users } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import {
  COLORS, HEALTH, HEALTH_LABEL, PROJECT_STATUSES, PROJECT_STATUS_LABEL, PRIORITY_LABEL, displayName, useMembers, useTeams,
} from "@/lib/model";
import { formatDate, localToday, timeAgo } from "@/lib/format";
import { SelectMenu, type MenuItem } from "@/components/primitives/SelectMenu";
import { DatePicker } from "@/components/primitives/DatePicker";
import { Avatar, AvatarStack } from "@/components/primitives/Avatar";
import { HealthDot, PriorityIcon, ProjectIcon, ProjectStatusIcon, TeamIcon } from "@/components/primitives/icons";
import { PriorityMenu } from "@/components/pickers";
import { ChipDropdown, PROJECT_EMOJIS, isClosed, toggleIn } from "./shared";
import type { Health, Priority, Project, ProjectStatus, ProjectUpdate } from "@/lib/types";

const NONE = "__none";

/* ═══ menus ═══ */

export function ProjectStatusMenu({ value, onChange }: { value: ProjectStatus | null; onChange: (s: ProjectStatus) => void }) {
  const items: MenuItem[] = PROJECT_STATUSES.map((s, i) => ({
    id: s.value, label: s.label, icon: <ProjectStatusIcon status={s.value} />, hint: i + 1,
  }));
  return <SelectMenu items={items} selected={value} onSelect={(id) => onChange(id as ProjectStatus)} placeholder="Change status…" />;
}

export function HealthMenu({ value, onChange, latest }: { value: Health | null; onChange: (h: Health | null) => void; latest?: ProjectUpdate }) {
  const items: MenuItem[] = [
    ...HEALTH.map((h, i) => ({ id: h.value, label: h.label, icon: <HealthDot health={h.value} />, hint: i + 1 })),
    { id: NONE, label: "No health", icon: <HealthDot health={null} /> },
  ];
  return (
    <SelectMenu
      items={items}
      selected={value ?? NONE}
      onSelect={(id) => onChange(id === NONE ? null : (id as Health))}
      placeholder="Set health…"
      footer={
        latest ? (
          <span className="flex items-center gap-1.5">
            Latest update: <HealthDot health={latest.health} size={6} /> {HEALTH_LABEL[latest.health]} · {timeAgo(latest.created_at)}
          </span>
        ) : (
          "Posting an update sets the project health."
        )
      }
    />
  );
}

export function LeadMenu({ value, onChange }: { value: string | null; onChange: (userId: string | null) => void }) {
  const members = useMembers();
  const me = useSync((s) => s.userId);
  const items: MenuItem[] = useMemo(() => [
    { id: NONE, label: "No lead", icon: <UserRound size={14} className="text-faint" /> },
    ...[...members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0)).map((p) => ({
      id: p.id, label: p.id === me ? `${displayName(p)} (you)` : displayName(p), icon: <Avatar profile={p} size={16} />,
      keywords: [p.email, p.display_name],
    })),
  ], [members, me]);
  return <SelectMenu items={items} selected={value ?? NONE} onSelect={(id) => onChange(id === NONE ? null : id)} placeholder="Set project lead…" />;
}

export function MembersMenu({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const members = useMembers();
  const me = useSync((s) => s.userId);
  const items: MenuItem[] = useMemo(() => [...members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0)).map((p) => ({
    id: p.id, label: p.id === me ? `${displayName(p)} (you)` : displayName(p), icon: <Avatar profile={p} size={16} />,
    keywords: [p.email, p.display_name],
  })), [members, me]);
  return (
    <SelectMenu
      multi
      items={items}
      selected={value}
      onSelect={(id) => onChange(toggleIn(value, id))}
      placeholder="Add members…"
      digitShortcuts={false}
      emptyText="No matching members"
    />
  );
}

export function TeamsMenu({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const teams = useTeams();
  const items: MenuItem[] = teams.map((t) => ({ id: t.id, label: t.name, icon: <TeamIcon team={t} size={16} />, hint: t.key, keywords: [t.key] }));
  return (
    <SelectMenu
      multi
      items={items}
      selected={value}
      onSelect={(id) => onChange(toggleIn(value, id))}
      placeholder="Add teams…"
      digitShortcuts={false}
      emptyText="No matching teams"
    />
  );
}

/** Calendar + clear. `min` / `max` (inclusive ISO dates) disable days outside the range. */
export function DateMenu({
  value, onChange, min, max, clearLabel = "Remove date",
}: { value: string | null; onChange: (d: string | null) => void; min?: string | null; max?: string | null; clearLabel?: string }) {
  return (
    <div className="w-full">
      <div className="p-2">
        <DatePicker value={value} onChange={onChange} min={min ?? undefined} max={max ?? undefined} />
      </div>
      {value && (
        <div className="border-t border-line p-1">
          <button type="button" onClick={() => onChange(null)} className="flex h-8 w-full items-center rounded-md px-2 text-[13px] text-danger hover:bg-wash">
            {clearLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/** Emoji grid + color swatches. */
export function IconColorPicker({
  icon, color, onChange,
}: { icon: string | null; color: string; onChange: (patch: { icon?: string | null; color?: string }) => void }) {
  return (
    <div className="w-full p-2.5">
      <div className="mb-1.5 text-xxs font-medium text-faint">Color</div>
      <div className="mb-3 grid grid-cols-6 gap-1.5 sm:grid-cols-12 sm:gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => onChange({ color: c })}
            className="focus-ring flex h-8 items-center justify-center rounded-md hover:bg-wash sm:h-6"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: c }}>
              {color.toLowerCase() === c && <Check size={10} strokeWidth={3} className="text-white" />}
            </span>
          </button>
        ))}
      </div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xxs font-medium text-faint">Icon</span>
        <button
          type="button"
          onClick={() => onChange({ icon: null })}
          aria-pressed={!icon}
          className={`focus-ring flex h-8 items-center gap-1.5 rounded px-1.5 text-xxs transition-colors hover:bg-wash sm:h-6 ${icon ? "text-dim" : "bg-wash text-ink"}`}
        >
          <ProjectIcon icon={null} color={color} size={12} /> No icon
        </button>
      </div>
      <div className="grid grid-cols-8 gap-0.5">
        {PROJECT_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`Icon ${e}`}
            onClick={() => onChange({ icon: e })}
            className={`focus-ring flex h-8 items-center justify-center rounded-md text-[17px] leading-none transition-colors hover:bg-wash ${icon === e ? "bg-accent-soft" : ""}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══ controlled chips row ═══ */

export type ProjectFields = Pick<Project, "status" | "priority" | "lead_id" | "member_ids" | "team_ids" | "start_date" | "target_date">;

/**
 * Status · (Health) · Priority · Lead · Members · Teams · Start · Target.
 * Pass `health` (+ `latestUpdate`) to include the health chip (overview only).
 */
export function ProjectPropertyChips({
  value, onChange, health, latestUpdate,
}: {
  value: ProjectFields;
  onChange: (patch: Partial<Project>) => void;
  health?: { value: Health | null };
  latestUpdate?: ProjectUpdate;
}) {
  const profiles = useSync((s) => s.profiles);
  const teamsMap = useSync((s) => s.teams);
  const lead = value.lead_id ? profiles[value.lead_id] : undefined;
  const teams = value.team_ids.map((id) => teamsMap[id]).filter((t) => t && !t.archived_at);
  const overdue = Boolean(value.target_date && value.target_date < localToday() && !isClosed(value));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ChipDropdown title="Status" icon={<ProjectStatusIcon status={value.status} />} label={PROJECT_STATUS_LABEL[value.status]} width={240}>
        {(close) => <ProjectStatusMenu value={value.status} onChange={(s) => { onChange({ status: s }); close(); }} />}
      </ChipDropdown>

      {health && (
        <ChipDropdown
          title="Health"
          icon={<HealthDot health={health.value} />}
          label={health.value ? HEALTH_LABEL[health.value] : latestUpdate ? "No health" : "No updates"}
          empty={!health.value}
          width={260}
        >
          {(close) => <HealthMenu value={health.value} latest={latestUpdate} onChange={(h) => { onChange({ health: h }); close(); }} />}
        </ChipDropdown>
      )}

      <ChipDropdown
        title="Priority"
        icon={<PriorityIcon priority={value.priority} className={value.priority ? "text-dim" : "text-faint"} />}
        label={value.priority ? PRIORITY_LABEL[value.priority] : "Priority"}
        empty={!value.priority}
        width={220}
      >
        {(close) => <PriorityMenu value={value.priority} onChange={(p: Priority) => { onChange({ priority: p }); close(); }} />}
      </ChipDropdown>

      <ChipDropdown
        title="Lead"
        icon={lead ? <Avatar profile={lead} size={16} /> : <UserRound size={14} className="text-faint" />}
        label={lead ? displayName(lead) : "Lead"}
        empty={!lead}
        width={260}
      >
        {(close) => <LeadMenu value={value.lead_id} onChange={(u) => { onChange({ lead_id: u }); close(); }} />}
      </ChipDropdown>

      <ChipDropdown
        title="Members"
        icon={value.member_ids.length ? <AvatarStack userIds={value.member_ids} size={16} max={3} /> : <Users size={14} className="text-faint" />}
        label={value.member_ids.length ? `${value.member_ids.length} member${value.member_ids.length === 1 ? "" : "s"}` : "Members"}
        empty={!value.member_ids.length}
        width={260}
      >
        {() => <MembersMenu value={value.member_ids} onChange={(ids) => onChange({ member_ids: ids })} />}
      </ChipDropdown>

      <ChipDropdown
        title="Teams"
        icon={
          teams.length ? (
            <span className="flex items-center">
              {teams.slice(0, 3).map((t, i) => (
                <span key={t.id} className="rounded-[6px] ring-2 ring-[var(--surface)]" style={{ marginLeft: i ? -4 : 0 }}><TeamIcon team={t} size={16} /></span>
              ))}
            </span>
          ) : <Users size={14} className="text-faint" />
        }
        label={teams.length === 1 ? teams[0].name : teams.length ? `${teams.length} teams` : "Teams"}
        empty={!teams.length}
        width={260}
      >
        {() => <TeamsMenu value={value.team_ids} onChange={(ids) => onChange({ team_ids: ids })} />}
      </ChipDropdown>

      <ChipDropdown
        title="Start date"
        icon={<CalendarDays size={13} className={value.start_date ? "text-dim" : "text-faint"} />}
        label={value.start_date ? formatDate(value.start_date) : "Start date"}
        empty={!value.start_date}
        width={256}
      >
        {(close) => (
          <DateMenu
            value={value.start_date}
            max={value.target_date}
            onChange={(d) => { onChange({ start_date: d }); close(); }}
            clearLabel="Remove start date"
          />
        )}
      </ChipDropdown>

      <ChipDropdown
        title="Target date"
        icon={<Flag size={13} className={overdue ? "text-danger" : value.target_date ? "text-dim" : "text-faint"} />}
        label={value.target_date ? formatDate(value.target_date) : "Target date"}
        empty={!value.target_date}
        tone={overdue ? "danger" : undefined}
        width={256}
      >
        {(close) => (
          <DateMenu
            value={value.target_date}
            min={value.start_date}
            onChange={(d) => { onChange({ target_date: d }); close(); }}
            clearLabel="Remove target date"
          />
        )}
      </ChipDropdown>
    </div>
  );
}
