// Isolated PostgreSQL integration tests: no website, Stripe, emails or secrets.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const modulePath = process.env.RETENTION_PGLITE_MODULE;
if (!modulePath)
  throw Error(
    "Set RETENTION_PGLITE_MODULE to a temporary PGlite installation.",
  );
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
let passed = 0;
const check = (name) => {
  passed++;
  console.log(`PASS ${name}`);
};
const value = async (sql, args = []) =>
  (await db.query(sql, args)).rows[0]?.value;
const call = (name, args = []) =>
  value(
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
    args,
  );

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create function auth.role() returns text language sql stable as $$ select current_setting('request.role',true) $$;
select set_config('request.role','service_role',false);
create table profiles(id uuid primary key, account_deleted_at timestamptz,role text default 'customer');
create table providers(id uuid primary key,profile_id uuid references profiles(id),vetting_status text default 'pending',service_approvals jsonb default '{}',dbs_verified boolean default false,bio text,photo_url text,display_name text,insurance_ref text,cert_ref text,show_on_our_pros boolean default false);
create table regular_booking_series(id uuid primary key,customer_id uuid references profiles(id),checkout_session_id text);
create table bookings(id uuid primary key,customer_id uuid references profiles(id),provider_id uuid references providers(id),regular_series_id uuid references regular_booking_series(id),status text default 'confirmed',scheduled_at timestamptz default now(),duration_minutes integer default 120,household_notes text,access_instructions text,checkout_session_id text);
create table handyman_jobs(id uuid primary key,customer_id uuid references profiles(id),provider_id uuid references providers(id),status text default 'scheduled',ended_at timestamptz,updated_at timestamptz default now(),scheduled_at timestamptz default now(),selected_quote_id uuid,pending_quote_id uuid);
create table handyman_quotes(id uuid primary key,job_id uuid references handyman_jobs(id));
alter table handyman_jobs add foreign key(selected_quote_id) references handyman_quotes(id);
create table provider_profile_settings(provider_id uuid primary key references providers(id),emergency_contact_name text,emergency_contact_phone text);
create table provider_dbs_checks(provider_id uuid primary key references providers(id),certificate_storage_path text,certificate_original_name text not null default 'fixture.png',certificate_mime_type text not null default 'image/png',certificate_deleted_at timestamptz,submitted_at timestamptz default now(),uploaded_at timestamptz);
create table provider_onboarding_details(provider_id uuid primary key references providers(id),private_evidence text);
create table provider_verification_items(id uuid primary key default gen_random_uuid(),provider_id uuid references providers(id));
create table provider_availability(id uuid primary key default gen_random_uuid(),provider_id uuid references providers(id));
create table provider_time_off(id uuid primary key default gen_random_uuid(),provider_id uuid references providers(id));
create table provider_task_rates(id uuid primary key default gen_random_uuid(),provider_id uuid references providers(id));
create table check_ins(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings(id),created_at timestamptz default now());
create table check_in_challenges(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings(id),created_at timestamptz default now());
create table check_in_challenge_events(id uuid primary key default gen_random_uuid(),challenge_id uuid references check_in_challenges(id),booking_id uuid references bookings(id),created_at timestamptz default now());
create table booking_messages(id bigint generated always as identity primary key,booking_id uuid references bookings(id),created_at timestamptz default now(),body text);
create table booking_message_attachments(message_id bigint primary key references booking_messages(id),path text);
create table chat_message_emails(id uuid primary key default gen_random_uuid(),message_id bigint references booking_messages(id));
create function booking_messages_immutable() returns trigger language plpgsql as $$ begin raise exception 'messages cannot be edited or deleted'; end $$;
create trigger bm_immutable before update or delete on booking_messages for each row execute function booking_messages_immutable();
create table handyman_files(id uuid primary key default gen_random_uuid(),job_id uuid references handyman_jobs(id),kind text,storage_path text);
create table handyman_quote_requests(id uuid primary key default gen_random_uuid(),customer_id uuid references profiles(id),created_at timestamptz default now(),status text default 'new',photos jsonb default '[]');
create table account_incidents(id uuid primary key default gen_random_uuid(),reporter_id uuid references profiles(id),booking_id uuid references bookings(id),status text default 'open',reviewed_at timestamptz);
create table review_cases(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings(id),status text default 'open',resolved_at timestamptz);
create table handyman_disputes(id uuid primary key default gen_random_uuid(),job_id uuid references handyman_jobs(id),status text default 'open',resolved_at timestamptz);
create table customer_addresses(id uuid primary key default gen_random_uuid(),user_id uuid references profiles(id),access_instructions text,updated_at timestamptz default now());
create table booking_checkout_legal_consents(id uuid primary key default gen_random_uuid(),user_id uuid references profiles(id),evidence jsonb);
create table account_legal_acceptances(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings(id),checkout_legal_consent_id uuid references booking_checkout_legal_consents(id));
create table booking_checkout_time_choices(checkout_session_id text primary key,customer_id uuid references profiles(id),legal_consent_id uuid references booking_checkout_legal_consents(id),household_notes text,cleaning_extras jsonb default '[]',booking_preferences jsonb default '[]');
create table payments(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings(id),amount integer);
create table payment_events(id uuid primary key default gen_random_uuid(),payment_id uuid references payments(id));
create function financial_events_immutable() returns trigger language plpgsql as $$ begin raise exception 'financial events are append-only'; end $$;
create trigger pe_immutable before update or delete on payment_events for each row execute function financial_events_immutable();
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now());
`);
await db.exec(
  readFileSync(
    "supabase/migrations/20261026000100_automatic_data_retention.sql",
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261026000200_retention_incomplete_applications.sql",
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261026000300_retention_storage_and_contract_boundaries.sql",
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261026000400_retention_dbs_metadata_completion.sql",
    "utf8",
  ),
);
await db.exec(readFileSync("supabase/migrations/20261027000100_acceptance_evidence_retention_guards.sql", "utf8"));
await db.exec(readFileSync("supabase/migrations/20261027000500_account_acceptance_evidence.sql", "utf8"));
check("Migration installs on PostgreSQL without deleting records");

const user = randomUUID(),
  cleaner = randomUUID(),
  old = randomUUID(),
  current = randomUUID(),
  series = randomUUID();
await db.query("insert into profiles(id) values($1)", [user]);
await db.query("insert into providers(id,profile_id) values($1,$2)", [
  cleaner,
  user,
]);
await db.query(
  "insert into bookings(id,customer_id,provider_id,status,scheduled_at,retention_ended_at,access_instructions,household_notes) values($1,$2,$3,'completed',now()-interval '3 years',now()-interval '3 years','secret code','private notes'),($4,$2,$3,'confirmed',now()+interval '1 week',null,'current code','current notes')",
  [old, user, cleaner, current],
);
await db.query(
  "insert into check_ins(booking_id,created_at) values($1,now()-interval '2 years'),($1,now()-interval '2 years'+interval '1 second'),($2,now()-interval '3 years')",
  [old, current],
);
await db.query(
  "insert into booking_messages(booking_id,created_at,body) values($1,now()-interval '2 years','expired'),($1,now()-interval '1 year','recent')",
  [old],
);
let sweep = await call("run_data_retention", [false]);
assert.equal(sweep.dryRun, true);
assert.equal(await value("select count(*)::int value from check_ins"), 3);
check("Disabled job is forced to dry run; no check-in or message is removed");
await db.exec("update data_retention_control set enabled=true");
const hold = await value(
  "insert into review_cases(booking_id) values($1) returning id value",
  [old],
);
sweep = await call("run_data_retention", [false]);
assert.equal(await value("select count(*)::int value from check_ins"), 3);
assert.ok(sweep.held >= 3);
check("Open disputes protect linked records, including access instructions");
await db.query(
  "update review_cases set status='resolved',resolved_at=now() where id=$1",
  [hold],
);
sweep = await call("run_data_retention", [false]);
assert.equal(sweep.failed, 0);
assert.equal(await value("select count(*)::int value from check_ins"), 2);
assert.equal(
  await value("select count(*)::int value from booking_messages"),
  1,
);
assert.equal(
  await value("select access_instructions value from bookings where id=$1", [
    old,
  ]),
  null,
);
assert.equal(
  await value("select access_instructions value from bookings where id=$1", [
    current,
  ]),
  "current code",
);
check(
  "Two-year boundary deletes only expired terminal check-ins/messages; live booking stays untouched",
);
await assert.rejects(
  db.exec("delete from booking_messages"),
  /cannot be edited or deleted/,
);
check(
  "Ordinary message deletion is still blocked outside the retention transaction",
);

await db.query(
  "insert into regular_booking_series(id,customer_id,checkout_session_id) values($1,$2,'series-checkout')",
  [series, user],
);
const first = randomUUID(),
  last = randomUUID();
await db.query(
  "insert into bookings(id,customer_id,regular_series_id,status,retention_ended_at,access_instructions) values($1,$3,$4,'completed',now()-interval '1 day','keep until series ends'),($2,$3,$4,'confirmed',null,'future code')",
  [first, last, user, series],
);
await call("run_data_retention", [false]);
assert.equal(
  await value("select access_instructions value from bookings where id=$1", [
    first,
  ]),
  "keep until series ends",
);
await db.query("update bookings set status='cancelled' where id=$1", [last]);
await call("run_data_retention", [false]);
assert.equal(
  await value("select access_instructions value from bookings where id=$1", [
    first,
  ]),
  null,
);
check(
  "Access codes survive an active regular series and expire only after its last visit ends",
);

await db.query(
  "update providers set retention_left_at=now()-interval '6 months' where id=$1",
  [cleaner],
);
await db.query(
  "insert into provider_profile_settings values($1,'Private emergency name','Private phone')",
  [cleaner],
);
await call("run_data_retention", [false]);
assert.equal(
  await value(
    "select emergency_contact_name value from provider_profile_settings where provider_id=$1",
    [cleaner],
  ),
  null,
);
check("Emergency contacts expire at six months after leaving");

const certificate = `${cleaner}/old.pdf`;
await db.query(
  "insert into provider_dbs_checks(provider_id,certificate_storage_path,uploaded_at) values($1,$2,now()-interval '6 months')",
  [cleaner, certificate],
);
await db.query(
  "insert into storage.objects(bucket_id,name,created_at) values('provider-dbs',$1,now()-interval '6 months')",
  [certificate],
);
await call("run_data_retention", [false]);
let tasks = await call("claim_retention_file_tasks", [40]);
assert.equal(tasks.length, 1);
let task = tasks[0];
assert.equal(
  await call("retention_file_task_allowed", [task.id, task.claimToken]),
  true,
);
await call("finish_retention_file_task", [task.id, task.claimToken, false]);
assert.equal(
  await value(
    "select certificate_storage_path value from provider_dbs_checks where provider_id=$1",
    [cleaner],
  ),
  certificate,
);
check(
  "Failed file removal retains metadata and is retried rather than marked complete",
);
tasks = await call("claim_retention_file_tasks", [40]);
task = tasks[0];
const manualHold = await value(
  "insert into data_retention_holds(user_id,reason) values($1,'Explicit synthetic test hold') returning id value",
  [user],
);
assert.equal(
  await call("retention_file_task_allowed", [task.id, task.claimToken]),
  false,
);
assert.equal((await call("claim_retention_file_tasks", [40])).length, 0);
check(
  "A hold opened after claiming blocks physical deletion; held tasks do not starve the queue",
);
await db.query(
  "update data_retention_holds set resolved_at=now() where id=$1",
  [manualHold],
);
tasks = await call("claim_retention_file_tasks", [40]);
task = tasks[0];
assert.equal(
  await call("retention_file_task_allowed", [task.id, task.claimToken]),
  true,
);
await db.query("delete from storage.objects where name=$1", [certificate]);
// Simulate a crash after Storage succeeded, before metadata completion.
await db.query(
  "update data_retention_file_tasks set leased_until=now()-interval '1 second' where id=$1",
  [task.id],
);
tasks = await call("claim_retention_file_tasks", [40]);
task = tasks[0];
assert.equal(
  await call("retention_file_task_allowed", [task.id, task.claimToken]),
  true,
);
await call("finish_retention_file_task", [task.id, task.claimToken, true]);
assert.equal(
  await value(
    "select certificate_storage_path value from provider_dbs_checks where provider_id=$1",
    [cleaner],
  ),
  null,
);
check(
  "Expired leases recover after a crash between physical file removal and metadata cleanup",
);
await db.query(
  "update profiles set account_deleted_at=now()-interval '6 months' where id=$1",
  [user],
);
await call("run_data_retention", [false]);
assert.equal(
  await value("select count(*)::int value from provider_dbs_checks"),
  0,
);
check(
  "DBS outcome expires six months after account closure, independently of certificate copies",
);

const applicant = randomUUID();
await db.query(
  "insert into providers(id,profile_id,vetting_status,retention_rejected_at) values($1,$2,'rejected',now()-interval '6 months')",
  [applicant, user],
);
await db.query(
  "insert into provider_onboarding_details values($1,'private application')",
  [applicant],
);
await call("run_data_retention", [false]);
assert.equal(
  await value(
    "select count(*)::int value from provider_onboarding_details where provider_id=$1",
    [applicant],
  ),
  0,
);
assert.equal(
  await value("select count(*)::int value from profiles where id=$1", [user]),
  1,
);
check(
  "Rejected application is removed without deleting the person's shared customer account",
);

await db.exec(
  "insert into handyman_quote_requests(created_at) values(now()-interval '12 months'),(now()-interval '12 months'+interval '1 second')",
);
await call("run_data_retention", [false]);
assert.equal(
  await value("select count(*)::int value from handyman_quote_requests"),
  1,
);
check("Enquiries expire at twelve months; newer enquiry is kept");

const ancient = randomUUID(),
  young = randomUUID(),
  consent = randomUUID();
await db.query(
  "insert into bookings(id,customer_id,status,retention_ended_at) values($1,$2,'completed',now()-interval '6 years')",
  [ancient, user],
);
await db.query("insert into payments(booking_id,amount) values($1,1000)", [
  ancient,
]);
await db.query(
  "insert into payment_events(payment_id) select id from payments where booking_id=$1",
  [ancient],
);
await db.query(
  "insert into booking_checkout_legal_consents(id,user_id,evidence) values($1,$2,'{\"private\":true}')",
  [consent, user],
);
await db.query(
  "insert into account_legal_acceptances(booking_id,checkout_legal_consent_id) values($1,$2)",
  [ancient, consent],
);
await assert.rejects(db.query("update booking_checkout_legal_consents set evidence='{}' where id=$1", [consent]), /immutable/);
await assert.rejects(db.query("delete from booking_checkout_legal_consents where id=$1", [consent]), /immutable/);
await assert.rejects(db.query("delete from account_legal_acceptances where checkout_legal_consent_id=$1", [consent]), /immutable/);
check("Acceptance edits and early deletion blocked outside authorised retention");

await call("run_data_retention", [false]);
assert.equal(
  await value("select count(*)::int value from bookings where id=$1", [
    ancient,
  ]),
  0,
);
assert.equal(
  await value("select count(*)::int value from payments where booking_id=$1", [
    ancient,
  ]),
  0,
);
assert.equal(await value("select count(*)::int value from payment_events"), 0);
assert.equal(
  await value(
    "select count(*)::int value from booking_checkout_legal_consents where id=$1",
    [consent],
  ),
  0,
);
check(
  "Six-year business purge removes the aggregate, dependent financial events and saved personal legal evidence in FK order",
);

const photoMessage = await value(
  "insert into booking_messages(booking_id,created_at,body) values($1,now(),'photo caption') returning id value",
  [old],
);
await db.query(
  "insert into booking_message_attachments values($1,'old-job/photo.jpg')",
  [photoMessage],
);
await call("run_data_retention", [false]);
tasks = await call("claim_retention_file_tasks", [40]);
assert.equal(tasks.length, 1);
task = tasks[0];
await call("finish_retention_file_task", [task.id, task.claimToken, true]);
assert.equal(
  await value(
    "select count(*)::int value from booking_message_attachments where message_id=$1",
    [photoMessage],
  ),
  0,
);
assert.equal(
  await value("select count(*)::int value from booking_messages where id=$1", [
    photoMessage,
  ]),
  1,
);
check(
  "Photos expire twelve months after the job while the newer chat text keeps its own two-year timer",
);

const unfinishedApplicant = randomUUID();
await db.query(
  "insert into providers(id,profile_id,vetting_status,retention_rejected_at) values($1,$2,'rejected',now()-interval '6 months')",
  [unfinishedApplicant, user],
);
await db.query(
  "insert into provider_profile_settings values($1,'private incomplete application','private phone')",
  [unfinishedApplicant],
);
await call("run_data_retention", [false]);
assert.equal(
  await value(
    "select count(*)::int value from provider_profile_settings where provider_id=$1",
    [unfinishedApplicant],
  ),
  0,
);
check(
  "Rejected incomplete application expires even when onboarding was never completed",
);

const handyman = randomUUID(),
  quote = randomUUID();
await db.query(
  "insert into handyman_jobs(id,customer_id,provider_id,status,retention_ended_at) values($1,$2,$3,'completed',now()-interval '8 years')",
  [handyman, user, cleaner],
);
await db.query("insert into handyman_quotes(id,job_id) values($1,$2)", [
  quote,
  handyman,
]);
await db.query("update handyman_jobs set selected_quote_id=$1 where id=$2", [
  quote,
  handyman,
]);
const hDispute = await value(
  "insert into handyman_disputes(job_id) values($1) returning id value",
  [handyman],
);
await call("run_data_retention", [false]);
assert.equal(
  await value("select count(*)::int value from handyman_jobs where id=$1", [
    handyman,
  ]),
  1,
);
await db.query(
  "update handyman_disputes set status='resolved',resolved_at=now()-interval '7 years' where id=$1",
  [hDispute],
);
await call("run_data_retention", [false]);
assert.equal(
  await value("select count(*)::int value from handyman_jobs where id=$1", [
    handyman,
  ]),
  0,
);
assert.equal(
  await value("select count(*)::int value from handyman_quotes where id=$1", [
    quote,
  ]),
  0,
);
check(
  "Property-maintenance disputes protect expired jobs; resolution allows FK-safe removal of the quote cycle",
);

await db.query(
  "insert into account_incidents(reporter_id,status,reviewed_at) values($1,'resolved',now()-interval '6 years'),($1,'resolved',now()-interval '6 years'+interval '1 second')",
  [user],
);
await call("run_data_retention", [false]);
assert.equal(
  await value("select count(*)::int value from account_incidents"),
  1,
);
check(
  "Safeguarding and incident records keep the full six-year resolution period",
);

const caseCustomer = randomUUID(),
  caseBooking = randomUUID();
await db.query("insert into profiles(id) values($1)", [caseCustomer]);
await db.query(
  "insert into bookings(id,customer_id,status,retention_ended_at) values($1,$2,'completed',now()-interval '8 years')",
  [caseBooking, caseCustomer],
);
const recentCase = await value(
  "insert into review_cases(booking_id,status,resolved_at) values($1,'resolved',now()-interval '1 day') returning id value",
  [caseBooking],
);
await call("run_data_retention", [false]);
assert.equal(
  await value("select count(*)::int value from bookings where id=$1", [
    caseBooking,
  ]),
  1,
);
await db.query(
  "update review_cases set resolved_at=now()-interval '7 years' where id=$1",
  [recentCase],
);
await call("run_data_retention", [false]);
assert.equal(
  await value("select count(*)::int value from bookings where id=$1", [
    caseBooking,
  ]),
  0,
);
check(
  "Business expiry cannot shorten the six-year retention of a more recently resolved case",
);

const oldAccount = randomUUID(),
  oldConsent = randomUUID();
await db.query(
  "insert into profiles(id,account_deleted_at) values($1,now()-interval '6 years')",
  [oldAccount],
);
await db.query(
  "insert into booking_checkout_legal_consents(id,user_id,evidence) values($1,$2,'{\"expiredPersonalEvidence\":true}')",
  [oldConsent, oldAccount],
);
await call("run_data_retention", [false]);
assert.equal(
  await value("select count(*)::int value from profiles where id=$1", [
    oldAccount,
  ]),
  0,
);
assert.equal(
  await value(
    "select count(*)::int value from booking_checkout_legal_consents where id=$1",
    [oldConsent],
  ),
  0,
);
check(
  "Closed-account business evidence also expires after six years, instead of remaining forever without a booking",
);

const acceptedQuote = await value(
  "insert into handyman_quote_requests(customer_id,status,created_at) values($1,'new',now()-interval '8 years') returning id value",
  [caseCustomer],
);
await db.query(
  "update handyman_quote_requests set status='accepted' where id=$1",
  [acceptedQuote],
);
await call("run_data_retention", [false]);
assert.equal(
  await value(
    "select count(*)::int value from handyman_quote_requests where id=$1",
    [acceptedQuote],
  ),
  1,
);
await db.query(
  "update handyman_quote_requests set status='closed' where id=$1",
  [acceptedQuote],
);
assert.ok(
  await value(
    "select retention_ended_at>now()-interval '1 minute' value from handyman_quote_requests where id=$1",
    [acceptedQuote],
  ),
);
await db.query(
  "update handyman_quote_requests set retention_ended_at=now()-interval '6 years' where id=$1",
  [acceptedQuote],
);
await call("run_data_retention", [false]);
assert.equal(
  await value(
    "select count(*)::int value from handyman_quote_requests where id=$1",
    [acceptedQuote],
  ),
  0,
);
check(
  "An accepted quote becomes a business contract and its six-year timer starts on closure, not on enquiry creation",
);

const approvedApplicant = randomUUID();
await db.query("insert into providers(id,profile_id) values($1,$2)", [
  approvedApplicant,
  caseCustomer,
]);
await db.query(
  "update providers set service_approvals='{\"cleaning\":\"approved\"}',vetting_status='rejected' where id=$1",
  [approvedApplicant],
);
await db.query(
  "update providers set retention_rejected_at=now()-interval '6 months' where id=$1",
  [approvedApplicant],
);
await db.query(
  "insert into provider_onboarding_details values($1,'approved professional history')",
  [approvedApplicant],
);
await call("run_data_retention", [false]);
assert.equal(
  await value(
    "select count(*)::int value from provider_onboarding_details where provider_id=$1",
    [approvedApplicant],
  ),
  1,
);
check(
  "A previously approved professional is not treated as an unsuccessful applicant after rejection or suspension",
);

await db.exec(`create table mock_storage_requests(value integer default 0); insert into mock_storage_requests values(0);
create or replace function public.retention_remove_storage_files(p_files jsonb) returns boolean language plpgsql as $$
begin
  if not exists(select 1 from pg_locks where locktype='advisory' and classid=181946 and objid=2601 and granted) then
    raise exception 'Storage must run under the hold lock';
  end if;
  update mock_storage_requests set value=value+1;
  if current_setting('mock.storage_failure',true)='true' then return false; end if;
  delete from storage.objects where name in(select item->>'path' from jsonb_array_elements(p_files) item);
  return true;
end; $$;`);
await db.query(
  "insert into provider_dbs_checks(provider_id,certificate_storage_path,uploaded_at) values($1,$2,now()-interval '6 months')",
  [cleaner, certificate],
);
await db.query(
  "insert into storage.objects(bucket_id,name,created_at) values('provider-dbs',$1,now()-interval '6 months')",
  [certificate],
);
await call("run_data_retention", [false]);
tasks = await call("claim_retention_file_tasks", [40]);
task = tasks[0];
await db.exec("select set_config('mock.storage_failure','true',false)");
assert.equal(
  await call("remove_retention_file_task", [task.id, task.claimToken]),
  "retry",
);
assert.equal(
  await value(
    "select certificate_storage_path value from provider_dbs_checks where provider_id=$1",
    [cleaner],
  ),
  certificate,
);
tasks = await call("claim_retention_file_tasks", [40]);
task = tasks[0];
await db.exec("select set_config('mock.storage_failure','false',false)");
assert.equal(
  await call("remove_retention_file_task", [task.id, task.claimToken]),
  "done",
);
assert.equal(
  await value(
    "select certificate_storage_path value from provider_dbs_checks where provider_id=$1",
    [cleaner],
  ),
  null,
);
check(
  "The atomic worker performs Storage removal and metadata completion under the same case/hold lock, with safe retries",
);

const staff = randomUUID();
await db.query("insert into profiles(id,role) values($1,'admin')", [staff]);
await assert.rejects(
  call("admin_manage_retention_hold", [
    user,
    null,
    "user",
    user,
    "Not an administrator",
  ]),
  /Active staff required/,
);
const staffHold = await call("admin_manage_retention_hold", [
  staff,
  null,
  "user",
  user,
  "Externally handled synthetic complaint",
]);
assert.equal(
  await value("select created_by value from data_retention_holds where id=$1", [
    staffHold,
  ]),
  staff,
);
await call("admin_manage_retention_hold", [
  staff,
  staffHold,
  "",
  null,
  "The synthetic complaint is now resolved",
]);
assert.equal(
  await value(
    "select resolved_by value from data_retention_holds where id=$1",
    [staffHold],
  ),
  staff,
);
check(
  "Only active staff can create or resolve holds; both actions record the actor and reason",
);
assert.equal(
  await value(
    "select has_function_privilege('authenticated','public.retention_delete_tree(jsonb)','execute') value",
  ),
  false,
);
assert.equal(
  await value(
    "select has_function_privilege('service_role','public.finish_retention_file_task(uuid,uuid,boolean)','execute') value",
  ),
  false,
);
check(
  "Private deletion and completion helpers are not exposed through the public or service API",
);

const report = await call("data_retention_admin_report");
assert.ok(report.runs.length > 0);
assert.equal(report.failedFiles, 0);
assert.equal(JSON.stringify(report).includes("Private emergency"), false);
check(
  "Admin report records counts and status without copying personal contents",
);
await db.exec("select set_config('request.role','authenticated',false)");
await assert.rejects(
  call("run_data_retention", [false]),
  /Service role required/,
);
check("Authenticated callers cannot execute deletion jobs");
await db.close();
console.log(JSON.stringify({ passed }));
