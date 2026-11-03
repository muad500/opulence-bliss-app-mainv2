// Offline only: PGlite is an in-memory PostgreSQL, never a Supabase connection.
// Usage: PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite node scripts/test-launch-polish-db.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE)
  throw Error(
    "Set PGLITE_MODULE to the locally installed PGlite package. This script never accepts a database URL.",
  );
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
function expanded(file) {
  return readFileSync(file, "utf8")
    .replace(/^\\set .*\n/gm, "")
    .replace(/^\\ir (.*)$/gm, (_, fileName) =>
      expanded(resolve(dirname(file), fileName)),
    );
}
let checks = 0;
const sql = async (text) => db.exec(text);
async function value(text) {
  return (await db.query(text)).rows[0];
}
async function equal(text, expected, description) {
  assert.deepEqual(Object.values(await value(text))[0], expected, description);
  checks++;
  console.log(`PASS ${description}`);
}
async function denied(text, pattern, description) {
  try {
    await db.exec(text);
  } catch (error) {
    assert.match(error.message, pattern, description);
    checks++;
    console.log(`PASS ${description}`);
    return;
  }
  throw Error(`Expected refusal: ${description}`);
}
const admin = `select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003","aal":"aal2"}',false);`;
const customer = `select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);`;
const worker = `select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);`;
const service = `select set_config('request.jwt.claims','{"role":"service_role"}',false);`;
try {
  assert.ok(db instanceof PGlite);
  assert.match((await value("select version()")).version, /PostgreSQL 17\./);
  const localDatabase = (await value("select current_database() as name")).name;
  assert.match(localDatabase, /^[a-z_][a-z0-9_]*$/);
  // The pre-existing fixture's database-name guard is adapted ONLY inside this
  // proven in-memory engine. Its on-disk source and normal psql guard stay intact.
  await sql(
    expanded("supabase/tests/launch_safety.sql").replace(
      "current_database()<>'launch_safety_test'",
      `current_database()<>'${localDatabase}'`,
    ),
  );
  await sql(`reset role; ${service}
    alter table packages add column service_type text default 'cleaning',add column description text,add column inclusions text[] default array['Fixture task'],add column good_to_know text[];
    alter table providers add column services text[] default array['cleaning'],add column is_suspended boolean default false;
    alter table bookings add column retention_ended_at timestamptz;
    alter table account_legal_acceptances add column id bigint generated always as identity,add column acceptance_evidence jsonb;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table account_incidents(id uuid primary key default gen_random_uuid(),reporter_id uuid not null references profiles(id),booking_id uuid references bookings(id),category text,description text,status text default 'open',created_at timestamptz default now(),reviewed_by uuid,reviewed_at timestamptz,resolution_note text,log_kind text default 'incident');
    create function retention_candidates() returns table(category text,entity_id text,scope jsonb,files jsonb) language sql as $$select null::text,null::text,null::jsonb,null::jsonb where false$$;
    create function apply_retention_candidate(text,text,jsonb) returns void language sql as $$select$$;
    create function retention_has_hold(jsonb) returns boolean language sql as $$select false$$;
    create function retention_delete_authorised() returns boolean language sql as $$select false$$;
    create function notification_essential_email(text) returns boolean language sql as $$select $1 ~ '(security|verification code)'$$;
    create function effective_booking_cleaner_hourly_pence(uuid) returns integer language sql as $$select (terms->>'cleanerHourlyPence')::integer from booking_cleaning_billing_terms where booking_id=$1$$;
    update profiles set email=id::text||'@example.invalid';
    create type booking_status as enum('offered','declined','scheduled','in_progress','completed','cancelled','needs_review');
    create table booking_transitions(from_status text,to_status text,actor_kind text,required_assignment text,reason_required boolean,note text,primary key(from_status,to_status,actor_kind));
    insert into booking_transitions values('scheduled','cancelled','admin','none',true,null),('in_progress','cancelled','admin','none',true,null),('scheduled','cancelled','customer','customer',false,null),('offered','cancelled','customer','customer',false,null);
    alter table booking_offers add column provider_id uuid;
  `);
  await sql(
    "drop function public._apply_booking_transition(uuid,text,uuid,text,text,jsonb)",
  );
  await sql(
    readFileSync("supabase/migrations/20260806000200_rebroadcast.sql", "utf8"),
  );
  await sql(
    readFileSync(
      "supabase/migrations/20261027000400_thirty_minute_checkin_admin_alert.sql",
      "utf8",
    ),
  );
  for (const file of [
    "20261103115524_launch_polish_package_scopes.sql",
    "20261103115526_cleaning_job_evidence.sql",
    "20261103115527_launch_operations_communications.sql",
    "20261103115529_staff_visit_outcomes.sql",
    "20261103124258_recorded_outcome_legacy_guard.sql",
  ]) {
    await sql(readFileSync(`supabase/migrations/${file}`, "utf8"));
    console.log(`INSTALLED ${file}`);
  }
  await equal(
    "select count(*)::integer from cleaning_job_evidence",
    0,
    "existing bookings acquire no retrospective checklist gate",
  );
  await sql("update cleaning_job_evidence_control set enabled=true where id");
  await equal(
    "select complaint_ack_due('2026-12-24T10:00:00Z')::text",
    "2026-12-31 17:00:00+00",
    "three working days exclude Christmas, Boxing Day substitute and weekend",
  );
  for (const [kind, days] of [
    ["standard", 14],
    ["complex", 28],
    ["data", 30],
  ]) {
    await sql(
      `insert into account_incidents(reporter_id,log_kind,category,description,complaint_kind) values('00000000-0000-4000-8000-000000000001','complaint','booking','Fictional complaint for local testing only','${kind}');`,
    );
    await equal(
      `select (extract(epoch from reply_due_at-created_at)/86400)::integer from account_incidents where complaint_kind='${kind}'`,
      days,
      `${kind} reply deadline is ${days} days`,
    );
  }
  await equal(
    "select count(*)::integer from launch_operation_emails where kind='complaint_ack'",
    3,
    "one acknowledgement is durably queued per complaint",
  );
  const incident = (
    await value(
      "select id from account_incidents where complaint_kind='standard'",
    )
  ).id;
  await sql(customer);
  await denied(
    `select prepare_complaint_response('${incident}','reply','{}')`,
    /Authenticator staff/,
    "customers cannot send staff complaint replies",
  );
  await sql(admin);
  await denied(
    `select prepare_complaint_response('${incident}','reply','{}')`,
    /Explain what/,
    "empty findings cannot be sent as a reply",
  );
  await sql(
    `select prepare_complaint_response('${incident}','reply','{"checked":"the fictional visit records","findings":"the fictional issue was confirmed","action":"arrange a suitable remedy"}');`,
  );
  await equal(
    "select count(*)::integer from launch_operation_emails where kind='complaint_reply'",
    1,
    "staff reply is queued with a stable idempotency identity",
  );
  await sql(service);
  const book = (
    await value(
      "select launch_cleaning_fixture('One-Time Essential Clean',now()-interval '1 hour') as id",
    )
  ).id;
  await sql(
    `update booking_cleaning_billing_terms set terms=terms||'{"cancellationBasis":"booking_total"}'::jsonb where booking_id='${book}';`,
  );
  await sql(customer);
  await denied(
    `select prepare_recorded_visit_outcome('${book}','unsafe_home','Fictional unsafe-home report',null,1)`,
    /Authenticator staff/,
    "customer cannot invoke the full-price exception",
  );
  await sql(admin);
  await denied(
    `select prepare_recorded_visit_outcome('${book}','unsafe_home','',null,1)`,
    /reason is required/,
    "full-price exception requires a reason",
  );
  const unsafe = (
    await value(
      `select prepare_recorded_visit_outcome('${book}','unsafe_home','Fictional unsafe-home report for an offline test',null,1) as op`,
    )
  ).op;
  await equal(
    `select charge_pence from staff_visit_outcomes where booking_id='${book}'`,
    7500,
    "unsafe-home exception retains the full paid booking, not just 70 percent",
  );
  assert.equal(unsafe.parameters.refunds.length, 0);
  checks++;
  const again = (
    await value(
      `select prepare_recorded_visit_outcome('${book}','unsafe_home','Fictional unsafe-home report for an offline test',null,1) as op`,
    )
  ).op;
  assert.equal(again.id, unsafe.id);
  checks++;
  await sql(service);
  await sql(
    `select finish_visit_money_operation('${unsafe.id}','succeeded','[]');`,
  );
  await equal(
    `select cleaner_pay_pence from cleaning_cancellation_settlements where booking_id='${book}'`,
    3000,
    "unsafe-home compensation is funded by the paid cleaning source",
  );
  const partial = (
    await value(
      "select launch_cleaning_fixture('One-Time Essential Clean',now()-interval '2 hours') as id",
    )
  ).id;
  await sql(worker);
  await sql(
    `select save_cleaning_job_evidence('${partial}',true,true,'','{}','',false);`,
  );
  await sql(service);
  await sql(
    `update bookings set status='in_progress' where id='${partial}'; insert into check_ins(booking_id,arrived_at) values('${partial}',now()-interval '60 minutes');`,
  );
  await sql(admin);
  await denied(
    `select prepare_recorded_visit_outcome('${partial}','customer_stopped','Fictional customer asked us to stop',61,1)`,
    /actually worked/,
    "staff cannot record more minutes than elapsed",
  );
  const stopped = (
    await value(
      `select prepare_recorded_visit_outcome('${partial}','customer_stopped','Fictional customer asked us to stop',30,1) as op`,
    )
  ).op;
  assert.equal(stopped.parameters.refunds[0].amountPence, 6250);
  checks++;
  await equal(
    `select charge_pence from staff_visit_outcomes where booking_id='${partial}'`,
    1250,
    "customer stop retains 30 minutes only and refunds all extras and products",
  );
  await sql(service);
  const results = stopped.parameters.refunds.map((r) => ({
    type: "refund",
    id: "re_local",
    status: "succeeded",
    chargeId: r.chargeId,
    amountPence: r.amountPence,
    refundedLines: r.refundedLines,
  }));
  await db.query("select finish_visit_money_operation($1,'succeeded',$2)", [
    stopped.id,
    JSON.stringify(results),
  ]);
  await db.query("select finish_visit_money_operation($1,'succeeded',$2)", [
    stopped.id,
    JSON.stringify(results),
  ]);
  await equal(
    `select cleaner_pay_pence from cleaning_cancellation_settlements where booking_id='${partial}'`,
    750,
    "partial visit pays exactly worked time, once",
  );
  const replacement = (
    await value(
      "select launch_cleaning_fixture('One-Time Essential Clean',now()+interval '2 days') as id",
    )
  ).id;
  await sql(
    `select _apply_booking_transition('${replacement}','offered','00000000-0000-4000-8000-000000000002','provider','Fictional cleaner cannot attend','{}');`,
  );
  await equal(
    `select count(*)::integer from booking_replacement_options where booking_id='${replacement}'`,
    1,
    "cleaner withdrawal creates the customer's free cancellation choice",
  );
  await equal(
    `select count(*)::integer from launch_operation_emails where booking_id='${replacement}' and kind='replacement'`,
    1,
    "the customer is emailed when a replacement is sought",
  );
  await sql(worker);
  await denied(
    `select prepare_recorded_visit_outcome('${replacement}','replacement_cancel','Fictional free cancellation',null,1)`,
    /Free replacement cancellation/,
    "another account cannot take a customer's free cancellation choice",
  );
  await sql(customer);
  const replacementOp = (
    await value(
      `select prepare_recorded_visit_outcome('${replacement}','replacement_cancel','Fictional free cancellation',null,1) as op`,
    )
  ).op;
  assert.equal(replacementOp.parameters.refunds[0].amountPence, 7500);
  checks++;
  const retryReplacement = (
    await value(
      `select prepare_recorded_visit_outcome('${replacement}','replacement_cancel','Fictional free cancellation',null,1) as op`,
    )
  ).op;
  assert.equal(retryReplacement.id, replacementOp.id);
  checks++;
  await sql(service);
  const reassignment = (
    await value(
      "select launch_cleaning_fixture('One-Time Essential Clean',now()+interval '2 days') as id",
    )
  ).id;
  await sql(
    `select _apply_booking_transition('${reassignment}','offered',null,'system','Fictional cleaner can no longer attend','{}');`,
  );
  await equal(
    `select count(*)::integer from booking_replacement_options where booking_id='${reassignment}'`,
    1,
    "staff/system re-offers also preserve the free cancellation entitlement",
  );
  const legacy = (
    await value(
      "select launch_cleaning_fixture('One-Time Essential Clean',now()-interval '1 hour') as id",
    )
  ).id;
  await sql(
    `update booking_cleaning_billing_terms set terms=terms-'productsCleanerPayPence' where booking_id='${legacy}';`,
  );
  await sql(admin);
  await denied(
    `select prepare_recorded_visit_outcome('${legacy}','unsafe_home','Fictional older booking requires separate review',null,1)`,
    /older booking needs its agreed payment/,
    "unsupported old payout terms cannot strand a prepared staff decision",
  );
  await sql(service);
  await sql(
    `update booking_cleaning_billing_terms set terms=terms-'productsCleanerPayPence' where booking_id='${reassignment}';`,
  );
  await sql(customer);
  const legacyReplacement = (
    await value(
      `select prepare_recorded_visit_outcome('${reassignment}','replacement_cancel','Fictional free replacement cancellation',null,1) as op`,
    )
  ).op;
  assert.equal(legacyReplacement.parameters.refunds[0].amountPence, 7500);
  checks++;
  await sql(service);
  await sql(`insert into profiles(id,role,full_name,email) values('00000000-0000-4000-8000-000000000099','provider','Alex Test','alex@example.invalid');
    insert into account_legal_acceptances(user_id,document_slug,version,accepted_at,acceptance_evidence)
    select '00000000-0000-4000-8000-000000000099',slug,'1.0','2026-11-03T10:00:00Z',jsonb_build_object('document',jsonb_build_object('slug',slug,'title',slug,'version','1.0')) from unnest(array['professional-partner-agreement','dbs-data','safeguarding']) slug;
    insert into providers(id,profile_id,services) values('10000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000099',array['cleaning']);
    update providers set services=array['cleaning'] where id='10000000-0000-4000-8000-000000000099';`);
  await equal(
    "select count(*)::integer from launch_operation_emails where kind='welcome'",
    1,
    "registration retries queue just one welcome using the accepted documents",
  );
  await equal(
    `select count(*)::integer from launch_operation_emails e where kind='receipt' and booking_id='${replacement}'`,
    1,
    "a one-off payment gets one receipt",
  );
  await sql(
    `update payments set status='succeeded' where booking_id='${replacement}';`,
  );
  await equal(
    `select count(*)::integer from launch_operation_emails e where kind='receipt' and booking_id='${replacement}'`,
    1,
    "replaying a succeeded payment cannot duplicate its receipt",
  );
  const work = (
    await value(
      "select launch_cleaning_fixture('One-Time Essential Clean',now()+interval '1 hour') as id",
    )
  ).id;
  await equal(
    `select scope_confirmed_at is null from cleaning_job_evidence where booking_id='${work}'`,
    true,
    "new visits start with an unticked checklist",
  );
  await denied(
    `update bookings set status='in_progress' where id='${work}'`,
    /before-work checklist/,
    "new visits cannot check in without scope and hazard review",
  );
  await sql(worker);
  await sql(
    `select save_cleaning_job_evidence('${work}',true,true,'','{}','',false);`,
  );
  await sql(service);
  await sql(`update bookings set status='in_progress' where id='${work}';`);
  await denied(
    `update bookings set status='completed' where id='${work}'`,
    /photo step/,
    "new visits cannot complete before the final checklist and photo step",
  );
  await sql(worker);
  const tasks = (
    await value(
      `select tasks from cleaning_job_evidence where booking_id='${work}'`,
    )
  ).tasks;
  const answers = Object.fromEntries(
    tasks.map((_, i) => [i, { result: "done" }]),
  );
  await denied(
    `select save_cleaning_job_evidence('${work}',true,true,'','${JSON.stringify(Object.fromEntries(tasks.map((_, i) => [i, {}])))}','Photos were not requested',true);`,
    /Complete each task/,
    "empty per-task results cannot bypass checklist completion",
  );
  await denied(
    `select save_cleaning_job_evidence('${work}',true,true,'','${JSON.stringify(answers)}','',true);`,
    /finished-work photos/,
    "photo step requires a photo or an explicit explanation",
  );
  await db.query(
    "select save_cleaning_job_evidence($1,true,true,'',$2,'Photos were not requested for this fictional visit',true)",
    [work, JSON.stringify(answers)],
  );
  await sql(service);
  await sql(`update bookings set status='completed' where id='${work}';`);
  await equal(
    `select status from bookings where id='${work}'`,
    "completed",
    "completed checklist permits ordinary checkout",
  );
  await sql(
    `insert into booking_checkin_safety_alerts(booking_id,scheduled_at,provider_id) select id,scheduled_at,provider_id from bookings where id='${book}';`,
  );
  const scheduled = (
    await value(`select scheduled_at::text from bookings where id='${book}'`)
  ).scheduled_at;
  await sql(admin);
  await denied(
    `select record_booking_welfare_step('${book}','${scheduled}','emergency_contacted','Fictional attempt before contacting the cleaner')`,
    /15 minutes/,
    "welfare escalation requires contacting the cleaner first",
  );
  await sql(
    `select record_booking_welfare_step('${book}','${scheduled}','cleaner_contacted','Fictional call and message; no answer yet');`,
  );
  await denied(
    `select record_booking_welfare_step('${book}','${scheduled}','emergency_contacted','Fictional attempt before waiting fifteen minutes')`,
    /15 minutes/,
    "welfare escalation enforces the 15-minute wait",
  );
  await sql(
    `update booking_welfare_steps set created_at=now()-interval '16 minutes' where booking_id='${book}'; select record_booking_welfare_step('${book}','${scheduled}','emergency_contacted','Fictional emergency contact call; no answer'); select record_booking_welfare_step('${book}','${scheduled}','police_welfare_requested','Fictional welfare check requested by staff');`,
  );
  await equal(
    `select count(*)::integer from booking_welfare_steps where booking_id='${book}'`,
    3,
    "each real-action test step records actor, time and note",
  );
  console.log(
    `${checks} launch-polish database checks passed. No remote database or payment provider was contacted.`,
  );
} catch (error) {
  console.error(
    `Database check failed: ${error.message}\n${error.where ?? ""}`,
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
