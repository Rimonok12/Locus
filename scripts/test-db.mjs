/* ─── Locus · database test-suite ──────────────────────────────────────────
   Runs every migration in supabase/migrations against an in-process Postgres
   (PGlite) with a minimal Supabase auth shim, then exercises tenancy (RLS),
   numbering, validation, history and notification triggers as real users.
   A second database replays the production upgrade path: the early
   migrations, real data (including rows only the old schema allowed), then
   every later migration one transaction at a time, as scripts/migrate.mjs does.
   Usage: npm run db:test
   ───────────────────────────────────────────────────────────────────────── */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const db = new PGlite();

const PRELUDE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Supabase grants the API roles their own privileges on every object the migration role creates
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
};

/** Run SQL on `pg` as a signed-in user (or anon when userId is null), with RLS. */
function actor(pg) {
  const as = async (userId, sql, params = []) => {
    await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
    await pg.exec(userId ? "set role authenticated" : "set role anon");
    try {
      return await pg.query(sql, params);
    } finally {
      await pg.exec("reset role");
    }
  };
  const fails = async (userId, sql, params = []) => {
    try { await as(userId, sql, params); return null; }
    catch (e) { return e.message; }
  };
  return { as, fails };
}
const { as, fails } = actor(db);

// storage schema is Supabase-only
const MIGRATIONS = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql") && !f.includes("storage")).sort();
const migration = (f) => readFileSync(join(root, "supabase/migrations", f), "utf8");

await db.exec(PRELUDE);
for (const f of MIGRATIONS) {
  await db.exec(migration(f));
  console.log(`applied ${f}`);
}

const mk = async (email, name) =>
  (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, { name }])).rows[0].id;
const alice = await mk("alice@acme.dev", "Alice Liddell");
const bob = await mk("bob@acme.dev", "Bob Stone");
const carol = await mk("carol@else.dev", "Carol Outsider");

console.log("\nprofiles");
const prof = await as(alice, `select * from profiles`);
ok(prof.rows.length === 1 && prof.rows[0].name === "Alice Liddell", "profile auto-created from auth metadata; user sees only self before sharing a workspace");

console.log("\nworkspace bootstrap");
const ws = (await as(alice, `select * from create_workspace('Acme', 'acme', 'Engineering', 'ENG')`)).rows[0];
ok(ws.slug === "acme", "create_workspace returns the workspace");
const seeded = await as(alice, `select number, title from issues order by number`);
ok(seeded.rows.length === 4 && seeded.rows[0].number === 1 && seeded.rows[3].number === 4, "4 getting-started issues numbered 1..4");
const states = await as(alice, `select name, type from workflow_states order by position`);
ok(states.rows.length === 7, "7 default workflow states");
ok((await as(alice, `select * from labels`)).rows.length === 3, "3 default labels");
ok((await as(alice, `select * from team_members`)).rows.length === 1, "creator joined the first team");
ok(!!(await fails(alice, `select * from create_workspace('Login', 'login')`)), "reserved slugs are rejected");
ok(!!(await fails(bob, `select * from create_workspace('Dupe', 'acme')`)), "slugs are unique");

console.log("\ntenancy");
ok((await as(carol, `select * from issues`)).rows.length === 0, "outsider sees no issues");
ok((await as(carol, `select * from workspaces`)).rows.length === 0, "outsider sees no workspaces");
const team = (await as(alice, `select * from teams`)).rows[0];
const todo = (await as(alice, `select id from workflow_states where name = 'Todo'`)).rows[0].id;
ok(!!(await fails(carol, `insert into issues (team_id, workspace_id, title, state_id) values ($1, $2, 'x', $3)`, [team.id, ws.id, todo])),
  "outsider cannot insert into another workspace (workspace_id derived from team, then RLS)");
ok(!!(await fails(null, `select * from issues`)), "anon has no table access");

console.log("\ninvites");
const inv = (await as(alice, `insert into workspace_invites (workspace_id, email) values ($1, 'BOB@acme.dev') returning token, email`, [ws.id])).rows[0];
ok(inv.email === "bob@acme.dev", "invite email normalised");
const info = (await as(null, `select * from get_invite($1)`, [inv.token])).rows[0];
ok(info.workspace_name === "Acme" && info.valid, "get_invite works for anon with token");
ok(!!(await fails(carol, `select accept_invite($1)`, [inv.token])), "email-bound invite rejects other users");
const pend = (await as(bob, `select * from my_pending_invites()`)).rows;
ok(pend.length === 1 && pend[0].workspace_slug === "acme", "my_pending_invites lists bob's invite");
ok((await as(bob, `select accept_invite($1) as slug`, [inv.token])).rows[0].slug === "acme", "bob accepts invite");
ok((await as(bob, `select * from team_members where user_id = $1`, [bob])).rows.length === 1, "bob auto-joined the first team");
ok((await as(bob, `select * from profiles`)).rows.length === 2, "teammates' profiles now visible");
ok((await as(carol, `select * from profiles`)).rows.length === 1, "outsider still sees only self");
const link = (await as(bob, `insert into workspace_invites (workspace_id) values ($1) returning token`, [ws.id])).rows[0];
ok(!!link.token, "members can create open invite links");
ok(!!(await fails(bob, `insert into workspace_invites (workspace_id, role) values ($1, 'admin')`, [ws.id])), "only admins can invite admins");
const planted = (await as(bob, `insert into workspace_invites (workspace_id, token, expires_at, created_at)
  values ($1, 'acmeacme', null, now() + interval '1 year') returning token, expires_at, created_at`, [ws.id])).rows[0];
ok(planted.token !== "acmeacme" && planted.expires_at && new Date(planted.created_at) <= new Date(),
  "invite token, expiry and creation time are server-owned");

console.log("\nfunction privileges");
const anyIssue = (await as(alice, `select id from issues limit 1`)).rows[0].id;
ok(!!(await fails(carol, `select public.notify_user($1, $2, $3, 'status', null, null, '{}'::jsonb)`, [ws.id, alice, bob])), "outsider cannot forge notifications");
ok(!!(await fails(bob, `select public.notify_user($1, $2, $3, 'status', null, null, '{}'::jsonb)`, [ws.id, alice, carol])), "members cannot forge notifications");
ok(!!(await fails(carol, `select public._create_team($1, 'X', 'ZZZ', null, '#000000')`, [ws.id])), "outsider cannot call _create_team");
ok(!!(await fails(carol, `select public.subscribe_user($1, $2)`, [anyIssue, alice])), "outsider cannot call subscribe_user");

console.log("\nopaque membership keys");
ok(!!(await as(alice, `select id from team_members limit 1`)).rows[0].id, "membership rows carry an opaque id (realtime DELETE payloads leak no pairs)");
ok(!(await fails(alice, `insert into issue_subscribers (issue_id, workspace_id, user_id) values ($1, $2, $3) on conflict (issue_id, user_id) do nothing`,
  [anyIssue, ws.id, alice])), "natural-key upsert still works");

console.log("\nissues");
const created = (await as(bob, `insert into issues (team_id, workspace_id, title, state_id, assignee_id, priority)
  values ($1, $2, 'Fix login redirect', $3, $4, 2) returning *`, [team.id, "00000000-0000-0000-0000-000000000000", todo, alice])).rows[0];
ok(created.number === 5 && created.workspace_id === ws.id && created.creator_id === bob, "number=5, workspace derived, creator forced to caller");
let notes = (await as(alice, `select type from notifications`)).rows.map((r) => r.type);
ok(notes.includes("assigned"), "assignee notified on create");
ok((await as(bob, `select * from notifications`)).rows.length === 0, "actor not notified about own action");
ok(!!(await fails(bob, `update issues set assignee_id = $1 where id = $2`, [carol, created.id])), "cannot assign a non-member");
const inProg = (await as(alice, `select id from workflow_states where name = 'In Progress'`)).rows[0].id;
const done = (await as(alice, `select id from workflow_states where name = 'Done'`)).rows[0].id;
await as(alice, `update issues set state_id = $1 where id = $2`, [inProg, created.id]);
let row = (await as(alice, `select * from issues where id = $1`, [created.id])).rows[0];
ok(row.started_at && !row.completed_at, "started_at set when moved to a started state");
await as(alice, `update issues set state_id = $1 where id = $2`, [done, created.id]);
row = (await as(alice, `select * from issues where id = $1`, [created.id])).rows[0];
ok(row.completed_at, "completed_at set when moved to Done");
const hist = (await as(bob, `select field from issue_history where issue_id = $1 order by created_at`, [created.id])).rows.map((r) => r.field);
ok(hist[0] === "created" && hist.filter((f) => f === "state").length === 2, "history records creation and state changes");
notes = (await as(bob, `select type, data from notifications where type = 'status'`)).rows;
ok(notes.length === 2 && notes[1].data.to === "Done", "subscriber (creator) notified about status changes");

console.log("\nvalidation");
const bug = (await as(alice, `select id from labels where name = 'Bug'`)).rows[0].id;
await as(alice, `update issues set label_ids = array[$1::uuid, $1::uuid, gen_random_uuid()] where id = $2`, [bug, created.id]);
row = (await as(alice, `select label_ids from issues where id = $1`, [created.id])).rows[0];
ok(row.label_ids.length === 1 && row.label_ids[0] === bug, "labels deduped and foreign ids dropped");
const child = (await as(alice, `insert into issues (team_id, workspace_id, title, state_id, parent_id) values ($1, $2, 'child', $3, $4) returning *`,
  [team.id, ws.id, todo, created.id])).rows[0];
ok(child.parent_id === created.id, "sub-issue created");
ok(!!(await fails(alice, `update issues set parent_id = $1 where id = $2`, [child.id, created.id])), "circular parents rejected");
ok(!!(await fails(alice, `update issues set parent_id = id where id = $1`, [created.id])), "self-parent rejected");
const defState = (await as(alice, `insert into issues (team_id, workspace_id, title) values ($1, $2, 'no state') returning state_id`, [team.id, ws.id])).rows[0];
ok(defState.state_id === todo, "missing state defaults to the first unstarted state");

console.log("\nteams & moves");
const des = (await as(bob, `select * from create_team($1, 'Design', 'DES', '#e93d82')`, [ws.id])).rows[0];
ok(des.key === "DES", "member creates a team");
ok(!!(await fails(alice, `select * from create_team($1, 'Design 2', 'DES')`, [ws.id])), "team keys unique per workspace");
await as(alice, `update issues set team_id = $1 where id = $2`, [des.id, created.id]);
row = (await as(alice, `select i.number, s.team_id, s.type from issues i join workflow_states s on s.id = i.state_id where i.id = $1`, [created.id])).rows[0];
ok(row.number === 1 && row.team_id === des.id && row.type === "completed", "moved issue renumbered (DES-1) and state mapped by type");

console.log("\ncomments, mentions, reactions");
const body = `<p>Hey <span data-type="mention" data-id="${bob}">@bob</span> can you check?</p>`;
const c = (await as(alice, `insert into comments (issue_id, workspace_id, body) values ($1, $2, $3) returning *`, [child.id, ws.id, body])).rows[0];
ok(c.user_id === alice && c.workspace_id === ws.id, "comment author + workspace forced");
notes = (await as(bob, `select type from notifications where comment_id = $1`, [c.id])).rows.map((r) => r.type);
ok(notes.length === 1 && notes[0] === "mention", "mention notifies once (mention, not comment)");
ok(!!(await fails(bob, `update comments set body = 'hijack' where id = $1 returning id`, [c.id])) ||
  (await as(bob, `update comments set body = 'hijack' where id = $1 returning id`, [c.id])).rows.length === 0, "cannot edit someone else's comment");
await as(alice, `update comments set body = '<p>edited</p>' where id = $1`, [c.id]);
ok((await as(alice, `select edited_at from comments where id = $1`, [c.id])).rows[0].edited_at, "edited_at stamped");
await as(bob, `insert into reactions (comment_id, workspace_id, user_id, emoji) values ($1, $2, $3, '👍')`, [c.id, ws.id, alice]);
const r = (await as(bob, `select user_id from reactions`)).rows[0];
ok(r.user_id === bob, "reaction user forced to caller");

console.log("\nprojects & cycles");
const proj = (await as(alice, `insert into projects (workspace_id, name, lead_id, member_ids, team_ids) values ($1, 'Launch', $2, array[$2::uuid, $3::uuid], array[$4::uuid]) returning *`,
  [ws.id, alice, carol, team.id])).rows[0];
ok(proj.member_ids.length === 1 && proj.created_by === alice, "project members filtered to workspace members");
await as(bob, `insert into project_updates (project_id, workspace_id, health, body) values ($1, $2, 'at_risk', 'Slipping')`, [proj.id, ws.id]);
ok((await as(alice, `select health from projects where id = $1`, [proj.id])).rows[0].health === "at_risk", "project update sets health");
ok((await as(alice, `select * from notifications where type = 'project_update'`)).rows.length === 1, "lead notified of project update");
const cy1 = (await as(alice, `insert into cycles (team_id, workspace_id, starts_at, ends_at) values ($1, $2, '2026-10-05', '2026-10-19') returning number`, [team.id, ws.id])).rows[0];
const cy2 = (await as(alice, `insert into cycles (team_id, workspace_id, starts_at, ends_at) values ($1, $2, '2026-10-19', '2026-11-02') returning id, number`, [team.id, ws.id])).rows[0];
ok(cy1.number === 1 && cy2.number === 2, "cycles numbered per team");
ok(!!(await fails(alice, `update issues set cycle_id = $1 where id = $2`, [cy2.id, created.id])), "cycle must belong to the issue's team");

console.log("\ntenant integrity");
const elseWs = (await as(carol, `select * from create_workspace('Else', 'else-co')`)).rows[0];
const elseProj = (await as(carol, `insert into projects (workspace_id, name) values ($1, 'Else project') returning id`, [elseWs.id])).rows[0].id;
const carolUpd = (await as(carol, `insert into project_updates (project_id, workspace_id, health, body) values ($1, $2, 'on_track', 'hi') returning id`,
  [elseProj, elseWs.id])).rows[0].id;
// filterless writes read no column, so only the UPDATE policy (not SELECT) is checked
await as(carol, `update project_updates set project_id = $1`, [proj.id]);
await as(carol, `update project_updates set workspace_id = $1`, [ws.id]);
const cu = (await as(carol, `select project_id, workspace_id from project_updates where id = $1`, [carolUpd])).rows[0];
ok(cu && cu.project_id === elseProj && cu.workspace_id === elseWs.id, "project updates cannot be re-homed into another workspace");
ok((await as(alice, `select count(*)::int as c from project_updates where id = $1`, [carolUpd])).rows[0].c === 0, "the other workspace never sees the injected update");
const ws3 = (await as(alice, `select * from create_workspace('Acme Two', 'acme-two')`)).rows[0];
const proj3 = (await as(alice, `insert into projects (workspace_id, name) values ($1, 'Other') returning id`, [ws3.id])).rows[0].id;
await as(alice, `insert into project_milestones (project_id, workspace_id, name) values ($1, $2, 'M1')`, [proj.id, ws.id]);
ok(!!(await fails(alice, `update project_milestones set project_id = $1 where true`, [proj3])), "milestones cannot move to another workspace's project");
const wideLabel = (await as(alice, `select id from labels where workspace_id = $1 and team_id is null limit 1`, [ws.id])).rows[0].id;
await as(alice, `update labels set workspace_id = $1 where id = $2`, [ws3.id, wideLabel]);
ok((await as(alice, `select workspace_id from labels where id = $1`, [wideLabel])).rows[0].workspace_id === ws.id, "workspace-wide labels cannot change workspace");
await as(alice, `insert into issue_relations (workspace_id, issue_id, related_issue_id, type) values ($1, $2, $3, 'blocks')`, [ws.id, created.id, child.id]);
ok(!!(await fails(alice, `update issue_relations set type = 'related'`)), "relations cannot be re-pointed after insert");
ok(!!(await fails(alice, `insert into comments (issue_id, workspace_id, body, parent_id) values ($1, $2, '<p>x</p>', $3)`, [created.id, ws.id, c.id])),
  "replies must belong to their parent's issue");
await as(alice, `delete from workspaces where id = $1`, [ws3.id]);
await as(carol, `delete from workspaces where id = $1`, [elseWs.id]);

console.log("\ntext limits");
ok(!!(await fails(alice, `update issues set description = repeat('x', 200001) where id = $1`, [created.id])), "issue descriptions are capped");
ok(!!(await fails(alice, `update profiles set display_name = repeat('x', 33) where id = $1`, [alice])), "display names are capped");
await db.exec("reset role");
await db.exec(`alter table issues disable trigger issues_text_limits`);
await db.query(`update issues set description = repeat('y', 200001) where id = $1`, [created.id]);
await db.exec(`alter table issues enable trigger issues_text_limits`);
ok(!(await fails(alice, `update issues set priority = 3 where id = $1`, [created.id])), "a legacy over-long description does not block other edits");
await db.query(`update issues set description = '' where id = $1`, [created.id]);
const longUser = await mk("christopher.alexander.montgomery.long@x.dev", "");
ok((await db.query(`select char_length(display_name)::int as n from profiles where id = $1`, [longUser])).rows[0].n <= 32,
  "long auto-generated display names are clamped at signup");

console.log("\nnotifications privacy");
const aliceNote = (await as(alice, `select id from notifications limit 1`)).rows[0].id;
ok((await as(bob, `select * from notifications where id = $1`, [aliceNote])).rows.length === 0, "cannot read others' notifications");
await as(alice, `update notifications set read_at = now(), type = 'hacked' where id = $1`, [aliceNote]);
const n = (await as(alice, `select type, read_at from notifications where id = $1`, [aliceNote])).rows[0];
ok(n.read_at && n.type !== "hacked", "recipient can mark read but not rewrite notifications");
ok(!!(await fails(alice, `insert into notifications (workspace_id, user_id, type) values ($1, $2, 'spam')`, [ws.id, bob])), "clients cannot forge notifications");
ok(!!(await fails(alice, `insert into issue_history (workspace_id, issue_id, field) values ($1, $2, 'x')`, [ws.id, created.id])), "clients cannot forge history");

console.log("\nlabels & states");
await as(alice, `delete from labels where id = $1`, [bug]);
ok((await as(alice, `select label_ids from issues where id = $1`, [created.id])).rows[0].label_ids.length === 0, "deleted label removed from issues");
const backlog = (await as(alice, `select id from workflow_states where team_id = $1 and name = 'Backlog'`, [team.id])).rows[0].id;
await as(alice, `select delete_workflow_state($1, $2)`, [todo, backlog]);
ok((await as(alice, `select count(*)::int as c from issues where state_id = $1`, [todo])).rows[0].c === 0, "delete_workflow_state moves issues to replacement");

console.log("\nmembership guards");
ok(!!(await fails(alice, `delete from workspace_members where user_id = $1`, [alice])), "last admin cannot leave");
ok(!!(await fails(alice, `update workspace_members set role = 'member' where user_id = $1`, [alice])), "last admin cannot demote self");
ok(!!(await fails(bob, `update workspace_members set role = 'admin' where user_id = $1 returning *`, [bob])) ||
  (await as(bob, `update workspace_members set role = 'admin' where user_id = $1 returning *`, [bob])).rows.length === 0, "members cannot promote themselves");

console.log("\nmember removal");
const bobLink = (await as(bob, `insert into workspace_invites (workspace_id) values ($1) returning token`, [ws.id])).rows[0];
await as(bob, `insert into workspace_invites (workspace_id, email) values ($1, 'bob.alt@acme.dev')`, [ws.id]);
const aliceLink = (await as(alice, `insert into workspace_invites (workspace_id) values ($1) returning token`, [ws.id])).rows[0];
const tmpLabel = (await as(alice, `insert into labels (workspace_id, name) values ($1, 'Temp') returning id`, [ws.id])).rows[0].id;
const parentIssue = (await as(alice, `insert into issues (team_id, workspace_id, title) values ($1, $2, 'Parent') returning id`, [team.id, ws.id])).rows[0].id;
const launch = (await as(alice, `insert into projects (workspace_id, name, lead_id, member_ids) values ($1, 'Launch 2', $2, array[$2::uuid, $3::uuid]) returning id`,
  [ws.id, bob, alice])).rows[0].id;
const ms = (await as(alice, `insert into project_milestones (project_id, workspace_id, name) values ($1, $2, 'Beta') returning id`, [launch, ws.id])).rows[0].id;
const cy3 = (await as(alice, `insert into cycles (team_id, workspace_id, starts_at, ends_at) values ($1, $2, '2026-11-02', '2026-11-16') returning id`, [team.id, ws.id])).rows[0].id;
const bobIssue = (await as(alice, `insert into issues (team_id, workspace_id, title, assignee_id, label_ids, cycle_id, project_id, milestone_id, parent_id)
  values ($1, $2, 'Owned by Bob', $3, array[$4::uuid], $5, $6, $7, $8) returning id`, [team.id, ws.id, bob, tmpLabel, cy3, launch, ms, parentIssue])).rows[0].id;
const bobC = (await as(bob, `insert into comments (issue_id, workspace_id, body) values ($1, $2, '<p>mine</p>') returning id`, [bobIssue, ws.id])).rows[0].id;
const aliceReply = (await as(alice, `insert into comments (issue_id, workspace_id, body, parent_id) values ($1, $2, '<p>reply</p>', $3) returning id`,
  [bobIssue, ws.id, bobC])).rows[0].id;
ok((await as(alice, `delete from workspace_members where user_id = $1 returning user_id`, [bob])).rows.length === 1, "admin removes a member");
ok(!!(await fails(bob, `select accept_invite($1)`, [aliceLink.token])), "removed member cannot rejoin through the shared link");
ok(!!(await fails(bob, `select accept_invite($1)`, [bobLink.token])), "removed member cannot rejoin through a link they minted");
ok((await as(alice, `select count(*)::int as c from workspace_invites where accepted_at is null`)).rows[0].c === 0, "removal revokes every invite the member could use");
ok((await as(alice, `select assignee_id from issues where id = $1`, [bobIssue])).rows[0].assignee_id === null, "departed member's issues are unassigned");
const lp = (await as(alice, `select lead_id, member_ids from projects where id = $1`, [launch])).rows[0];
ok(lp.lead_id === null && !lp.member_ids.includes(bob), "departed member loses project lead and membership");
await db.exec("reset role");
ok((await db.query(`select count(*)::int as c from issue_subscribers where user_id = $1 and workspace_id = $2`, [bob, ws.id])).rows[0].c === 0,
  "departed member stops following issues");
await as(bob, `update comments set body = '<p>pwn</p>'`);
await as(bob, `delete from comments`);
const cm = (await as(alice, `select id, body from comments where id = any($1::uuid[])`, [[bobC, aliceReply]])).rows;
ok(cm.length === 2 && cm.find((x) => x.id === bobC).body === "<p>mine</p>", "removed member cannot edit or delete old comments (filterless writes)");
ok(!(await fails(alice, `update issues set title = 'Still editable' where id = $1`, [bobIssue])), "issues stay editable after their assignee leaves");
ok(!(await fails(alice, `delete from labels where id = $1`, [tmpLabel])), "label delete still cascades");
ok(!(await fails(alice, `insert into project_updates (project_id, workspace_id, health, body) values ($1, $2, 'on_track', 'ok')`, [launch, ws.id])), "project updates still post");
ok(!(await fails(alice, `delete from project_milestones where id = $1`, [ms])), "milestone delete still cascades");
ok(!(await fails(alice, `delete from cycles where id = $1`, [cy3])), "cycle delete still cascades");
ok(!(await fails(alice, `delete from issues where id = $1`, [parentIssue])), "parent delete still cascades");
ok(!(await fails(alice, `delete from projects where id = $1`, [launch])), "project delete still cascades");
ok(!!(await fails(alice, `update issues set assignee_id = $1 where id = $2`, [bob, bobIssue])), "cannot assign a departed member");
const reinv = (await as(alice, `insert into workspace_invites (workspace_id, email) values ($1, 'bob@acme.dev') returning token`, [ws.id])).rows[0];
ok((await as(bob, `select accept_invite($1) as slug`, [reinv.token])).rows[0].slug === "acme", "admins can re-invite a removed member");
const keep = (await as(alice, `insert into workspace_invites (workspace_id) values ($1) returning token`, [ws.id])).rows[0];
ok((await as(bob, `delete from workspace_members where user_id = $1 returning *`, [bob])).rows.length === 1, "member can leave");
ok((await as(alice, `select count(*)::int as c from workspace_invites where token = $1`, [keep.token])).rows[0].c === 1, "leaving voluntarily keeps the shared link");
ok((await as(bob, `select * from issues`)).rows.length === 0, "after leaving, no access");

console.log("\nfavorites cleanup");
const favIssue = (await as(alice, `insert into issues (team_id, workspace_id, title) values ($1, $2, 'fav me') returning id`, [team.id, ws.id])).rows[0].id;
await as(alice, `insert into favorites (workspace_id, user_id, kind, target_id) values ($1, $2, 'issue', $3)`, [ws.id, alice, favIssue]);
await as(alice, `insert into favorites (workspace_id, user_id, kind, target_id) values ($1, $2, 'project', $3)`, [ws.id, alice, proj.id]);
await as(alice, `delete from issues where id = $1`, [favIssue]);
await as(alice, `delete from projects where id = $1`, [proj.id]);
ok((await as(alice, `select count(*)::int as c from favorites`)).rows[0].c === 0, "favorites removed when their issue/project is deleted");

console.log("\nupdated_at clock");
await db.exec("reset role");
const clk = await db.transaction(async (tx) => {
  await tx.exec(`do $$ declare t timestamptz := clock_timestamp(); begin while clock_timestamp() < t + interval '3 ms' loop end loop; end $$;`);
  const i = (await tx.query(`update issues set title = 'clock' where id = $1 returning updated_at > now() as later`, [created.id])).rows[0];
  const t = (await tx.query(`update teams set name = name where id = $1 returning updated_at > now() as later`, [team.id])).rows[0];
  const p = (await tx.query(`update profiles set name = name where id = $1 returning updated_at > now() as later`, [alice])).rows[0];
  return { i, t, p };
});
ok(clk.i.later && clk.t.later && clk.p.later, "updated_at is stamped at write time (clock_timestamp), not transaction start");

const invite = async (admin, wsId, user, role = "member") => {
  const { token } = (await as(admin, `insert into workspace_invites (workspace_id, role) values ($1, $2) returning token`, [wsId, role])).rows[0];
  await as(user, `select accept_invite($1)`, [token]);
};

console.log("\ncascade indexes");
await db.exec("reset role");
const indexes = new Set((await db.query(`select indexname from pg_indexes where schemaname = 'public'`)).rows.map((r) => r.indexname));
for (const name of [
  "comments_parent_idx", "notifications_issue_idx", "notifications_comment_idx", "notifications_project_idx",
  "issues_milestone_idx", "favorites_target_idx", "labels_team_idx", "views_team_idx", "issues_ws_created_idx",
]) ok(indexes.has(name), `index ${name} exists`);

console.log("\nstates and cycles keep their team");
const dave = await mk("dave@acme.dev", "Dave Mover");
await invite(alice, ws.id, dave);
const engProgress = (await as(alice, `select id from workflow_states where team_id = $1 and name = 'In Progress'`, [team.id])).rows[0].id;
const engCycle = (await as(alice, `insert into cycles (team_id, workspace_id, starts_at, ends_at) values ($1, $2, '2026-12-01', '2026-12-15') returning id`,
  [team.id, ws.id])).rows[0].id;
const daveIssue = (await as(alice, `insert into issues (team_id, workspace_id, title, state_id, cycle_id, assignee_id) values ($1, $2, 'Pinned', $3, $4, $5) returning id`,
  [team.id, ws.id, engProgress, engCycle, dave])).rows[0].id;
await as(dave, `update workflow_states set team_id = $1 where id = $2`, [des.id, engProgress]);
await as(dave, `update cycles set team_id = $1 where id = $2`, [des.id, engCycle]);
ok((await as(alice, `select team_id from workflow_states where id = $1`, [engProgress])).rows[0].team_id === team.id, "a member cannot move a workflow state to another team");
ok((await as(alice, `select team_id from cycles where id = $1`, [engCycle])).rows[0].team_id === team.id, "a member cannot move a cycle to another team");
ok(!(await fails(alice, `update issues set priority = 3 where id = $1`, [daveIssue])), "issues in that state and cycle stay editable");
ok((await as(alice, `delete from workspace_members where user_id = $1 returning user_id`, [dave])).rows.length === 1,
  "the admin can still remove the member who tried to re-home them");

console.log("\nteam membership follows the team's workspace");
const mallory = await mk("mallory@acme.dev", "Mallory Plant");
const victim = await mk("victim@acme.dev", "Vic Tim");
await invite(alice, ws.id, mallory);
await invite(alice, ws.id, victim);
const malWs = (await as(mallory, `select * from create_workspace('Mallory Co', 'mallory-co')`)).rows[0];
const malTeam = (await as(mallory, `select id from teams where workspace_id = $1`, [malWs.id])).rows[0].id;
ok(!!(await fails(mallory, `insert into team_members (team_id, user_id, workspace_id) values ($1, $2, $3)`, [malTeam, victim, ws.id])),
  "a user cannot be put into a team of a workspace they don't belong to (whatever workspace_id is sent)");
await as(mallory, `insert into team_members (team_id, user_id, workspace_id) values ($1, $2, $3) on conflict do nothing`, [des.id, victim, malWs.id]);
ok((await as(alice, `select workspace_id from team_members where team_id = $1 and user_id = $2`, [des.id, victim])).rows[0]?.workspace_id === ws.id,
  "team membership rows take the team's workspace");
await as(mallory, `delete from workspaces where id = $1`, [malWs.id]);

console.log("\nissue subscriptions");
const followed = (await as(alice, `insert into issues (team_id, workspace_id, title) values ($1, $2, 'Follow me') returning id`, [team.id, ws.id])).rows[0].id;
ok(!!(await fails(mallory, `insert into issue_subscribers (issue_id, user_id, workspace_id) values ($1, $2, $3)`, [followed, victim, ws.id])),
  "members cannot subscribe someone else");
ok(!!(await fails(mallory, `insert into issue_subscribers (issue_id, user_id, workspace_id) values ($1, $2, $3) on conflict (issue_id, user_id) do nothing returning user_id`,
  [followed, carol, ws.id])), "members cannot subscribe non-members");
ok(!(await fails(mallory, `insert into issue_subscribers (issue_id, user_id, workspace_id) values ($1, $2, $3)`, [followed, mallory, ws.id])),
  "members subscribe themselves");
await as(mallory, `delete from issue_subscribers where user_id = $1`, [alice]);
ok((await as(alice, `select count(*)::int as c from issue_subscribers where issue_id = $1 and user_id = $2`, [followed, alice])).rows[0].c === 1,
  "members cannot unsubscribe someone else");
ok((await as(alice, `delete from issue_subscribers where issue_id = $1 and user_id = $2 returning user_id`, [followed, mallory])).rows.length === 1,
  "admins can unsubscribe anyone");

console.log("\ndeparted authors");
const erin = await mk("erin@acme.dev", "Erin Leaver");
await invite(alice, ws.id, erin);
const erinView = (await as(erin, `insert into views (workspace_id, name, shared) values ($1, 'Erin board', true) returning id`, [ws.id])).rows[0].id;
const erinLink = (await as(erin, `insert into workspace_invites (workspace_id) values ($1) returning token`, [ws.id])).rows[0].token;
await as(erin, `delete from workspace_members where user_id = $1`, [erin]);
await as(erin, `delete from views`);
await as(erin, `delete from workspace_invites`);
ok((await as(alice, `select count(*)::int as c from views where id = $1`, [erinView])).rows[0].c === 1,
  "a departed member cannot delete their old views (filterless DELETE)");
ok((await as(alice, `select count(*)::int as c from workspace_invites where token = $1`, [erinLink])).rows[0].c === 1,
  "a departed member cannot revoke the links they minted (filterless DELETE)");
await fails(erin, `update views set name = 'pwned'`);
ok((await as(alice, `select name from views where id = $1`, [erinView])).rows[0].name === "Erin board", "… nor edit their old views");

console.log("\nview JSON shape");
const badView = (sql) => fails(alice, `insert into views (workspace_id, name, filters, display) values ($1, 'bad', ${sql})`, [ws.id]);
ok(!!(await badView(`'{}', '{}'`)), "view filters must be a JSON array");
ok(!!(await badView(`'null', '{}'`)), "… not the JSON null");
ok(!!(await badView(`'[]', '[]'`)), "view display must be a JSON object");
ok(!!(await badView(`'[{"field": "priority"}]', '{}'`)), "a filter without a values list is rejected");
ok(!!(await badView(`'[{"field": 1, "values": []}]', '{}'`)), "a filter field must be a string");
ok(!!(await badView(`'[7]', '{}'`)), "a filter must be an object");
const goodView = (await as(alice, `insert into views (workspace_id, name, filters, display) values ($1, 'Urgent',
  '[{"id": "f1", "field": "priority", "op": "is", "values": ["1"]}]', '{"grouping": "assignee"}') returning id`, [ws.id])).rows[0].id;
ok(!!goodView, "well-formed filters and display are accepted");
ok(!!(await fails(alice, `update views set filters = '[{"values": []}]' where id = $1`, [goodView])), "updates are checked too");
ok(!(await fails(alice, `update views set name = 'Urgent only' where id = $1`, [goodView])), "other edits of a valid view still work");

console.log("\nworkspace delete cascade");
ok((await as(alice, `delete from workspaces where id = $1 returning id`, [ws.id])).rows.length === 1, "admin deletes workspace (full cascade succeeds)");
await db.exec("reset role");
ok((await db.query(`select count(*)::int as c from issues`)).rows[0].c === 0, "all issues gone");

console.log("\nuser delete cascade");
const ws2 = (await as(alice, `select * from create_workspace('Solo', 'solo')`)).rows[0];
await db.query(`delete from auth.users where id = $1`, [alice]);
ok((await db.query(`select count(*)::int as c from workspace_members where workspace_id = $1`, [ws2.id])).rows[0].c === 0, "deleting a user cascades without tripping admin guard");

/* ═══ upgrade path: 001–003 with data, then every later migration ═══ */

console.log("\nupgrade path");
const up = new PGlite();
const { as: uAs, fails: uFails } = actor(up);
const uq = async (sql, params = []) => { await up.exec("reset role"); return (await up.query(sql, params)).rows; };
await up.exec(PRELUDE);
await up.exec("create publication supabase_realtime");
const FIRST_UPGRADE = "20261005000004";
for (const f of MIGRATIONS.filter((f) => f < FIRST_UPGRADE)) await up.exec(migration(f));

const umk = async (email, name) =>
  (await up.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, { name }])).rows[0].id;
const ua = await umk("ann@old.dev", "Ann Admin");
const ub = await umk("ben@old.dev", "Ben Gone");
// a first word over 32 characters (display_name) and a name over 80 (no clamping before 009)
const uc = await umk("cat@old.dev", `Constantinopolitanischerdudelsackpfeifenmacher ${"y".repeat(60)}`);
const uws = (await uAs(ua, `select * from create_workspace('Old Co', 'old-co')`)).rows[0];
const eng = (await uAs(ua, `select * from teams where workspace_id = $1`, [uws.id])).rows[0];
const ujoin = async (user) => {
  const { token } = (await uAs(ua, `insert into workspace_invites (workspace_id) values ($1) returning token`, [uws.id])).rows[0];
  await uAs(user, `select accept_invite($1)`, [token]);
};
await ujoin(ub);
await ujoin(uc);
const udes = (await uAs(ua, `select * from create_team($1, 'Design', 'DES')`, [uws.id])).rows[0];
const ustate = async (teamId, name) => (await uAs(ua, `select id from workflow_states where team_id = $1 and name = $2`, [teamId, name])).rows[0].id;
const engTodo = await ustate(eng.id, "Todo");
const engReview = await ustate(eng.id, "In Review");

// Ben: assigned an issue, leads a project and is in it, follows issues, has notifications — then leaves (no cleanup before 005)
const benIssue = (await uAs(ua, `insert into issues (team_id, workspace_id, title, state_id, assignee_id) values ($1, $2, 'Ben''s task', $3, $4) returning id`,
  [eng.id, uws.id, engTodo, ub])).rows[0].id;
const benProject = (await uAs(ua, `insert into projects (workspace_id, name, lead_id, member_ids) values ($1, 'Launch', $2, array[$2::uuid, $3::uuid]) returning id`,
  [uws.id, ub, ua])).rows[0].id;
const shared = (await uAs(ua, `insert into issues (team_id, workspace_id, title, state_id) values ($1, $2, 'Shared work', $3) returning id`,
  [eng.id, uws.id, engTodo])).rows[0].id;
await uAs(ub, `insert into issue_subscribers (issue_id, user_id, workspace_id) values ($1, $2, $3) on conflict do nothing`, [shared, ub, uws.id]);
ok((await uq(`select count(*)::int as c from notifications where user_id = $1`, [ub]))[0].c > 0, "seed: Ben has notifications");

// Cat: comments, a project update, a relation, an invite link, a team view — Cat is deleted later
// (before Ben leaves: the old schema re-checked the project lead on every project write)
const catComment = (await uAs(uc, `insert into comments (issue_id, workspace_id, body) values ($1, $2, '<p>cat</p>') returning id`, [shared, uws.id])).rows[0].id;
const catUpdate = (await uAs(uc, `insert into project_updates (project_id, workspace_id, health, body) values ($1, $2, 'on_track', 'fine') returning id`,
  [benProject, uws.id])).rows[0].id;
const catRel = (await uAs(uc, `insert into issue_relations (workspace_id, issue_id, related_issue_id, type) values ($1, $2, $3, 'related') returning id`,
  [uws.id, shared, benIssue])).rows[0].id;
const catInvite = (await uAs(uc, `insert into workspace_invites (workspace_id) values ($1) returning id`, [uws.id])).rows[0].id;
const catView = (await uAs(uc, `insert into views (workspace_id, name, team_id) values ($1, 'Cat board', $2) returning id`, [uws.id, eng.id])).rows[0].id;

await uAs(ub, `delete from workspace_members where user_id = $1`, [ub]);


// rows only the old schema allowed
const brokenView = (await uAs(ua, `insert into views (workspace_id, name, filters, display) values ($1, 'Broken', '{"oops": true}', '[]') returning id`,
  [uws.id])).rows[0].id;
const mixedView = (await uAs(ua, `insert into views (workspace_id, name, filters) values ($1, 'Mixed',
  '[{"id": "a", "field": "priority", "op": "is", "values": ["1"]}, 7, {"field": "label"}]') returning id`, [uws.id])).rows[0].id;
await uAs(ua, `insert into workspace_invites (workspace_id, token, expires_at, created_at) values ($1, 'plantedplanted', null, now() + interval '1 year')`, [uws.id]);
const hugeDoc = (await uAs(ua, `insert into issues (team_id, workspace_id, title, state_id, description) values ($1, $2, 'Huge', $3, repeat('z', 200500)) returning id`,
  [eng.id, uws.id, engTodo])).rows[0].id;
// a member re-homes a state and a cycle that issues use (their assignees stay members, so 005 is unaffected)
const reviewIssue = (await uAs(ua, `insert into issues (team_id, workspace_id, title, state_id, assignee_id) values ($1, $2, 'In review', $3, $4) returning id`,
  [eng.id, uws.id, engReview, uc])).rows[0].id;
const engCyc = (await uAs(ua, `insert into cycles (team_id, workspace_id, starts_at, ends_at) values ($1, $2, '2026-10-05', '2026-10-19') returning id`,
  [eng.id, uws.id])).rows[0].id;
const cycIssue = (await uAs(ua, `insert into issues (team_id, workspace_id, title, state_id, cycle_id, assignee_id) values ($1, $2, 'Cycled', $3, $4, $5) returning id`,
  [eng.id, uws.id, engTodo, engCyc, ua])).rows[0].id;
await uAs(uc, `update workflow_states set team_id = $1 where id = $2`, [udes.id, engReview]);
await uAs(uc, `update cycles set team_id = $1 where id = $2`, [udes.id, engCyc]);

// the preflight to run on production before 005 (an issue with a departed assignee AND another team's state/cycle aborts it)
ok((await uq(`select i.id from issues i
  where i.assignee_id is not null
    and not exists (select 1 from workspace_members wm where wm.workspace_id = i.workspace_id and wm.user_id = i.assignee_id)
    and (not exists (select 1 from workflow_states s where s.id = i.state_id and s.team_id = i.team_id)
         or (i.cycle_id is not null and not exists (select 1 from cycles c where c.id = i.cycle_id and c.team_id = i.team_id)))`)).length === 0,
  "005 preflight finds nothing to repair first");

for (const f of MIGRATIONS.filter((f) => f >= FIRST_UPGRADE)) {
  await up.exec("reset role");
  try {
    await up.exec("begin");
    await up.exec(migration(f));
    await up.exec("commit");
    ok(true, `upgrade applies ${f}`);
  } catch (e) {
    await up.exec("rollback");
    ok(false, `upgrade applies ${f} — ${e.message}`);
  }
}

ok((await uq(`select assignee_id from issues where id = $1`, [benIssue]))[0].assignee_id === null, "005 backfill: a departed member's issues are unassigned");
const bp = (await uq(`select lead_id, member_ids from projects where id = $1`, [benProject]))[0];
ok(bp.lead_id === null && !bp.member_ids.includes(ub) && bp.member_ids.includes(ua), "005 backfill: … they lose project lead and membership");
ok((await uq(`select count(*)::int as c from issue_subscribers where user_id = $1`, [ub]))[0].c === 0, "005 backfill: … they stop following issues");
ok((await uq(`select count(*)::int as c from notifications where user_id = $1`, [ub]))[0].c === 0, "005 backfill: … their notifications are dropped");
const plantedUp = (await uq(`select created_at <= now() as past, expires_at is not null and expires_at <= created_at + interval '14 days' as capped
  from workspace_invites where token = 'plantedplanted'`))[0];
ok(plantedUp.past && plantedUp.capped, "006 backfill: a planted invite gets a past creation time and a 14-day expiry");
const catProfile = (await uq(`select char_length(name)::int as n, char_length(display_name)::int as d from profiles where id = $1`, [uc]))[0];
ok(catProfile.n <= 80 && catProfile.d <= 32, "009 backfill: over-long profile names are clamped before the CHECKs");
ok((await uq(`select char_length(description)::int as n from issues where id = $1`, [hugeDoc]))[0].n === 200500, "009: an over-long description is kept");
ok(!(await uFails(ua, `update issues set priority = 2 where id = $1`, [hugeDoc])), "009: … and its issue stays editable");
const pks = await uq(`select c.relname, a.attname from pg_index i
  join pg_class c on c.oid = i.indrelid
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indisprimary and c.relname in ('workspace_members', 'team_members', 'issue_subscribers')`);
ok(pks.length === 3 && pks.every((r) => r.attname === "id"), "010: membership tables are keyed by an opaque id");
const tmIds = (await uq(`select count(*)::int as n, count(distinct id)::int as d from team_members`))[0];
ok(tmIds.n > 0 && tmIds.n === tmIds.d, "010: existing membership rows got distinct ids");
ok(!(await uFails(ua, `insert into issue_subscribers (issue_id, user_id, workspace_id) values ($1, $2, $3) on conflict (issue_id, user_id) do nothing`,
  [shared, ua, uws.id])), "010: natural-key upserts still work on upgraded tables");
ok((await uq(`select count(*)::int as c from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`))[0].c === 21,
  "all 21 tables are still published to realtime");
const ri = (await uq(`select s.team_id = i.team_id as same, s.type from issues i join workflow_states s on s.id = i.state_id where i.id = $1`, [reviewIssue]))[0];
ok(ri.same && ri.type === "started", "013 repair: an issue left with another team's state gets its own team's state of that type");
ok((await uq(`select cycle_id from issues where id = $1`, [cycIssue]))[0].cycle_id === null, "013 repair: … and drops another team's cycle");
ok(!(await uFails(ua, `update issues set priority = 1 where id = any($1::uuid[])`, [[reviewIssue, cycIssue]])), "013 repair: those issues are editable again");
const vs = await uq(`select id, filters, display from views where id = any($1::uuid[])`, [[brokenView, mixedView]]);
const bv = vs.find((v) => v.id === brokenView);
const mv = vs.find((v) => v.id === mixedView);
ok(Array.isArray(bv.filters) && !bv.filters.length && bv.display && !Array.isArray(bv.display), "014: malformed view JSON is normalised");
ok(mv.filters.length === 1 && mv.filters[0].field === "priority", "014: … invalid filter elements dropped, valid ones kept");
const fnAcl = await uq(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('pin_team_id', 'team_members_guard', 'views_json_guard')
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`);
ok(fnAcl.length === 0, "new trigger functions are not callable by the API roles");

await up.query(`delete from auth.users where id = $1`, [uc]);
const left = {
  comment: (await uq(`select user_id from comments where id = $1`, [catComment]))[0],
  update: (await uq(`select user_id from project_updates where id = $1`, [catUpdate]))[0],
  rel: (await uq(`select created_by from issue_relations where id = $1`, [catRel]))[0],
  invite: (await uq(`select invited_by from workspace_invites where id = $1`, [catInvite]))[0],
  views: (await uq(`select count(*)::int as c from views where id = $1`, [catView]))[0].c,
  assignee: (await uq(`select assignee_id from issues where id = $1`, [reviewIssue]))[0],
};
ok(left.comment?.user_id === null && left.update?.user_id === null && left.rel?.created_by === null && left.invite?.invited_by === null,
  "user delete on upgraded data: comments, updates, relations and links stay, author cleared");
ok(left.views === 0 && left.assignee?.assignee_id === null, "user delete: … their views go and their issues are unassigned");
ok(!(await uFails(ua, `delete from teams where id = $1`, [udes.id])), "team delete: the team that received the moved state and cycle can be deleted");
ok(!(await uFails(ua, `delete from teams where id = $1`, [eng.id])), "team delete: a team with issues, comments, relations and cycles cascades");
ok((await uq(`select count(*)::int as c from issues where workspace_id = $1`, [uws.id]))[0].c === 0, "team delete: … its issues are gone");
ok(!(await uFails(ua, `delete from workspaces where id = $1`, [uws.id])), "workspace delete on upgraded data cascades");

/* ═══ the 005 preflight (supabase/preflight) unblocks a database 005 would otherwise abort on ═══ */

console.log("\n005 preflight repair");
const pf = new PGlite();
const { as: pAs, fails: pFails } = actor(pf);
await pf.exec(PRELUDE);
for (const f of MIGRATIONS.filter((f) => f < FIRST_UPGRADE)) await pf.exec(migration(f));
const pmk = async (email, name) =>
  (await pf.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, { name }])).rows[0].id;
const pa = await pmk("pat@pre.dev", "Pat Admin");
const pm = await pmk("max@pre.dev", "Max Mover");
const pws = (await pAs(pa, `select * from create_workspace('Pre Co', 'pre-co')`)).rows[0];
const pteam = (await pAs(pa, `select * from teams where workspace_id = $1`, [pws.id])).rows[0];
const pother = (await pAs(pa, `select * from create_team($1, 'Ops', 'OPS')`, [pws.id])).rows[0];
const { token: ptok } = (await pAs(pa, `insert into workspace_invites (workspace_id) values ($1) returning token`, [pws.id])).rows[0];
await pAs(pm, `select accept_invite($1)`, [ptok]);
const preview = (await pAs(pa, `select id from workflow_states where team_id = $1 and name = 'In Review'`, [pteam.id])).rows[0].id;
const stuck = (await pAs(pa, `insert into issues (team_id, workspace_id, title, state_id, assignee_id) values ($1, $2, 'Stuck', $3, $4) returning id`,
  [pteam.id, pws.id, preview, pm])).rows[0].id;
await pAs(pm, `update workflow_states set team_id = $1 where id = $2`, [pother.id, preview]); // allowed before 013
await pAs(pm, `delete from workspace_members where user_id = $1`, [pm]); // leaves; no cleanup before 005
const [, preStep1, preStep2] = readFileSync(join(root, "supabase/preflight/20261005000005_member_departure.sql"), "utf8")
  .split(/^-- ─── step \d.*$/m);
const preRepair = preStep2.split("\n").map((l) => l.replace(/^-- ?/, "")).join("\n");
await pf.exec("reset role");
ok((await pf.query(preStep1.slice(preStep1.indexOf("select")))).rows.length === 1, "preflight step 1 finds the issue that would abort 005");
const blocked = await (async () => {
  try { await pf.exec(`begin; ${migration(MIGRATIONS.find((f) => f.startsWith("20261005000004")))} ${migration(MIGRATIONS.find((f) => f.startsWith("20261005000005")))}`); return null; }
  catch (e) { return e.message; } finally { await pf.exec("rollback"); }
})();
ok(/does not belong to this team/.test(blocked ?? ""), "without the repair, 004 + 005 abort");
await pf.exec(preRepair);
ok((await pf.query(preStep1.slice(preStep1.indexOf("select")))).rows.length === 0, "after step 2, step 1 finds nothing");
let pfOk = true;
for (const f of MIGRATIONS.filter((f) => f >= FIRST_UPGRADE)) {
  try { await pf.exec("begin"); await pf.exec(migration(f)); await pf.exec("commit"); }
  catch (e) { pfOk = false; await pf.exec("rollback"); console.log(`    ${f}: ${e.message}`); }
}
ok(pfOk, "then every later migration applies");
ok((await pf.query(`select assignee_id from issues where id = $1`, [stuck])).rows[0].assignee_id === null, "… with the departed member unassigned");
ok((await pf.query(`select s.team_id from issues i join workflow_states s on s.id = i.state_id where i.id = $1`, [stuck])).rows[0].team_id === pteam.id,
  "… and the issue back on its own team's state");
ok(!(await pFails(pa, `update issues set priority = 2 where id = $1`, [stuck])), "the issue is editable");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
