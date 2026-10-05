/* ─── Locus · /setup — shown by middleware while Supabase env vars are missing (never calls Supabase) ─── */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ArrowRight, CircleCheck, CircleDashed, ExternalLink } from "lucide-react";
import { LocusMark } from "@/components/primitives/icons";
import { AuthGlow } from "@/components/auth/AuthCard";
import CopyButton from "@/components/auth/CopyButton";
import ThemeSync from "@/components/auth/ThemeSync";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/env";
import { buttonClass } from "@/components/auth/utils";

export const metadata: Metadata = { title: "Setup" };

const ENV_SNIPPET = `# Supabase project → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key>

# Optional: set to "on" once custom SMTP is configured in Supabase (enables magic-link sign-in)
NEXT_PUBLIC_AUTH_EMAILS=

# Optional: canonical origin for auth email redirects
NEXT_PUBLIC_SITE_URL=

# Migrations only (npm run db:migrate) — set one of these
DATABASE_URL=
SUPABASE_ACCESS_TOKEN=`;

const MIGRATE_SNIPPET = "npm run db:migrate";

function Code({ children, copy }: { children: string; copy?: string }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-raised">
      <div className="flex items-center justify-between border-b border-line py-0.5 pl-3 pr-1">
        <span className="text-xxs font-medium text-faint">{children.includes("\n") ? ".env.local" : "Terminal"}</span>
        <CopyButton text={copy ?? children} />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-[1.7] text-ink">{children}</pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-line-strong bg-surface text-[11.5px] font-semibold text-dim shadow-card">
        {n}
      </span>
      <h3 className="text-[14px] font-semibold leading-6 text-ink">{title}</h3>
      <div className="mt-1 text-[13px] leading-relaxed text-dim">{children}</div>
    </li>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded border border-line bg-wash px-1 py-px font-mono text-[12px] text-ink">{children}</code>;
}

export default function SetupPage() {
  const vars = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", required: true, set: Boolean(SUPABASE_URL), note: "Your project URL." },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, set: Boolean(SUPABASE_ANON_KEY), note: "The anon (or publishable) API key." },
    { name: "NEXT_PUBLIC_AUTH_EMAILS", required: false, set: process.env.NEXT_PUBLIC_AUTH_EMAILS === "on", note: "“on” once custom SMTP is set up — enables magic-link sign-in." },
    { name: "NEXT_PUBLIC_SITE_URL", required: false, set: Boolean(process.env.NEXT_PUBLIC_SITE_URL), note: "Production origin, e.g. https://locus.example.com." },
  ];

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-canvas text-ink">
      <ThemeSync />
      <AuthGlow />
      <header className="relative z-10 mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-4 sm:px-6">
        <LocusMark size={20} />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Locus</span>
        <span className="ml-1 rounded-full border border-line-strong px-2 py-px text-xxs font-medium text-faint">Setup</span>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6 sm:pt-14">
        <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]">Connect Locus to Supabase</h1>
        <p className="mt-3 max-w-[560px] text-[14px] leading-relaxed text-dim">
          Locus stores its data, accounts and real-time updates in a Supabase project.{" "}
          {isSupabaseConfigured
            ? "This deployment is connected. The steps below are here for reference when you set up another environment."
            : "You’re seeing this page because the required environment variables aren’t set for this deployment yet."}
        </p>

        {isSupabaseConfigured ? (
          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center">
            <CircleCheck size={18} className="shrink-0 text-success" />
            <p className="flex-1 text-[13px] text-ink">Supabase is configured. If you’ve run the migrations, you’re ready to go.</p>
            <a href="/" className={buttonClass("primary", "md")}>Open Locus <ArrowRight size={14} /></a>
          </div>
        ) : null}

        <section className="mt-8 overflow-hidden rounded-xl border border-line bg-surface shadow-card" aria-labelledby="env-heading">
          <h2 id="env-heading" className="border-b border-line px-4 py-3 text-[12.5px] font-medium text-dim">Environment</h2>
          <ul className="divide-y divide-line">
            {vars.map((v) => (
              <li key={v.name} className="flex items-start gap-3 px-4 py-3 sm:items-center">
                {v.set
                  ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-success sm:mt-0" aria-label="Set" />
                  : <CircleDashed size={15} className={`mt-0.5 shrink-0 sm:mt-0 ${v.required ? "text-warning" : "text-faint"}`} aria-label="Not set" />}
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                  <code className="block break-all font-mono text-[12.5px] text-ink sm:min-w-0 sm:flex-1 sm:truncate">{v.name}</code>
                  <span className="mt-0.5 block text-xxs text-faint sm:mt-0 sm:w-[240px] sm:shrink-0">{v.note}</span>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-px text-[10.5px] font-medium ${v.required ? "text-ink" : "text-faint"}`}
                  style={{ background: v.required ? "var(--accent-soft)" : "var(--wash)" }}
                >
                  {v.required ? "Required" : "Optional"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <ol className="mt-10 space-y-9">
          <Step n={1} title="Create a Supabase project">
            Create a free project at{" "}
            <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline">
              supabase.com/dashboard <ExternalLink size={11} />
            </a>
            , then open <span className="font-medium text-ink">Settings → API</span> for the project URL and anon key.
          </Step>

          <Step n={2} title="Add the environment variables">
            Locally, put them in <Mono>.env.local</Mono> at the repository root. On Vercel, add them under
            <span className="font-medium text-ink"> Project → Settings → Environment Variables</span>.
            <Code>{ENV_SNIPPET}</Code>
          </Step>

          <Step n={3} title="Run the database migrations">
            The migration runner applies <Mono>supabase/migrations/*.sql</Mono> in order and records each one. It needs either{" "}
            <Mono>DATABASE_URL</Mono> or <Mono>SUPABASE_ACCESS_TOKEN</Mono> in <Mono>.env.local</Mono>.
            <Code>{MIGRATE_SNIPPET}</Code>
            <p className="mt-3">
              Prefer the dashboard? Open the <span className="font-medium text-ink">SQL editor</span> and run each file in{" "}
              <Mono>supabase/migrations</Mono> in filename order.
            </p>
          </Step>

          <Step n={4} title="Configure authentication">
            In <span className="font-medium text-ink">Authentication → URL configuration</span>, set the Site URL to your
            deployment’s origin and add <Mono>http://localhost:3456/**</Mono> and <Mono>https://&lt;your-domain&gt;/**</Mono> as
            redirect URLs. Turn off <span className="font-medium text-ink">Confirm email</span> for instant sign-up, or configure custom SMTP
            first — Supabase’s built-in mailer only delivers to your own project team.
          </Step>

          <Step n={5} title="Restart or redeploy">
            <Mono>NEXT_PUBLIC_*</Mono> variables are read when the app is built. Restart <Mono>npm run dev</Mono>, or redeploy, and
            this page will hand you over to Locus.
          </Step>
        </ol>
      </main>
    </div>
  );
}
