/* ─── Locus · migration runner ─────────────────────────────────────────────
   Applies supabase/migrations/*.sql in order, exactly once each, recording
   them in supabase_migrations.schema_migrations (same table the Supabase CLI
   uses, so `supabase db push` stays compatible later).

   Two transports, picked automatically from .env.local / the environment:
     DATABASE_URL            → direct Postgres connection (pg)
     SUPABASE_ACCESS_TOKEN   → Supabase Management API (project ref is read
                               from NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF)
   Usage: npm run db:migrate
   ───────────────────────────────────────────────────────────────────────── */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

for (const file of [".env.local", ".env"]) {
  const p = join(root, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const dir = join(root, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const BOOKKEEPING = `
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text
  );`;

async function viaPg(url) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });
  await client.connect();
  await client.query(BOOKKEEPING);
  const done = new Set((await client.query("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version));
  for (const f of files) {
    const version = f.split("_")[0];
    if (done.has(version)) { console.log(`· ${f} (already applied)`); continue; }
    const sql = readFileSync(join(dir, f), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [version, f.replace(/^\d+_|\.sql$/g, "")]);
      await client.query("commit");
      console.log(`✓ ${f}`);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`${f}: ${e.message}`);
    }
  }
  await client.end();
}

async function viaApi(token, ref) {
  const run = async (query) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${body}`);
    return body ? JSON.parse(body) : [];
  };
  await run(BOOKKEEPING);
  const done = new Set((await run("select version from supabase_migrations.schema_migrations")).map((r) => r.version));
  for (const f of files) {
    const version = f.split("_")[0];
    if (done.has(version)) { console.log(`· ${f} (already applied)`); continue; }
    const sql = readFileSync(join(dir, f), "utf8");
    const name = f.replace(/^\d+_|\.sql$/g, "");
    try {
      await run(`begin;\n${sql}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');\ncommit;`);
      console.log(`✓ ${f}`);
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
  }
}

const url = process.env.DATABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ||
  (process.env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

try {
  if (url) await viaPg(url);
  else if (token && ref) await viaApi(token, ref);
  else {
    console.error("Set DATABASE_URL, or SUPABASE_ACCESS_TOKEN + NEXT_PUBLIC_SUPABASE_URL, in .env.local");
    process.exit(1);
  }
  console.log("Migrations complete.");
} catch (e) {
  console.error(`Migration failed → ${e.message}`);
  process.exit(1);
}
