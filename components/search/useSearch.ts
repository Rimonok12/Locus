"use client";
/* ─── Locus · local search over issues and projects ──────────────────────────
   Ranking (lower is better):
     0 exact identifier (ENG-123, or a bare number)   1 identifier prefix
     2 title prefix   3 title substring   4 every word in the title
     5 description substring
   Ties break on most recently updated. Everything runs on the in-memory store.
   ──────────────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import { useSync } from "@/lib/sync/store";
import { issueKey } from "@/lib/model";
import { plainText } from "@/lib/format";
import type { Issue, Project } from "@/lib/types";

export const MAX_ISSUES = 200;
export const MAX_PROJECTS = 20;
export const RECENT = 20;

export interface IssueHit { issue: Issue; key: string; rank: number; snippet: string | null }
export interface ProjectHit { project: Project; rank: number }
export interface SearchResults { query: string; recent: boolean; issues: IssueHit[]; projects: ProjectHit[] }

/* plain-text descriptions are cached per issue object (rows are immutable) */
const descCache = new WeakMap<Issue, { raw: string; lower: string }>();
function descOf(i: Issue) {
  let d = descCache.get(i);
  if (!d) {
    const raw = i.description ? plainText(i.description, 100_000) : "";
    d = { raw, lower: raw.toLowerCase() };
    descCache.set(i, d);
  }
  return d;
}

function snippetAround(text: string, at: number, len: number): string {
  const start = Math.max(0, at - 48);
  const end = Math.min(text.length, at + len + 96);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function useSearch(rawQuery: string): SearchResults {
  const issues = useSync((s) => s.issues);
  const teams = useSync((s) => s.teams);
  const projects = useSync((s) => s.projects);

  const index = useMemo(
    () => Object.values(issues).filter((i) => !i.archived_at).map((i) => ({ issue: i, key: issueKey(i, teams), title: i.title.toLowerCase() })),
    [issues, teams],
  );

  return useMemo((): SearchResults => {
    const query = rawQuery.trim();
    if (!query) {
      const recent = [...index].sort((a, b) => b.issue.updated_at.localeCompare(a.issue.updated_at)).slice(0, RECENT)
        .map((e) => ({ issue: e.issue, key: e.key, rank: 0, snippet: null }));
      return { query, recent: true, issues: recent, projects: [] };
    }

    const lower = query.toLowerCase();
    const upper = query.toUpperCase();
    const words = lower.split(/\s+/).filter(Boolean);
    const numeric = /^\d+$/.test(query) ? Number(query) : null;
    const keyLike = /^[A-Z][A-Z0-9]*-\d*$/.test(upper);

    const hits: IssueHit[] = [];
    for (const e of index) {
      let rank = -1;
      let snippet: string | null = null;
      if (e.key === upper || (numeric !== null && e.issue.number === numeric)) rank = 0;
      else if (keyLike && e.key.startsWith(upper)) rank = 1;
      else if (e.title.startsWith(lower)) rank = 2;
      else if (e.title.includes(lower)) rank = 3;
      else if (words.length > 1 && words.every((w) => e.title.includes(w))) rank = 4;
      else {
        const d = descOf(e.issue);
        const at = d.lower.indexOf(lower);
        if (at >= 0) { rank = 5; snippet = snippetAround(d.raw, at, lower.length); }
      }
      if (rank >= 0) hits.push({ issue: e.issue, key: e.key, rank, snippet });
    }
    hits.sort((a, b) => a.rank - b.rank || b.issue.updated_at.localeCompare(a.issue.updated_at));

    const projectHits: ProjectHit[] = [];
    for (const p of Object.values(projects)) {
      if (p.archived_at) continue;
      const name = p.name.toLowerCase();
      const rank = name.startsWith(lower) ? 0 : name.includes(lower) ? 1
        : words.length > 1 && words.every((w) => name.includes(w)) ? 2
          : p.summary.toLowerCase().includes(lower) ? 3 : -1;
      if (rank >= 0) projectHits.push({ project: p, rank });
    }
    projectHits.sort((a, b) => a.rank - b.rank || a.project.name.localeCompare(b.project.name));

    return { query, recent: false, issues: hits.slice(0, MAX_ISSUES), projects: projectHits.slice(0, MAX_PROJECTS) };
  }, [index, projects, rawQuery]);
}
