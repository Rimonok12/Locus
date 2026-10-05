"use client";
/* ─── Locus · snooze presets menu (H in the inbox, row hover action) ─── */

import { useMemo } from "react";
import { AlarmClock, CalendarClock, Sunrise } from "lucide-react";
import { SelectMenu, type MenuItem } from "@/components/primitives/SelectMenu";
import { snoozePresets } from "./util";

const ICONS: Record<string, JSX.Element> = {
  hour: <AlarmClock size={14} className="text-dim" />,
  tomorrow: <Sunrise size={14} className="text-dim" />,
  week: <CalendarClock size={14} className="text-dim" />,
};

export default function SnoozeMenu({ onPick }: { onPick: (until: Date) => void }) {
  const presets = useMemo(() => snoozePresets(), []);
  const items: MenuItem[] = presets.map((p) => ({ id: p.id, label: p.label, hint: p.hint, icon: ICONS[p.id] }));
  return (
    <SelectMenu
      items={items}
      onSelect={(id) => {
        const p = presets.find((x) => x.id === id);
        if (p) onPick(p.until);
      }}
      placeholder="Snooze until…"
      footer={<span>Snoozed notifications come back to your inbox when the time is up.</span>}
    />
  );
}
