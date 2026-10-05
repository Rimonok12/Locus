# Locus — architecture

Locus is a real-time, multi-tenant issue tracker (Linear-style) built on **Next.js 14 (App Router) + Supabase** (Postgres, Auth, Realtime, Storage).

## Layers

| Layer | Files | Notes |
|---|---|---|
| Database | `supabase/migrations/*.sql` | Schema, RLS, triggers (numbering, validation, history, notifications), RPCs. Tested by `npm run db:test` (PGlite). |
| Auth / session | `middleware.ts`, `lib/supabase/{client,server}.ts`, `app/auth/*` | Cookie sessions via `@supabase/ssr`. Middleware refreshes the session and guards routes. |
| Sync engine | `lib/sync/store.ts` | Zustand store with one entity map per table (`useSync(s => s.issues)`), IndexedDB snapshot for instant boot, Supabase Realtime for live updates, generic optimistic `insert / update / updateMany / remove / removeMany / rpc`. |
| Domain actions | `lib/sync/actions.ts` | **All writes go through here** (createIssue, updateIssues, setIssuesState, deleteIssues with undo, comments, projects, cycles, labels, teams, states, views, favorites, notifications, profile, workspace, invites…). |
| Domain model | `lib/model.ts` | Constants (priorities, state types, project statuses, health, colors), selector hooks (`useMembers`, `useTeams`, `useTeamStates`, `useLabels`, `useProjects`, `useTeamCycles`, `useIssueByKey`, `useSubIssues`…), and the **issue query engine** `useIssueQuery` (scope → filters → completed window → sort → group). |
| UI state | `lib/ui.ts` | Overlays (palette, create-issue modal, picker dialog, shortcuts help, confirm), selection/focus/peek, per-view display + filter prefs, theme, toasts (`toast`, `toast.success`, `toast.error`). |
| Routing | `lib/router.ts` | The workspace is one client app mounted by `app/[slug]/layout.tsx`. `navigate(route)` uses `history.pushState`; `useRoute()` parses the URL; `linkProps(route)` gives `<a>` props that keep cmd-click working. |
| Primitives | `components/primitives/*` | `Button`, `IconButton`, `Input`, `Textarea`, `Field`, `Switch`, `Tooltip`, `Kbd`, `Spinner`, `EmptyState`, `Segmented`, `ProgressBar` (controls.tsx) · `Popover`, `Dropdown`, `Modal`, `Portal` (overlay.tsx) · `SelectMenu`, `ActionMenu` (SelectMenu.tsx) · `Avatar`, `AvatarStack` · `StateIcon`, `PriorityIcon`, `ProjectStatusIcon`, `HealthDot`, `LabelDot`, `TeamIcon`, `ProjectIcon`, `ProgressRing`, `LocusMark` (icons.tsx) · `DatePicker`. |
| Pickers | `components/pickers.tsx` | Value menus (`StatusMenu`, `PriorityMenu`, `AssigneeMenu`, `LabelsMenu`, `ProjectMenu`, `MilestoneMenu`, `CycleMenu`, `EstimateMenu`, `TeamMenu`, `DueDateMenu`, `ParentMenu`), `IssuePicker` (bulk apply to issue ids), `PropertyChip` (anchored trigger bound to one issue field), `LabelPills`, `StateGlyph`. |
| Shell | `components/app/*` | `WorkspaceApp` (bootstrap), `Shell` (layout + overlays), `Sidebar`, `ViewHeader` + `HeaderTab` (every view starts with a `ViewHeader`), `RouteView`, `Toaster`, `ConfirmDialog`. |

## URL map (inside `/:workspaceSlug/`)

`inbox` · `my-issues/{assigned|created|subscribed|activity}` · `team/:KEY/{all|active|backlog}` · `team/:KEY/cycles` · `team/:KEY/cycle/{n|current}` · `team/:KEY/projects` · `projects/{all|started|planned|backlog|completed}` · `project/:id/{overview|issues|updates}` · `issue/:KEY-123` · `views` · `view/:id` · `search?q=` · `settings/{account|preferences|workspace|members|teams|labels}` · `settings/teams/:KEY`

Public routes: `/` (landing or redirect), `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/onboarding`, `/join/:token`, `/auth/callback`, `/auth/confirm`, `/setup` (shown when env is missing).

## Conventions

- **Reads** come from `useSync` selectors — select the narrowest slice (`useSync(s => s.issues[id])`), never the whole store.
- **Writes** go through `lib/sync/actions.ts`. They are optimistic; failures revert and toast automatically. Never call `supabase().from(...)` from components.
- Issue lists/boards: build with `useIssueQuery({ viewKey, scope, defaults, teamId })` and render `<IssuesSurface query viewKey createDefaults />` with `<FilterButton/> <DisplayMenu/>` in the header `actions` and `<FilterBar/>` in the header `sub`.
- Identifiers: `issueKey(issue)` → `ENG-123`. Navigate with `navigate({ kind: "issue", identifier })`.
- Rich text is HTML produced by the editor (`components/editor/Editor.tsx`); render read-only with `<RichText html/>`. Mentions are `<span data-type="mention" data-id="<userId>">` — the DB notifies mentioned users.
- Design tokens (Tailwind colors): `canvas sidebar surface raised line line-strong ink dim faint accent accent-hover accent-ink accent-soft wash danger success warning`. Font sizes: `text-xxs` (11px), `text-[12.5px]`, `text-[13px]` (base), `text-[14px]`. Rows are 36–40px, headers 48px. Shadows: `shadow-pop` (menus), `shadow-modal`, `shadow-card`. Motion classes: `anim-pop anim-fade anim-modal anim-slide`.
- Mobile: everything must work at 375px. The sidebar becomes a drawer (`ViewHeader` shows the menu button). Hide secondary columns with `hidden sm:flex` / `md:` breakpoints; side panels become full-screen sheets below `md`.
- Keyboard-first: global shortcuts live in `components/overlays/useGlobalShortcuts.ts`; lists register `ui.setVisibleIds` / `ui.setFocused` so J/K, X, Enter, Space and property shortcuts (S, P, A, L…) act on `ui.targetIds()`.
