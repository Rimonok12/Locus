/* ─── Locus · database test-suite ──────────────────────────────────────────
   Runs every migration in supabase/migrations against an in-process Postgres
   (PGlite) with a minimal Supabase auth shim, then exercises tenancy (RLS),
   numbering, validation, history and notification triggers as real users.
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

async function as(userId, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
  await db.exec(userId ? "set role authenticated" : "set role anon");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function fails(userId, sql, params = []) {
  try { await as(userId, sql, params); return null; }
  catch (e) { return e.message; }
}

await db.exec(PRELUDE);
for (const f of readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  if (f.includes("storage")) continue; // storage schema is Supabase-only
  await db.exec(readFileSync(join(root, "supabase/migrations", f), "utf8"));
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

console.log("\nworkspace delete cascade");
ok((await as(alice, `delete from workspaces where id = $1 returning id`, [ws.id])).rows.length === 1, "admin deletes workspace (full cascade succeeds)");
await db.exec("reset role");
ok((await db.query(`select count(*)::int as c from issues`)).rows[0].c === 0, "all issues gone");

console.log("\nuser delete cascade");
const ws2 = (await as(alice, `select * from create_workspace('Solo', 'solo')`)).rows[0];
await db.query(`delete from auth.users where id = $1`, [alice]);
ok((await db.query(`select count(*)::int as c from workspace_members where workspace_id = $1`, [ws2.id])).rows[0].c === 0, "deleting a user cascades without tripping admin guard");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
