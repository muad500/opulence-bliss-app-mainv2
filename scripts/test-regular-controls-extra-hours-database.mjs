// Offline PostgreSQL regression tests, using the deployed d429777 billing
// definitions as the baseline. No accounts, email, payment or hosted DB access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
process.on("uncaughtException", (error) => {
  console.error(error.message);
  console.error(error.where ?? "");
  process.exit(1);
});
const { PGlite } = await import(
  pathToFileURL(process.env.RETENTION_PGLITE_MODULE).href
);
const db = new PGlite();
const baseline = JSON.parse(
  readFileSync(
    "scripts/fixtures/regular-extra-hours-billing-baseline.json",
    "utf8",
  ),
);
const foundation = readFileSync(
  "supabase/migrations/20261014000200_per_visit_billing_foundations.sql",
  "utf8",
);
await db.exec(
  "set time zone 'UTC'; create role anon; create role authenticated; create role service_role;" +
    "create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.uid',true),'')::uuid $$;" +
    "create function auth.role() returns text language sql as $$ select current_setting('request.role',true) $$;" +
    "create table profiles(id uuid primary key,role text default 'client',account_deleted_at timestamptz);" +
    "create table providers(id uuid primary key,profile_id uuid);" +
    "create table regular_booking_series(id uuid primary key,customer_id uuid,billing_paused boolean default false,pause_generation integer default 0,pause_reason text,paused_at timestamptz,resumed_at timestamptz);" +
    "create table bookings(id uuid primary key,customer_id uuid,provider_id uuid,regular_series_id uuid,regular_visit_number integer,status text,scheduled_at timestamptz,duration_minutes integer,cleaning_extras jsonb,household_notes text,created_at timestamptz default now(),offer_expires_at timestamptz,optional_scheduled_at timestamptz[]);" +
    "create table booking_offers(id uuid primary key,booking_id uuid,status text);" +
    "create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid,title text,body text,href text);" +
    "create table booking_cleaning_billing_terms(booking_id uuid,terms jsonb);" +
    "create table payments(id uuid primary key default gen_random_uuid(),booking_id uuid,stripe_payment_ref text,gross_amount numeric,status text,split_breakdown jsonb,created_at timestamptz default now(),status_changed_at timestamptz,kind text);" +
    "create table payment_events(payment_id uuid,from_status text,to_status text,actor_kind text,reason text,meta jsonb);" +
    "create table regular_payment_notices(operation_id uuid,booking_id uuid,scheduled_at timestamptz,amount_pence integer,email_sent_at timestamptz,in_app_sent_at timestamptz);" +
    "create function is_admin() returns boolean language sql as $$select false$$;" +
    "create function lock_visit_series(uuid) returns void language sql as $$select$$;" +
    "create function provider_service_approved(uuid,text) returns boolean language sql as $$select true$$;" +
    "create function cleaning_statutory_cancellation_free(uuid) returns boolean language sql as $$select false$$;" +
    "create function record_unmatched_visit(uuid) returns void language sql as $$select$$;" +
    "create function late_acceptance_card_update_deadline(timestamptz,timestamptz) returns timestamptz language sql as $$select null::timestamptz$$;" +
    "create function queue_visit_matching_notice(uuid,uuid,text,text,text,text,text) returns void language sql as $$select$$;" +
    "create function _apply_booking_transition(uuid,text,uuid,text,text,jsonb) returns void language sql as $$update bookings set status=$2 where id=$1$$;" +
    "create function professional_booking_conflict(uuid,uuid,timestamptz) returns text language sql as $$select nullif(current_setting('fixture.conflict',true),'')$$;",
);
await db.exec(
  foundation.slice(
    foundation.indexOf("create table public.booking_visit_billing"),
    foundation.indexOf("alter table public.booking_visit_billing enable"),
  ),
);
await db.exec(
  "alter table booking_visit_billing add policy_refund_required boolean default false,add blocked_charge_operation uuid,add assigned_at timestamptz,add late_payment_grace_until timestamptz,add late_payment_grace_assignment_at timestamptz;" +
    "alter table booking_visit_money_operations drop constraint booking_visit_money_operations_operation_type_check;" +
    "alter table booking_visit_money_operations add constraint booking_visit_money_operations_operation_type_check check(operation_type in ('charge','extras','cancel','unfilled','late_refund','policy_refund'));",
);

await db.exec(`
create table account_profile_details(user_id uuid primary key,contact_sms boolean default false);
create table visit_matching_notices(
 id uuid primary key default gen_random_uuid(),booking_id uuid,scheduled_at timestamptz,
 series_id uuid,series_generation integer default 0,user_id uuid,event_key text,kind text,
 channel text,title text,body text,href text,expires_at timestamptz,status text default 'pending',
 claim_token uuid,sent_at timestamptz,
 constraint visit_matching_notices_kind_check check(kind in ('admin_48h','customer_24h','unmatched_cancelled','series_paused','series_resumed','payment_reconciled')),
 unique(user_id,event_key,channel)
);
`);
const noticeSource = readFileSync(
  "supabase/migrations/20261018000200_matching_notice_freshness.sql",
  "utf8",
);
const queueStart = noticeSource.indexOf(
  "create or replace function public.queue_visit_matching_notice(",
);
await db.exec(
  noticeSource.slice(
    queueStart,
    noticeSource.indexOf("$function$;", queueStart) + 12,
  ),
);

await db.exec(`
alter table booking_offers add provider_id uuid;
create table job_offer_settings(id boolean primary key,first_wave_size integer,second_wave_after_minutes integer,version integer);
insert into job_offer_settings values(true,5,10,1);
create table booking_offer_runs(booking_id uuid primary key,cadence_minutes integer,run_id uuid,wave_size integer,wave_wait_minutes integer,settings_version integer,started_at timestamptz default now(),first_wave_at timestamptz,second_wave_due_at timestamptz,second_wave_at timestamptz,exhausted_at timestamptz);
create table booking_offer_queue(booking_id uuid,provider_id uuid,queue_position integer,ranking jsonb);
create table job_offer_emails(id uuid primary key,booking_id uuid,provider_id uuid,run_id uuid,status text,claim_token uuid);
create table provider_profile_settings(provider_id uuid primary key,alert_email boolean default true);
create function _rank_cleaning_offers(uuid) returns table(provider_id uuid,score numeric,factors jsonb) language sql as $$select id,1::numeric,'{}'::jsonb from providers limit 1$$;
create function _advance_cleaning_offer_waves(uuid) returns jsonb language plpgsql as $$begin update booking_offer_runs set first_wave_at=now(),second_wave_due_at=now()+interval '10 minutes' where booking_id=$1; return '{}'::jsonb;end$$;
create function _cleaning_offer_qualified(uuid,uuid) returns boolean language sql as $$select true$$;
create function notification_category(text,text) returns text language sql as $$select 'schedule'::text$$;
create function notification_essential_email(text) returns boolean language sql as $$select false$$;
create function notification_channel_allowed(uuid,text,text,text,uuid default null,boolean default false) returns boolean language sql as $$select $6 or coalesce(current_setting('fixture.notifications',true),'true')<>'false'$$;
`);
const allowedStart = noticeSource.indexOf(
  "create or replace function public.visit_matching_notice_allowed(",
);
await db.exec(
  noticeSource.slice(
    allowedStart,
    noticeSource.indexOf("$function$;", allowedStart) + 12,
  ),
);
const waveSource = readFileSync(
  "supabase/migrations/20261019000500_ranked_cleaning_offer_waves.sql",
  "utf8",
);
const waveGateStart = waveSource.indexOf(
  "alter function public.visit_matching_notice_allowed(uuid, uuid)",
);
await db.exec(
  waveSource.slice(
    waveGateStart,
    waveSource.indexOf(
      "alter function public.finish_visit_matching_notice(",
      waveGateStart,
    ),
  ),
);
const channelSource = readFileSync(
  "supabase/migrations/20261022000100_notification_channels.sql",
  "utf8",
);
const channelStart = channelSource.indexOf(
  "alter function public.visit_matching_notice_allowed(uuid,uuid)",
);
await db.exec(
  channelSource.slice(
    channelStart,
    channelSource.indexOf(
      "create or replace function public.chat_message_email_eligible",
      channelStart,
    ),
  ),
);
for (const name of [
  "gate_before_notice",
  "gate",
  "prepare",
  "finish",
  "resume",
])
  await db.exec(baseline[name]);
await db.exec(
  readFileSync(
    "supabase/migrations/20261031000200_customer_regular_series_controls.sql",
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261031000300_customer_approved_cleaning_extra_hours.sql",
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261031000400_regular_series_end_notice.sql",
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261031000500_regular_resume_payment_notice_copy.sql",
    "utf8",
  ),
);

await db.exec(
  readFileSync(
    "supabase/migrations/20261031000600_restart_ranked_offers_on_series_resume.sql",
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261031000700_preserve_offer_and_channel_notice_gates.sql",
    "utf8",
  ),
);
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.v;
const call = (name, args = []) =>
  value(
    "select public." +
      name +
      "(" +
      args.map((_, i) => "$" + (i + 1)).join(",") +
      ") as v",
    args,
  );
const identity = async (uid, role = "service_role") => {
  await db.query(
    "select set_config('request.uid',$1,false),set_config('request.role',$2,false)",
    [uid, role],
  );
};
const c = randomUUID(),
  w = randomUUID(),
  p = randomUUID(),
  stranger = randomUUID();
await db.query("insert into profiles(id) values($1),($2),($3)", [
  c,
  w,
  stranger,
]);
await db.query("insert into providers values($1,$2)", [p, w]);
async function fixture({
  assigned = true,
  paid = true,
  series = null,
  status = "scheduled",
  hours = 72,
  minutes = 120,
} = {}) {
  const id = randomUUID();
  const scope = {
    baseMinutes: minutes,
    durationMinutes: minutes,
    basePricePence: 4598,
    grossPence: 4598,
    netPence: 4598,
    addons: [],
    bringsProducts: false,
    notes: "FICTIONAL",
  };
  const lines = [
    {
      id: "cleaning",
      label: "Cleaning",
      amountPence: 4598,
      reservedMinutes: minutes,
    },
  ];
  await db.query(
    "insert into bookings(id,customer_id,provider_id,regular_series_id,regular_visit_number,status,scheduled_at,duration_minutes,cleaning_extras) values($1,$2,$3,$4,1,$5,now()+make_interval(hours=>$6),$7,$8)",
    [
      id,
      c,
      assigned ? p : null,
      series,
      status,
      hours,
      minutes,
      JSON.stringify(scope),
    ],
  );
  await db.query(
    "insert into booking_visit_billing(booking_id,customer_id,stripe_customer_id,stripe_payment_method_id,card_consent_at,card_consent_version,charge_due_at,amount_pence,base_pence,line_items,status,assigned_at) values($1,$2,'cus_fixture','pm_fixture',now(),'fixture',now(),4598,4598,$3,$4,now())",
    [id, c, JSON.stringify(lines), paid ? "paid" : "unpaid"],
  );
  await db.query("insert into booking_cleaning_billing_terms values($1,$2)", [
    id,
    JSON.stringify({
      cancellationRefundPercent: {
        full: 100,
        three_quarter: 75,
        half: 50,
        none: 30,
      },
      cancellationBasis: "booking_total",
    }),
  ]);
  return id;
}
let passes = 0;
const pass = (s) => {
  passes++;
  console.log("PASS " + s);
};
await identity(w, "authenticated");
const job = await fixture({ status: "in_progress", hours: -1 });
let offer = await call("offer_cleaning_extra_hours", [job, 60]);
assert.equal(offer.amount_pence, 2299);
assert.equal(
  await value("select duration_minutes as v from bookings where id=$1", [job]),
  120,
);
await identity(stranger, "service_role");
await assert.rejects(
  call("prepare_cleaning_extra_hours", [offer.id, stranger, 2299]),
);
await assert.rejects(call("prepare_cleaning_extra_hours", [offer.id, c, 1]));
pass(
  "only the customer can approve the exact booked hourly amount; an offer does not extend the job",
);
await identity(c);
let prepared = await call("prepare_cleaning_extra_hours", [offer.id, c, 2299]);
assert.equal(
  await value("select duration_minutes as v from bookings where id=$1", [job]),
  180,
);
assert.equal(
  (await call("visit_charge_gate", [job, prepared.operation, "extras"]))
    .allowed,
  true,
);
const same = await call("prepare_cleaning_extra_hours", [offer.id, c, 2299]);
assert.equal(same.operation, prepared.operation);
pass(
  "an in-progress visit can reserve agreed extra time; checkout retries reuse one operation",
);
const params = await value(
  "select parameters as v from booking_visit_money_operations where id=$1",
  [prepared.operation],
);
const results = [
  {
    type: "charge",
    id: "pi_extra_fixture",
    status: "succeeded",
    amountPence: 2299,
    lines: params.added,
  },
];
await call("finish_visit_money_operation", [
  prepared.operation,
  "succeeded",
  JSON.stringify(results),
  null,
]);
await call("finish_visit_money_operation", [
  prepared.operation,
  "succeeded",
  JSON.stringify(results),
  null,
]);
assert.equal(
  await value(
    "select base_pence as v from booking_visit_billing where booking_id=$1",
    [job],
  ),
  6897,
);
assert.equal(
  await value(
    "select count(*)::integer as v from payments where booking_id=$1",
    [job],
  ),
  1,
);
assert.equal(
  await value(
    "select status as v from cleaning_extra_hours_offers where id=$1",
    [offer.id],
  ),
  "paid",
);
pass(
  "a successful extra charge is recorded once, preserves pay snapshots and increases base price once",
);
await identity(w, "authenticated");
offer = await call("offer_cleaning_extra_hours", [job, 30]);
assert.equal(offer.amount_pence, 1150);
await identity(c);
prepared = await call("prepare_cleaning_extra_hours", [offer.id, c, 1150]);
await call("finish_visit_money_operation", [
  prepared.operation,
  "failed",
  "[]",
  "Card declined",
]);
assert.equal(
  await value("select duration_minutes as v from bookings where id=$1", [job]),
  180,
);
assert.equal(
  await value(
    "select status as v from booking_visit_billing where booking_id=$1",
    [job],
  ),
  "paid",
);
pass(
  "a declined extra payment restores the original duration and keeps the original paid visit",
);
await identity(w, "authenticated");
offer = await call("offer_cleaning_extra_hours", [job, 30]);
await db.query("select set_config('fixture.conflict','Calendar clash',false)");
await identity(c);
await assert.rejects(
  call("prepare_cleaning_extra_hours", [offer.id, c, 1150]),
  /Calendar clash/,
);
assert.equal(
  await value(
    "select status as v from cleaning_extra_hours_offers where id=$1",
    [offer.id],
  ),
  "pending",
);
await db.query("select set_config('fixture.conflict','',false)");
pass("a calendar clash rolls back approval and reservation before any charge");
await identity(c, "authenticated");
await call("decline_cleaning_extra_hours", [offer.id]);
await assert.rejects(call("prepare_cleaning_extra_hours", [offer.id, c, 1150]));
await identity(w, "authenticated");
const long = await fixture({ minutes: 480 });
await assert.rejects(
  call("offer_cleaning_extra_hours", [long, 30]),
  /eight hours/,
);
pass("declines and the whole-visit eight-hour limit are enforced");
const series = randomUUID();
await db.query(
  "insert into regular_booking_series(id,customer_id) values($1,$2)",
  [series, c],
);
const assigned = await fixture({ series, paid: false });
const held = await fixture({
  series,
  assigned: false,
  paid: false,
  status: "offered",
});

const oldRun = randomUUID();
await db.query(
  "insert into booking_offer_runs(booking_id,run_id,first_wave_at,second_wave_at,exhausted_at) values($1,$2,now(),now(),now())",
  [held, oldRun],
);
await db.query(
  "update bookings set status='declined',offer_expires_at=now()-interval '1 hour' where id=$1",
  [held],
);
const list = async (ids, cancels) =>
  Promise.all(
    ids.map(async (id, i) => ({
      id,
      scheduledAt: await value(
        "select scheduled_at as v from bookings where id=$1",
        [id],
      ),
      revision: 1,
      cancel: cancels[i],
      parameters: { refundPercent: 100, refunds: [] },
    })),
  );
await identity(c);
await assert.rejects(
  call("control_regular_series", [
    series,
    stranger,
    "pause",
    0,
    JSON.stringify(await list([assigned, held], [true, false])),
  ]),
);
const controlled = await call("control_regular_series", [
  series,
  c,
  "pause",
  0,
  JSON.stringify(await list([assigned, held], [true, false])),
]);
assert.equal(controlled.operations.length, 1);
assert.equal(
  await value("select status as v from bookings where id=$1", [assigned]),
  "cancelled",
);
assert.equal(
  await value("select status as v from bookings where id=$1", [held]),
  "declined",
);
assert.equal(
  await value(
    "select billing_paused as v from regular_booking_series where id=$1",
    [series],
  ),
  true,
);
pass(
  "pause atomically stops series billing and prepares per-visit cancellation; strangers are refused",
);
await identity(c, "authenticated");
await assert.rejects(call("resume_regular_series", [series, 1]), /processing/);
await identity(c);
await call("finish_visit_money_operation", [
  controlled.operations[0],
  "succeeded",
  "[]",
  null,
]);
await identity(c, "authenticated");
await call("resume_regular_series", [series, 1]);
assert.equal(
  await value("select status as v from bookings where id=$1", [assigned]),
  "cancelled",
);
assert.equal(
  await value(
    "select billing_paused as v from regular_booking_series where id=$1",
    [series],
  ),
  false,
);
pass("resume waits for payment recovery and never revives cancelled visits");
const restartedRun = await value(
  "select run_id as v from booking_offer_runs where booking_id=$1",
  [held],
);
assert.notEqual(restartedRun, oldRun);
assert.equal(
  await value("select status as v from bookings where id=$1", [held]),
  "offered",
);
assert.ok(
  await value(
    "select first_wave_at is not null as v from booking_offer_runs where booking_id=$1",
    [held],
  ),
);
await call("resume_regular_series", [series, 1]);
assert.equal(
  await value(
    "select run_id as v from booking_offer_runs where booking_id=$1",
    [held],
  ),
  restartedRun,
);
pass(
  "resume restarts exhausted ranked waves once and renews the matching deadline",
);

await identity(c);
const ended = await call("control_regular_series", [
  series,
  c,
  "end",
  1,
  JSON.stringify(await list([held], [true])),
]);
await call("finish_visit_money_operation", [
  ended.operations[0],
  "succeeded",
  "[]",
  null,
]);
await identity(c, "authenticated");
await assert.rejects(call("resume_regular_series", [series, 2]), /has ended/);
pass(
  "ending cancels remaining visits without a series fee and cannot be resumed",
);

await identity(c);
const notice = (
  await db.query(
    "select id from visit_matching_notices where kind='series_ended' and channel='email'",
  )
).rows[0];
assert.ok(notice);
const noticeToken = randomUUID();
await db.query(
  "update visit_matching_notices set status='processing',claim_token=$2 where id=$1",
  [notice.id, noticeToken],
);
assert.equal(
  await call("visit_matching_notice_allowed", [notice.id, noticeToken]),
  true,
);
await db.query(
  "update regular_booking_series set pause_generation=pause_generation+1 where id=$1",
  [series],
);
assert.equal(
  await call("visit_matching_notice_allowed", [notice.id, noticeToken]),
  false,
);
pass("series-end mail is supported and stale generations cannot send it");
await db.exec("grant select on providers to authenticated");
await identity(stranger, "authenticated");
await db.exec("set role authenticated");
assert.equal(
  await value("select count(*)::integer as v from cleaning_extra_hours_offers"),
  0,
);
await db.exec("reset role");
await identity(c, "authenticated");
await db.exec("set role authenticated");
assert.ok(
  (await value(
    "select count(*)::integer as v from cleaning_extra_hours_offers",
  )) > 0,
);
await assert.rejects(
  db.exec("update cleaning_extra_hours_offers set amount_pence=1"),
);
await db.exec("reset role");
pass(
  "offer RLS hides other people's records and participants cannot edit prices",
);

await identity(c);
const waveBooking = await fixture({
  assigned: false,
  paid: false,
  status: "offered",
});
const waveRun = randomUUID(),
  waveNotice = randomUUID(),
  waveToken = randomUUID();
await db.query(
  "insert into booking_offer_runs(booking_id,run_id) values($1,$2)",
  [waveBooking, waveRun],
);
await db.query(
  "insert into booking_offers(id,booking_id,provider_id,status) values($1,$2,$3,'open')",
  [randomUUID(), waveBooking, p],
);
await db.query(
  "insert into provider_profile_settings(provider_id,alert_email) values($1,true)",
  [p],
);
await db.query(
  "insert into job_offer_emails values($1,$2,$3,$4,'processing',$5)",
  [waveNotice, waveBooking, p, waveRun, waveToken],
);
assert.equal(
  await call("visit_matching_notice_allowed", [waveNotice, waveToken]),
  true,
);
await db.query("select set_config('fixture.notifications','false',false)");
assert.equal(
  await call("visit_matching_notice_allowed", [waveNotice, waveToken]),
  false,
);
await db.query("select set_config('fixture.notifications','true',false)");
await db.query("update booking_offers set status='lost' where booking_id=$1", [
  waveBooking,
]);
assert.equal(
  await call("visit_matching_notice_allowed", [waveNotice, waveToken]),
  false,
);
pass(
  "ranked-offer freshness and notification preferences remain around the new series notices",
);
await identity(w, "authenticated");
const delayed = await fixture({ status: "scheduled", hours: 72 });
offer = await call("offer_cleaning_extra_hours", [delayed, 60]);
await identity(c);
prepared = await call("prepare_cleaning_extra_hours", [offer.id, c, 2299]);
const delayedParams = await value(
  "select parameters as v from booking_visit_money_operations where id=$1",
  [prepared.operation],
);
await db.query("update bookings set status='cancelled' where id=$1", [delayed]);
assert.equal(
  (await call("visit_charge_gate", [delayed, prepared.operation, "extras"]))
    .allowed,
  false,
);
await call("finish_visit_money_operation", [
  prepared.operation,
  "succeeded",
  JSON.stringify([
    {
      type: "charge",
      id: "pi_delayed_extra_fixture",
      status: "succeeded",
      amountPence: 2299,
      lines: delayedParams.added,
    },
  ]),
  null,
]);
assert.equal(
  await value(
    "select policy_refund_required as v from booking_visit_billing where booking_id=$1",
    [delayed],
  ),
  true,
);
assert.equal(
  await value("select duration_minutes as v from bookings where id=$1", [
    delayed,
  ]),
  120,
);
assert.equal(
  await value(
    "select base_pence as v from booking_visit_billing where booking_id=$1",
    [delayed],
  ),
  4598,
);
assert.equal(
  await value(
    "select status as v from cleaning_extra_hours_offers where id=$1",
    [offer.id],
  ),
  "review",
);
pass(
  "a delayed captured payment after closure enters refund recovery and does not add hours or pay",
);
await identity(w, "authenticated");
const promo = await fixture();
await db.query(
  "update booking_visit_billing set discount_pence=1000 where booking_id=$1",
  [promo],
);
offer = await call("offer_cleaning_extra_hours", [promo, 60]);
assert.equal(offer.amount_pence, 2299);
pass(
  "extra time uses the booked hourly price and does not multiply a booking-level discount",
);
assert.equal(
  await value(
    "select has_function_privilege('authenticated','public.prepare_cleaning_extra_hours(uuid,uuid,integer)','execute') as v",
  ),
  false,
);
assert.equal(
  await value(
    "select has_function_privilege('anon','public.control_regular_series(uuid,uuid,text,integer,jsonb)','execute') as v",
  ),
  false,
);
pass(
  "privileged charge and series-control entry points deny direct public access",
);
console.log(JSON.stringify({ databaseChecks: passes, hosted: false }));
await db.close();
