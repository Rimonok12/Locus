"use client";
/* ─── Locus · search: issues (by ID, title, description) and projects ─── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { hrefFor, navigate, setQueryParam, useQueryParam, type Route } from "@/lib/router";
import { ViewHeader } from "@/components/app/Header";
import { EmptyState } from "@/components/primitives/controls";
import { IssueResultRow, ProjectResultRow } from "@/components/search/ResultRows";
import { MAX_ISSUES, useSearch } from "@/components/search/useSearch";
import { isActivatable, isTypingTarget, overlayOpen } from "@/components/inbox/hooks";

const DEBOUNCE_MS = 120;

export default function SearchView() {
  const param = useQueryParam("q") ?? "";
  const [text, setText] = useState(param);
  const [query, setQuery] = useState(param);
  const [active, setActive] = useState(0);
  const written = useRef(param);
  const keyboardMove = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // O(1) "is there anything at all" check (runs on every store change)
  const hasIssues = useSync((s) => {
    for (const id in s.issues) if (id) return true;
    return false;
  });

  // the URL changed from outside (command palette, back/forward)
  useEffect(() => {
    if (param === written.current) return;
    written.current = param;
    setText(param);
    setQuery(param);
  }, [param]);

  // debounce typing → results + ?q=
  useEffect(() => {
    if (text === query) return;
    const t = setTimeout(() => {
      setQuery(text);
      const next = text.trim() ? text : "";
      written.current = next;
      setQueryParam("q", next || null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, query]);

  const results = useSearch(query);
  const q = results.query;

  const routes = useMemo<Route[]>(
    () => [
      ...results.issues.map((h): Route => ({ kind: "issue", identifier: h.key })),
      ...results.projects.map((h): Route => ({ kind: "project", id: h.project.id, tab: "overview" })),
    ],
    [results],
  );
  const current = routes.length ? Math.min(active, routes.length - 1) : -1;

  useEffect(() => { setActive(0); }, [q]);

  useEffect(() => {
    if (!keyboardMove.current || current < 0) return;
    keyboardMove.current = false;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const live = useRef({ routes, current });
  live.current = { routes, current };

  const move = useCallback((delta: number) => {
    const { routes: r, current: c } = live.current;
    if (!r.length) return;
    keyboardMove.current = true;
    setActive(Math.min(r.length - 1, Math.max(0, c + delta)));
  }, []);

  const open = useCallback((newTab: boolean) => {
    const { routes: r, current: c } = live.current;
    const route = r[c];
    if (!route) return;
    if (newTab) window.open(hrefFor(route), "_blank", "noopener");
    else navigate(route);
  }, []);

  const clear = () => {
    setText("");
    setQuery("");
    written.current = "";
    setQueryParam("q", null);
    inputRef.current?.focus();
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); open(e.metaKey || e.ctrlKey); }
    else if (e.key === "Escape") {
      e.preventDefault();
      if (text) clear(); else inputRef.current?.blur();
    }
  };

  // when focus is elsewhere on the page: "/" back to the box, ↑ ↓ ↵ still drive the results
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || isTypingTarget(e.target) || overlayOpen()) return;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopImmediatePropagation();
        move(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter" && !isActivatable(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        open(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [move, open]);

  const total = results.issues.length + results.projects.length;
  const pending = text.trim() !== query.trim();

  return (
    <>
      <ViewHeader title="Search" icon={<Search size={15} className="text-dim" />} />

      <div className="shrink-0 border-b border-line px-4 pb-2.5 pt-3 md:px-6">
        <div className="relative flex items-center">
          <Search size={16} className="pointer-events-none absolute left-3 text-faint" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search issues and projects by title, description or ID…"
            aria-label="Search"
            role="combobox"
            aria-expanded={total > 0}
            aria-controls="search-results"
            aria-activedescendant={current >= 0 ? `search-result-${current}` : undefined}
            className="h-11 w-full rounded-lg border border-line-strong bg-surface pl-10 pr-11 text-[16px] text-ink shadow-card outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft md:text-[15px]"
          />
          {text && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clear}
              className="absolute right-1.5 flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-wash hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div className="mt-2 flex h-4 items-center justify-between gap-3 text-xxs text-faint">
          <span className={`truncate transition-opacity ${pending ? "opacity-60" : ""}`}>
            {results.recent
              ? "Recently updated issues"
              : total
                ? `${results.issues.length >= MAX_ISSUES ? `Top ${MAX_ISSUES}` : results.issues.length} issue${results.issues.length === 1 ? "" : "s"}${results.projects.length ? ` · ${results.projects.length} project${results.projects.length === 1 ? "" : "s"}` : ""}`
                : "No matches"}
          </span>
          <span className="hidden shrink-0 items-center gap-1 md:flex">
            <kbd>↑</kbd><kbd>↓</kbd> to move <kbd className="ml-1.5">↵</kbd> to open
          </span>
        </div>
      </div>

      <div ref={listRef} id="search-results" role="listbox" aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto">
        {results.recent ? (
          results.issues.length ? (
            <Group label="Recently updated" count={results.issues.length}>
              {results.issues.map((h, i) => (
                <IssueResultRow key={h.issue.id} hit={h} index={i} active={i === current} query="" onHover={setActive} showUpdated />
              ))}
            </Group>
          ) : (
            <EmptyState
              icon={<Search size={28} strokeWidth={1.5} />}
              title={hasIssues ? "Search your workspace" : "Nothing to search yet"}
              body={hasIssues ? "Find issues by ID, title or description, and projects by name." : "Issues and projects you create will be searchable here."}
            />
          )
        ) : total ? (
          <>
            {results.issues.length > 0 && (
              <Group label="Issues" count={results.issues.length}>
                {results.issues.map((h, i) => (
                  <IssueResultRow key={h.issue.id} hit={h} index={i} active={i === current} query={q} onHover={setActive} />
                ))}
              </Group>
            )}
            {results.projects.length > 0 && (
              <Group label="Projects" count={results.projects.length}>
                {results.projects.map((h, j) => {
                  const i = results.issues.length + j;
                  return <ProjectResultRow key={h.project.id} hit={h} index={i} active={i === current} query={q} onHover={setActive} />;
                })}
              </Group>
            )}
          </>
        ) : (
          <EmptyState
            icon={<Search size={28} strokeWidth={1.5} />}
            title={`No results for “${q}”`}
            body="Try a different word, or search by issue ID like ENG-123."
          />
        )}
      </div>
    </>
  );
}

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-line bg-raised px-4 text-[12px] font-medium text-dim md:px-6">
        {label}
        <span className="tabular-nums text-faint">{count}</span>
      </h2>
      {children}
    </section>
  );
}
