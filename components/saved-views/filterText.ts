"use client";
/* ─── Locus · human-readable filter descriptions ("Status is In Progress") ─── */

import { useCallback } from "react";
import { useSync } from "@/lib/sync/store";
import { PRIORITY_LABEL, STATE_TYPE_LABEL, displayName } from "@/lib/model";
import { cycleTitle } from "@/components/cycles/util";
import type { Filter, FilterField, Priority, StateType } from "@/lib/types";

export const FIELD_LABEL: Record<FilterField, string> = {
  status: "Status", state_type: "Status type", assignee: "Assignee", creator: "Creator", priority: "Priority",
  label: "Label", project: "Project", cycle: "Cycle", team: "Team", estimate: "Estimate", due: "Due date",
};

const NONE_LABEL: Record<FilterField, string> = {
  status: "No status", state_type: "No status", assignee: "No assignee", creator: "No creator", priority: "No priority",
  label: "No labels", project: "No project", cycle: "No cycle", team: "No team", estimate: "No estimate", due: "No due date",
};

const DUE_LABEL: Record<string, string> = { overdue: "Overdue", today: "Due today", week: "Due this week", later: "Later" };

export function useFilterText() {
  const states = useSync((s) => s.workflow_states);
  const profiles = useSync((s) => s.profiles);
  const labels = useSync((s) => s.labels);
  const projects = useSync((s) => s.projects);
  const cycles = useSync((s) => s.cycles);
  const teams = useSync((s) => s.teams);

  const valueName = useCallback((field: FilterField, v: string): string => {
    if (v === "none") return NONE_LABEL[field];
    if (v === "me") return "Me";
    switch (field) {
      case "status": return states[v]?.name ?? "Deleted status";
      case "state_type": return STATE_TYPE_LABEL[v as StateType] ?? v;
      case "assignee":
      case "creator": return profiles[v] ? displayName(profiles[v]) : "Former member";
      case "priority": return PRIORITY_LABEL[Number(v) as Priority] ?? v;
      case "label": return labels[v]?.name ?? "Deleted label";
      case "project": return projects[v]?.name ?? "Deleted project";
      case "cycle": {
        if (v === "current") return "Current cycle";
        const c = cycles[v];
        if (!c) return "Deleted cycle";
        const key = teams[c.team_id]?.key;
        return key ? `${key} · ${cycleTitle(c)}` : cycleTitle(c);
      }
      case "team": return teams[v]?.name ?? "Deleted team";
      case "estimate": return `${v} pt${v === "1" ? "" : "s"}`;
      case "due": return DUE_LABEL[v] ?? v;
    }
  }, [states, profiles, labels, projects, cycles, teams]);

  const describe = useCallback((f: Filter): string => {
    const names = f.values.map((v) => valueName(f.field, v));
    if (!names.length) return FIELD_LABEL[f.field];
    const many = names.length > 1;
    const op = f.op === "is" ? (many ? "is any of" : "is") : (many ? "is none of" : "is not");
    const list = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
    return `${FIELD_LABEL[f.field]} ${op} ${list}`;
  }, [valueName]);

  const summarize = useCallback((filters: Filter[]): string => filters.map(describe).join(" · "), [describe]);

  return { describe, summarize, valueName };
}
