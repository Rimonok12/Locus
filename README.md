# ◎ Locus

**Issue tracking at the speed of thought.** Locus is a real-time, keyboard-first issue tracker for software teams, in the spirit of Linear. It is built with Next.js 14, TypeScript, Tailwind CSS and Supabase (Postgres, Auth, Realtime and Storage).

**Live:** https://locus-navy.vercel.app

## Features

- **Accounts & workspaces**
  - Sign in with email + password (magic-link sign-in turns on once custom SMTP is configured).
  - Multiple workspaces per user, with invite links (open or email-bound) and admin/member roles.
- **Teams**
  - Per-team issue identifiers (`ENG-123`) and a customizable workflow (Backlog → Todo → In Progress → In Review → Done → Canceled).
  - Team labels, members and cycles.
- **Issues**
  - Rich-text descriptions with Markdown shortcuts, task lists, images and @mentions.
  - Status, priority, assignee, labels, project, milestone, cycle, estimate and due date.
  - Sub-issues, relations (blocks / related / duplicate), comments with threads and reactions, and a full activity history.
  - Subscriptions, archive, and delete with undo.
- **List & board views**
  - Group by status, assignee, project, priority, cycle, label or team.
  - Ordering, filters, display properties and completed-issue windows.
  - Drag & drop on the board, multi-select and bulk actions.
- **Projects**
  - Status, health, lead, members, teams, start/target dates, milestones and progress.
  - Project updates that notify the team.
- **Cycles**: time-boxed sprints with progress, a burn-up chart and rollover of unfinished work.
- **Inbox**: notifications for assignments, mentions, comments and status changes. Read/unread, snooze and archive.
- **Saved views & favorites**: save any filter + display combination; pin issues, projects, cycles, views and teams.
- **Command menu (⌘K)** and a keyboard-first design:
  - Global: `C` create, `/` search, `G` then `I`/`M`/`P`/`V` to navigate.
  - Lists: `J`/`K` to move, `X` to select.
  - Issues: `S`/`P`/`A`/`L` to set properties, `?` for every shortcut.
- **Real-time & instant**
  - Optimistic local writes with automatic rollback.
  - Supabase Realtime pushes every change to all collaborators.
  - The IndexedDB snapshot makes reloads instant.
- **Light & dark themes** built on one four-color ramp (`#F9F7F7` · `#DBE2EF` · `#3F72AF` · `#112D4E`, navy in dark mode), responsive down to phone width.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) + React 18, TypeScript strict |
| Data | Supabase Postgres with row-level security on every table, triggers and RPCs |
| Auth | Supabase Auth via `@supabase/ssr` (cookie sessions, middleware refresh) |
| Realtime | Supabase Realtime `postgres_changes` → client sync engine (zustand) |
| Editor | Tiptap v3 |
| Drag & drop | dnd-kit |
| Command menu | cmdk |
| Styling | Tailwind CSS + CSS variables (light/dark tokens) |

Architecture notes live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Database highlights (`supabase/migrations`)

- **Multi-tenant RLS.** Every row carries `workspace_id`, and a security-definer helper decides membership. `workspace_id` is derived server-side from the parent row, so clients can't write across tenants.
- **Integrity in triggers:**
  - per-team issue numbering with row locks
  - state/team/cycle/label/assignee validation
  - circular-parent detection
  - lifecycle timestamps
  - last-admin protection
- **Activity & notifications are generated in Postgres.** History rows, subscriptions, @mention parsing and notification fan-out can't be forged by clients.
- **Tested.** `npm run db:test` runs the migrations against an in-process Postgres (PGlite) with a Supabase auth shim and checks 174 tenancy, upgrade-path and behavior assertions.

## Run locally

```bash
npm install
cp .env.example .env.local      # fill in your Supabase URL + anon key
npm run db:migrate              # needs DATABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local
npm run dev                     # http://localhost:3456
```

Supabase Auth settings:
- **Site URL:** your deployment's origin.
- **Redirect URLs:** `http://localhost:3456/**` and `https://<your-domain>/**`.

Turn off **Confirm email** for instant sign-up. Supabase's built-in mailer only delivers to your own project team. For magic links and password-reset emails to everyone, configure custom SMTP and set `NEXT_PUBLIC_AUTH_EMAILS=on`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3456 |
| `npm run build` / `start` | Production build / server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:test` | Database test suite (PGlite) |
| `npm run db:migrate` | Apply pending migrations to your Supabase project |

## Author

**Rimon Debnath**, Software Engineer (AI & Full-Stack)
Portfolio: https://rimon-portfolio.vercel.app · GitHub: [@Rimonok12](https://github.com/Rimonok12) · LinkedIn: [rimon12](https://linkedin.com/in/rimon12)
