"use client";
/* ─── Locus · client store (zustand + localStorage persistence) ─── */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CYCLES, LABELS, ME, PROJECTS, SEED_ISSUES, SEED_NOTIFICATIONS, TEAMS, USERS,
  type Issue, type Notification, type Priority, type StatusId, type ViewId,
} from "./data";

interface LocusState {
  issues: Issue[];
  notifications: Notification[];
  nextNumber: number;

  view: ViewId;
  activeTeamId: string;
  selectedIssueId: string | null;
  paletteOpen: boolean;
  newIssueOpen: boolean;
  dark: boolean;
  filterAssignee: string | null;
  filterPriority: Priority | null;
  filterLabel: string | null;
  toast: string | null;

  setView: (v: ViewId, teamId?: string) => void;
  select: (id: string | null) => void;
  setPalette: (open: boolean) => void;
  setNewIssue: (open: boolean) => void;
  toggleDark: () => void;
  setFilters: (f: Partial<Pick<LocusState, "filterAssignee" | "filterPriority" | "filterLabel">>) => void;
  clearFilters: () => void;

  createIssue: (partial: Partial<Issue> & { title: string }) => Issue;
  updateIssue: (id: string, patch: Partial<Issue>) => void;
  deleteIssue: (id: string) => void;
  addComment: (id: string, body: string) => void;
  markNotification: (id: string, read: boolean) => void;
  markAllRead: () => void;
  showToast: (t: string) => void;
  resetDemo: () => void;
}

export const useLocus = create<LocusState>()(
  persist(
    (set, get) => ({
      issues: SEED_ISSUES,
      notifications: SEED_NOTIFICATIONS,
      nextNumber: 200,

      view: "issues",
      activeTeamId: "t1",
      selectedIssueId: null,
      paletteOpen: false,
      newIssueOpen: false,
      dark: false,
      filterAssignee: null,
      filterPriority: null,
      filterLabel: null,
      toast: null,

      setView: (v, teamId) =>
        set((s) => ({ view: v, activeTeamId: teamId ?? s.activeTeamId, selectedIssueId: null })),
      select: (id) => set({ selectedIssueId: id }),
      setPalette: (open) => set({ paletteOpen: open }),
      setNewIssue: (open) => set({ newIssueOpen: open }),
      toggleDark: () => set((s) => ({ dark: !s.dark })),
      setFilters: (f) => set(f),
      clearFilters: () => set({ filterAssignee: null, filterPriority: null, filterLabel: null }),

      createIssue: (partial) => {
        const s = get();
        const issue: Issue = {
          id: `i${Math.random().toString(36).slice(2, 9)}`,
          number: s.nextNumber,
          teamId: partial.teamId ?? s.activeTeamId,
          title: partial.title,
          description: partial.description ?? "",
          status: partial.status ?? "todo",
          priority: partial.priority ?? 0,
          assigneeId: partial.assigneeId ?? null,
          labelIds: partial.labelIds ?? [],
          projectId: partial.projectId ?? null,
          cycleId: partial.cycleId ?? null,
          estimate: partial.estimate ?? null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          comments: [],
        };
        set({ issues: [issue, ...s.issues], nextNumber: s.nextNumber + 1 });
        get().showToast(`Created ${teamKey(issue.teamId)}-${issue.number}`);
        return issue;
      },

      updateIssue: (id, patch) =>
        set((s) => ({
          issues: s.issues.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i)),
        })),

      deleteIssue: (id) =>
        set((s) => ({
          issues: s.issues.filter((i) => i.id !== id),
          selectedIssueId: s.selectedIssueId === id ? null : s.selectedIssueId,
        })),

      addComment: (id, body) =>
        set((s) => ({
          issues: s.issues.map((i) =>
            i.id === id
              ? { ...i, comments: [...i.comments, { id: `c${Date.now()}`, userId: ME, body, at: Date.now() }], updatedAt: Date.now() }
              : i
          ),
        })),

      markNotification: (id, read) =>
        set((s) => ({ notifications: s.notifications.map((x) => (x.id === id ? { ...x, read } : x)) })),
      markAllRead: () => set((s) => ({ notifications: s.notifications.map((x) => ({ ...x, read: true })) })),

      showToast: (t) => {
        set({ toast: t });
        setTimeout(() => set({ toast: null }), 2600);
      },
      resetDemo: () =>
        set({ issues: SEED_ISSUES, notifications: SEED_NOTIFICATIONS, nextNumber: 200, selectedIssueId: null }),
    }),
    {
      name: "locus-workspace-v1",
      partialize: (s) => ({
        issues: s.issues, notifications: s.notifications, nextNumber: s.nextNumber, dark: s.dark,
      }),
    }
  )
);

/* ─── lookups ─── */
export const teamById = (id: string) => TEAMS.find((t) => t.id === id)!;
export const teamKey = (id: string) => teamById(id)?.key ?? "LOC";
export const userById = (id: string | null) => USERS.find((u) => u.id === id) ?? null;
export const labelById = (id: string) => LABELS.find((l) => l.id === id)!;
export const projectById = (id: string | null) => PROJECTS.find((p) => p.id === id) ?? null;
export const cycleById = (id: string | null) => CYCLES.find((c) => c.id === id) ?? null;
export const identifier = (i: { teamId: string; number: number }) => `${teamKey(i.teamId)}-${i.number}`;
