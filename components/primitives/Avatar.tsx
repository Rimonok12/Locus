"use client";
/* ─── Locus · avatars ─── */

import { useSync } from "@/lib/sync/store";
import { displayName } from "@/lib/model";
import type { Profile } from "@/lib/types";

function hueOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function initialsOf(p: Profile | undefined) {
  const n = displayName(p);
  const parts = n.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({
  profile, userId, size = 20, className = "", ring = false,
}: { profile?: Profile | null; userId?: string | null; size?: number; className?: string; ring?: boolean }) {
  const fromStore = useSync((s) => (userId ? s.profiles[userId] : undefined));
  const p = profile ?? fromStore;
  const style = { width: size, height: size, fontSize: Math.max(8, size * 0.42) } as const;
  const ringCls = ring ? "ring-2 ring-[var(--canvas)]" : "";
  if (!p) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-faint ${ringCls} ${className}`}
        style={style}
        title="Unassigned"
      />
    );
  }
  if (p.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.avatar_url} alt={displayName(p)} title={displayName(p)} className={`shrink-0 rounded-full object-cover ${ringCls} ${className}`} style={style} />;
  }
  const hue = hueOf(p.id);
  return (
    <span
      title={displayName(p)}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${ringCls} ${className}`}
      style={{ ...style, background: `linear-gradient(135deg, hsl(${hue} 58% 56%), hsl(${(hue + 28) % 360} 60% 44%))` }}
    >
      {initialsOf(p)}
    </span>
  );
}

export function AvatarStack({ userIds, size = 18, max = 4 }: { userIds: string[]; size?: number; max?: number }) {
  const shown = userIds.slice(0, max);
  return (
    <span className="inline-flex items-center">
      {shown.map((id, i) => (
        <span key={id} style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <Avatar userId={id} size={size} ring />
        </span>
      ))}
      {userIds.length > max && <span className="ml-1 text-xxs text-faint">+{userIds.length - max}</span>}
    </span>
  );
}
