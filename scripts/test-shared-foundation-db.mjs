// Disposable, offline PostgreSQL only. Every identity/document is fictional.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE)
  throw Error("Set the local PGLITE_MODULE; no network database is supported.");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = {
  onboard: id(1),
  second: id(2),
  manager: id(3),
  developer: id(4),
  applicant: id(5),
  cleaner: id(6),
  handyman: id(7),
  customer: id(8),
};
const provider = { applicant: id(15), cleaner: id(16), handyman: id(17) };
let checks = 0;
async function sql(query) {
  return db.exec(query);
}
async function scalar(query) {
  return Object.values((await db.query(query)).rows[0])[0];
}
async function eq(query, value, label) {
  assert.deepEqual(await scalar(query), value, label);
  checks++;
  console.log(`PASS ${label}`);
}
async function denied(query, pattern, label) {
  await assert.rejects(sql(query), pattern, label);
  checks++;
  console.log(`PASS ${label}`);
}
async function actor(person, aal = "aal2", role = "authenticated") {
  await sql(
    `reset role; select set_config('request.jwt.claims','${JSON.stringify({ sub: person, role, aal, amr: [{ method: aal === "aal2" ? "totp" : "password" }] })}',false); set role ${role};`,
  );
}
async function owner() {
  await sql("reset role; select set_config('request.jwt.claims','{}',false)");
}
const migration = (name) =>
  readFileSync(
    `supabase/migrations/${readdirSync("supabase/migrations").find((file) => file.endsWith(name + ".sql"))}`,
    "utf8",
  );
const content =
  "<p>TEST ONLY fictional approved document. No real terms are changed. This is an offline disposable fixture for role and notice tests.</p>";
const sha = "a".repeat(64);
try {
  await sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; grant usage on schema auth,storage,public to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    create table auth.users(id uuid primary key,email text);
    create table auth.mfa_factors(user_id uuid,factor_type text,status text);
    create table profiles(id uuid primary key,role text,full_name text,address text,phone text,account_deleted_at timestamptz);
    create function is_admin() returns boolean language sql stable security definer set search_path=public as $$
      select coalesce(auth.jwt()->>'aal'='aal2',false)
        and exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) entry where entry->>'method'='totp')
        and exists(select 1 from profiles where id=auth.uid() and role='admin' and account_deleted_at is null)
        and exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified' and factor_type='totp')$$;
    create function booking_events_immutable() returns trigger language plpgsql as $$begin raise exception 'Immutable audit record'; end$$;
    create function guard_acceptance_evidence_mutation() returns trigger language plpgsql as $$begin raise exception 'Immutable acceptance evidence'; end$$;
    create table providers(id uuid primary key,profile_id uuid,services text[],service_approvals jsonb,vetting_status text default 'pending',is_suspended boolean default false,created_at timestamptz default now(),display_name text);
    create function current_provider_id() returns uuid language sql stable security definer as $$select id from providers where profile_id=auth.uid()$$;
    create table provider_dbs_checks(provider_id uuid primary key,status text,reviewed_by uuid,issue_date date);
    create table professional_setup_invitations(provider_id uuid primary key,created_by uuid);
    create table provider_onboarding_details(provider_id uuid primary key,date_of_birth date);
    create table provider_verification_items(provider_id uuid,document_type text,status text,reviewed_by uuid,uploaded_at timestamptz,expires_at date,document_storage_path text);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,updated_at timestamptz default now());
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
    create function professional_verification_block(uuid) returns text language sql as $$select case when not exists(select 1 from provider_dbs_checks where provider_id=$1 and status='verified') then 'DBS needs verification' end$$;
    create function review_professional_service_before_client_documents(p_provider uuid,p_service text,p_status text,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$begin
      if not public.is_admin() then raise exception 'Admins only'; end if;
      update providers set vetting_status=case when p_status='approved' then 'approved' else vetting_status end where id=p_provider;
      update providers set service_approvals=service_approvals||jsonb_build_object(p_service,p_status) where id=p_provider;
    end$$;
    create function review_professional_service(p_provider uuid,p_service text,p_status text,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$begin
      if not public.is_admin() then raise exception 'Admins only'; end if;
      perform review_professional_service_before_client_documents(p_provider,p_service,p_status,p_reason);
    end$$;
    create function guard_professional_service_approvals() returns trigger language plpgsql security definer as $$begin
      if new.service_approvals is distinct from old.service_approvals and not public.is_admin() then raise exception 'Review team required'; end if;
      return new;
    end$$;
    create trigger service_approval_guard before update on providers for each row execute function guard_professional_service_approvals();
    create function provider_service_approved(p_provider uuid,p_service text) returns boolean language sql stable security definer as $$select exists(select 1 from providers where id=p_provider and vetting_status='approved' and not is_suspended and service_approvals->>p_service='approved')$$;
    create table dbs_onboarding_staff(profile_id uuid primary key,granted_by uuid,granted_at timestamptz default now());
    create table dbs_access_events(id bigint generated always as identity primary key,actor_id uuid,provider_id uuid,action text,details jsonb,created_at timestamptz default now());
    create function can_view_dbs() returns boolean language sql stable security definer as $$select public.is_admin() and exists(select 1 from dbs_onboarding_staff where profile_id=auth.uid())$$;
    create function staff_view_dbs_record(p_provider uuid,p_action text default 'record_view') returns setof provider_dbs_checks language sql security definer as $$select * from provider_dbs_checks where provider_id=p_provider and can_view_dbs()$$;
    create table legal_documents(slug text primary key,title text,version text,content_html text,published boolean default true,pdf_path text,pdf_sha256 text,audience text default 'professionals',effective_date date,updated_at timestamptz default now());
    create table site_social_links(platform text primary key,url text,updated_at timestamptz default now());
    create table account_legal_acceptances(id bigint generated always as identity primary key,user_id uuid,document_slug text,version text,document_title text,content_hash text,accepted_at timestamptz default now(),acceptance_evidence jsonb,booking_id uuid,unique nulls not distinct(user_id,document_slug,version,booking_id));
    create table bookings(id uuid primary key default gen_random_uuid(),provider_id uuid,status text default 'offered',customer_id uuid);
    create table notifications(user_id uuid,title text,body text,href text);
    create function my_previous_cleaners() returns table(provider_id uuid,display_name text)
      language sql stable security definer as $$select p.id,p.display_name from providers p$$;
    create function homepage_review_highlights_feed() returns text
      language sql stable security definer as $$select p.display_name from providers p limit 1$$;
    create function public_reviews_feed(p_limit integer) returns text
      language sql stable security definer as $$select p.display_name from providers p limit 1$$;
    create function report_provider_delay(p_booking_id uuid,p_delay_minutes integer) returns text
      language sql security definer as $$select p.display_name from providers p limit 1$$;
    create function send_booking_message_before_contact_decisions(p_booking_id uuid,p_body text)
      returns text language sql security definer as $$select pr.display_name from providers pr limit 1$$;
    create table booking_offer_queue(booking_id uuid,provider_id uuid);
    create table booking_offers(booking_id uuid,provider_id uuid);
    alter table profiles enable row level security; create policy profiles_self on profiles for select to authenticated using(id=auth.uid() or public.is_admin());
    alter table providers enable row level security; create policy providers_own on providers for select to authenticated using(profile_id=auth.uid() or public.is_admin());
    create policy providers_admin on providers for update to authenticated using(public.is_admin()) with check(public.is_admin());
    alter table provider_verification_items enable row level security; create policy verification_base on provider_verification_items for select to authenticated using(provider_id=current_provider_id() or public.is_admin());
    alter table storage.objects enable row level security; create policy storage_base on storage.objects for select to authenticated using(public.is_admin());
    grant select on profiles,providers,provider_verification_items,storage.objects to authenticated;
    grant update on providers to authenticated;
    grant select on account_legal_acceptances,legal_documents to authenticated;
    grant insert on bookings,booking_offer_queue,booking_offers to authenticated;
    insert into profiles(id,role,full_name) values ${Object.entries(user)
      .map(
        ([name, key]) =>
          `('${key}','${["onboard", "second", "manager", "developer"].includes(name) ? "admin" : "customer"}','TEST ONLY ${name}')`,
      )
      .join(",")};
    insert into auth.users select id,lower(replace(full_name,' ','-'))||'@example.invalid' from profiles;
    insert into auth.mfa_factors select id,'totp','verified' from profiles where role='admin';
    insert into providers(id,profile_id,services,service_approvals,vetting_status) values
      ('${provider.applicant}','${user.applicant}',array['cleaning'],'{"cleaning":"pending"}','pending'),
      ('${provider.cleaner}','${user.cleaner}',array['cleaning'],'{"cleaning":"approved"}','approved'),
      ('${provider.handyman}','${user.handyman}',array['handyman'],'{"handyman":"approved"}','approved');
    insert into provider_dbs_checks values('${provider.applicant}','verified','${user.onboard}',current_date);
    insert into provider_verification_items values('${provider.applicant}','photo_id','verified','${user.onboard}',now(),null,'${provider.applicant}/photo_id/fictional.pdf');
    insert into storage.objects(bucket_id,name) values('provider-verification','${provider.applicant}/photo_id/fictional.pdf');
    insert into dbs_onboarding_staff(profile_id) values('${user.onboard}'),('${user.manager}'),('${user.developer}');
    insert into legal_documents(slug,title,version,content_html,published,pdf_path,pdf_sha256) values('terms','TEST ONLY Customer Terms','1.0','${content}',true,'2026-10-01/terms.pdf','${sha}'),
      ('professional-partner-agreement','TEST ONLY Cleaner Agreement','1.0','${content}',true,'2026-10-01/agreement.pdf','${sha}');
  `);
  await sql(migration("professional_second_signoff"));
  await sql(migration("independent_onboarding_identity_guard"));
  const adminOid = await scalar(
    "select 'public.is_admin()'::regprocedure::oid::text",
  );
  const serviceOid = await scalar(
    "select 'public.provider_service_approved(uuid,text)'::regprocedure::oid::text",
  );
  const reviewOid = await scalar(
    "select 'public.review_professional_service(uuid,text,text,text)'::regprocedure::oid::text",
  );
  await sql(migration("shared_account_role_foundation"));
  await sql(migration("scoped_staff_roles"));
  await sql(migration("document_change_acceptance_workflow"));
  await eq(
    "select 'public.is_admin()'::regprocedure::oid::text",
    adminOid,
    "Existing RLS keeps the original is_admin function identity",
  );
  await eq(
    "select 'public.provider_service_approved(uuid,text)'::regprocedure::oid::text",
    serviceOid,
    "Existing matching dependencies enter the new document gate",
  );
  await eq(
    "select 'public.review_professional_service(uuid,text,text,text)'::regprocedure::oid::text",
    reviewOid,
    "Existing review dependencies keep the scoped action function identity",
  );
  await sql(
    `update staff_role_memberships set staff_role=case profile_id when '${user.onboard}' then 'onboarding' when '${user.second}' then 'second_signoff' when '${user.developer}' then 'developer' else 'manager' end`,
  );

  await actor(user.manager, "aal1");
  await eq(
    "select public.staff_has_permission('manage')",
    false,
    "C36: password-only Manager has no staff permissions",
  );
  await actor(user.onboard, "aal1");
  await eq(
    "select public.staff_has_permission('onboarding')",
    false,
    "C36: password-only onboarding denied",
  );
  await actor(user.second, "aal1");
  await eq(
    "select public.staff_has_permission('second_signoff')",
    false,
    "C36: password-only second sign-off denied",
  );
  await actor(user.onboard);
  await eq(
    "select public.is_admin()",
    false,
    "Onboarding is not a full administrator",
  );
  await eq(
    "select public.staff_has_permission('first_review')",
    true,
    "Onboarding can record first review",
  );
  await denied(
    `select review_professional_service('${provider.applicant}','cleaning','rejected','TEST ONLY unauthorized rejection')`,
    /Manager must decide/i,
    "Onboarding cannot make the Manager's application decision",
  );
  await denied(
    `select review_professional_service('${provider.applicant}','cleaning','pending','TEST ONLY unauthorized appeal')`,
    /Manager must decide/i,
    "Only a Manager can reopen an application or appeal",
  );
  await eq(
    "select public.staff_has_permission('second_signoff')",
    false,
    "Onboarding cannot provide final sign-off",
  );
  const approve = `select review_professional_service('${provider.applicant}','cleaning','approved','TEST ONLY independently checked fictional evidence')`;
  await sql(approve);
  await eq(
    `select service_approvals->>'cleaning' from providers where id='${provider.applicant}'`,
    "pending",
    "C7: first review leaves professional pending",
  );
  await denied(
    approve,
    /staff role|different staff|second sign/i,
    "C7: first reviewer cannot activate",
  );
  await eq(
    `select professional_approval_review_state('${provider.applicant}','cleaning')->>'canReview'`,
    "false",
    "Onboarding screen disables the second sign-off action",
  );
  await actor(user.second);
  await sql(approve);
  await eq(
    `select service_approvals->>'cleaning' from providers where id='${provider.applicant}'`,
    "approved",
    "Independent second reviewer reuses PR59 activation",
  );
  await eq(
    "select public.staff_has_permission('first_review')",
    false,
    "Second sign-off cannot onboard",
  );
  await eq(
    "select public.staff_has_permission('manage')",
    false,
    "Second sign-off cannot use Manager tools",
  );
  await denied(
    `select assign_staff_role('${user.developer}','manager',true,'TEST ONLY unsafe escalation')`,
    /Manager authenticator/i,
    "Second sign-off cannot grant permissions",
  );
  await actor(user.manager);
  await denied(
    `select assign_staff_role('${user.manager}','developer',true,'TEST ONLY self permission change')`,
    /own staff access/i,
    "Manager cannot change their own role",
  );
  await actor(user.developer);
  await eq(
    "select public.staff_has_permission('private_evidence')",
    false,
    "Developer never gains private evidence access even when named",
  );
  await eq(
    `select staff_open_dbs_record('${provider.applicant}')->>'allowed'`,
    "false",
    "C30: Developer DBS access refused",
  );
  await eq(
    `select staff_open_verification_record('${provider.applicant}','photo_id')->>'allowed'`,
    "false",
    "Developer ID access refused",
  );
  await eq(
    "select count(*)::int from provider_verification_items",
    0,
    "Developer direct private table reads return no evidence",
  );
  await owner();
  await sql(
    `insert into bookings(id,provider_id,status) values('${id(89)}','${provider.cleaner}','scheduled')`,
  );
  await eq(
    `select count(*)::int from dbs_access_events where actor_id='${user.developer}' and details->>'allowed'='false'`,
    1,
    "C30: refused DBS attempt remains logged",
  );
  await eq(
    `select count(*)::int from private_evidence_access_events where actor_id='${user.developer}' and not allowed`,
    1,
    "Refused identity attempt remains logged",
  );
  await actor(user.onboard);
  await eq(
    `select staff_open_dbs_record('${provider.applicant}')->>'allowed'`,
    "true",
    "C31: named MFA onboarding can open DBS",
  );
  await eq(
    `select staff_open_verification_record('${provider.applicant}','photo_id')->>'allowed'`,
    "true",
    "Named MFA onboarding can open ID through audited RPC",
  );
  await eq(
    "select count(*)::int from provider_verification_items",
    0,
    "Named staff cannot bypass deliberate audited opening",
  );
  await owner();
  await eq(
    `select count(*)::int from dbs_access_events where actor_id='${user.onboard}' and details->>'allowed'='true'`,
    1,
    "C31: allowed DBS view logged",
  );

  await actor(user.cleaner);
  await eq(
    "select array_agg(role order by role)::text from my_account_roles()",
    "{cleaner,customer}",
    "Existing approved cleaner keeps customer and cleaner roles",
  );
  await eq(
    `select provider_service_approved('${provider.cleaner}','cleaning')`,
    true,
    "Existing cleaner continues receiving work before any document change",
  );
  await denied(
    `select my_role_document_updates('handyman')`,
    /Role not found/i,
    "Role-scoped document API rejects an unowned role",
  );
  await owner();
  await sql(
    `insert into partner_role_memberships(user_id,status) values('${user.cleaner}','approved')`,
  );
  await actor(user.cleaner);
  await eq(
    "select count(*)::int from my_account_roles()",
    3,
    "P10 role coverage: cleaner retains customer plus Partner membership",
  );
  await eq(
    "select reward_route from my_account_roles() where role='partner'",
    "cleaner_payout",
    "P10 combined roles use the normal cleaner payout by default",
  );
  await owner();
  await eq(
    `select reward_route from partner_role_memberships where user_id='${user.cleaner}'`,
    "cleaner_payout",
    "P10 stores the default on the Partner membership",
  );
  await sql(
    `update partner_role_memberships set reward_route='gift_card' where user_id='${user.cleaner}'`,
  );
  await actor(user.cleaner);
  await eq(
    "select reward_route from my_account_roles() where role='partner'",
    "gift_card",
    "P10 preserves a later Partner route override",
  );
  await eq(
    "select reward_route from my_account_roles() where role='cleaner'",
    "cleaner_payout",
    "P10 changing the Partner route leaves the cleaner route alone",
  );
  await owner();
  await denied(
    `insert into partner_role_memberships(user_id) values('${user.handyman}')`,
    /cannot hold the Partner/i,
    "P9: handyman cannot gain Partner role",
  );
  await denied(
    `update providers set services=array['cleaning','handyman'] where id='${provider.cleaner}'`,
    /cannot be combined/i,
    "P9: adding handyman to existing Partner is blocked too",
  );
  await sql(
    `delete from partner_role_memberships where user_id='${user.cleaner}'`,
  );
  await actor(user.manager);
  await sql(
    `update providers set services=array['cleaning','handyman'],service_approvals='{"cleaning":"approved","handyman":"pending"}' where id='${provider.cleaner}'`,
  );
  await actor(user.cleaner);
  await eq(
    "select status from my_account_roles() where role='cleaner'",
    "active",
    "H34: adding pending handyman leaves cleaning Active",
  );
  await eq(
    "select status from my_account_roles() where role='handyman'",
    "applied",
    "H34: per-role application statuses stay independent",
  );
  await eq(
    "select pay_source from my_account_roles() where role='cleaner'",
    "existing_cleaning_booking_pay_snapshot",
    "H34: cleaner pay points to existing cleaning snapshots",
  );
  await eq(
    "select pay_source from my_account_roles() where role='handyman'",
    "existing_accepted_quote_pay_snapshot",
    "H34: handyman pay has a separate quote source",
  );
  await eq(
    "select count(*)::int from account_role_document_bindings where role='partner'",
    0,
    "Unowned Partner document bindings are invisible",
  );

  await actor(user.manager);
  const document = {
    slug: "terms",
    title: "TEST ONLY Customer Terms",
    version: "1.1",
    sourceContentHtml: content,
    pdfPath: "2026-11-01/terms.pdf",
    pdfSha256: sha,
  };
  const quoted = (value) =>
    "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  await denied(
    `select announce_document_change(${quoted(document)},'TEST ONLY clearer notice',now()+interval '29 days')`,
    /30 days/i,
    "Customer notice cannot be shorter than 30 days",
  );
  const customerPlan = await scalar(
    `select announce_document_change(${quoted(document)},'TEST ONLY clearer notice',now()+interval '31 days')`,
  );
  await eq(
    `select count(*)::int from document_change_recipients where plan_id='${customerPlan}'`,
    4,
    "Customer notice targets all existing non-staff accounts once",
  );
  await actor(user.manager, "aal1", "service_role");
  const lease = (
    await db.query("select * from claim_document_change_emails(2)")
  ).rows;
  assert.equal(lease.length, 2);
  checks++;
  console.log("PASS Normal scheduler claims a bounded notice batch");
  await eq(
    "select count(*)::int from claim_document_change_emails(10)",
    2,
    "A second scheduler cannot claim already leased notices",
  );
  await eq(
    `select finish_document_change_email('${lease[0].plan_id}','${lease[0].user_id}','${id(123)}',true)`,
    false,
    "Stale or forged delivery token cannot mark a notice sent",
  );
  await eq(
    `select finish_document_change_email('${lease[0].plan_id}','${lease[0].user_id}','${lease[0].claim_token}',true)`,
    true,
    "Matching delivery token records confirmed sending",
  );
  await eq(
    `select finish_document_change_email('${lease[0].plan_id}','${lease[0].user_id}','${lease[0].claim_token}',true)`,
    false,
    "A completed delivery cannot be processed twice",
  );
  await eq(
    `select finish_document_change_email('${lease[1].plan_id}','${lease[1].user_id}','${lease[1].claim_token}',false,'TEST ONLY temporary delivery error')`,
    true,
    "Failed email schedules a retry instead of recording delivery",
  );
  await eq(
    "select count(*)::int from claim_document_change_emails(10)",
    0,
    "Retries respect their backoff and active leases",
  );
  await owner();
  await sql(
    "update document_change_recipients set leased_until=now()-interval '1 minute' where status='processing'",
  );
  await actor(user.manager, "aal1", "service_role");
  await eq(
    "select count(*)::int from claim_document_change_emails(10)",
    2,
    "An expired scheduler lease is recoverable",
  );
  await owner();
  await eq(
    "select version from legal_documents where slug='terms'",
    "1.0",
    "Preparing a notice does not publish legal text",
  );
  await denied(
    `update legal_documents set version='1.1',pdf_path='2026-11-01/terms.pdf' where slug='terms'`,
    /effective date/i,
    "No early publication",
  );
  // Simulate elapsed time only in this disposable database, never remotely.
  await sql(
    "alter table document_change_plans disable trigger document_plan_immutable",
  );
  await sql(
    `update document_change_plans set effective_at=now()-interval '1 minute' where id='${customerPlan}'`,
  );
  await sql(
    "alter table document_change_plans enable trigger document_plan_immutable",
  );
  await denied(
    `update legal_documents set version='1.1',pdf_path='2026-11-01/terms.pdf' where slug='terms'`,
    /30-day period/i,
    "Unsent customer emails block publication",
  );
  await sql(
    `update document_change_recipients set status='sent',sent_at=now()-interval '29 days' where plan_id='${customerPlan}'`,
  );
  await denied(
    `update legal_documents set version='1.1',pdf_path='2026-11-01/terms.pdf' where slug='terms'`,
    /30-day period/i,
    "30 days counts from the actual email send",
  );
  await sql(
    `update document_change_recipients set sent_at=now()-interval '31 days' where plan_id='${customerPlan}'; update legal_documents set version='1.1',pdf_path='2026-11-01/terms.pdf' where slug='terms'`,
  );
  await actor(user.customer);
  await eq(
    "select count(*)::int from my_role_document_updates('customer')",
    1,
    "Customer is prompted at next booking, not signed out",
  );
  await owner();
  await sql(
    `insert into account_legal_acceptances(user_id,document_slug,version,booking_id) values('${user.customer}','terms','1.1','${id(99)}')`,
  );
  await actor(user.customer);
  await eq(
    "select count(*)::int from my_role_document_updates('customer')",
    0,
    "Existing booking acceptance satisfies customer document update without checkout changes",
  );
  await actor(user.manager);
  const professional = {
    ...document,
    slug: "professional-partner-agreement",
    title: "TEST ONLY Cleaner Agreement",
    pdfPath: "2026-11-01/agreement.pdf",
  };
  const proPlan = await scalar(
    `select announce_document_change(${quoted(professional)},'TEST ONLY updated professional wording',now()+interval '1 hour')`,
  );
  await owner();
  await sql(
    `alter table document_change_plans disable trigger document_plan_immutable; update document_change_plans set effective_at=now()-interval '1 minute' where id='${proPlan}'; alter table document_change_plans enable trigger document_plan_immutable; update legal_documents set version='1.1',pdf_path='2026-11-01/agreement.pdf' where slug='professional-partner-agreement'`,
  );
  await actor(user.cleaner);
  await eq(
    "select count(*)::int from my_role_document_updates('cleaner')",
    1,
    "C29: professional gets the version and summary at next sign-in",
  );
  await eq(
    `select provider_service_approved('${provider.cleaner}','cleaning')`,
    false,
    "C29: new offers blocked until updated document accepted",
  );
  await eq(
    "select count(*)::int from my_role_document_updates('handyman')",
    0,
    "H34: cleaner-specific documents do not block handyman role",
  );
  await denied(
    `insert into booking_offer_queue values('${id(90)}','${provider.cleaner}')`,
    /Accept updated professional/i,
    "C29: direct queue insertion cannot bypass new acceptance",
  );
  await denied(
    `insert into bookings(provider_id,status) values('${provider.cleaner}','scheduled')`,
    /Accept updated professional/i,
    "C29: direct assignment cannot bypass new acceptance",
  );
  await owner();
  await sql(`update bookings set status='in_progress' where id='${id(89)}'`);
  await eq(
    `select status from bookings where id='${id(89)}'`,
    "in_progress",
    "Already accepted cleaning work remains usable during a document update",
  );
  await sql(`insert into account_legal_acceptances(user_id,document_slug,version,accepted_at,acceptance_evidence)
    values('${user.applicant}','professional-partner-agreement','1.1',clock_timestamp(),jsonb_build_object('document',jsonb_build_object('contentHash',md5('${content}'))))`);
  await actor(user.applicant);
  await eq(
    "select count(*)::int from my_role_document_updates('cleaner')",
    0,
    "A new applicant who already accepted this exact version is not prompted again",
  );
  await actor(user.cleaner, "aal1", "service_role");
  const accept = `select accept_role_document_update('${user.cleaner}','cleaner','${proPlan}',true,'192.0.2.10','TEST ONLY fictional browser')`;
  await denied(
    accept.replace(",true,", ",false,"),
    /tick their acceptance/i,
    "C9: unchecked update cannot save consent",
  );
  await sql(accept);
  await sql(accept);
  await owner();
  await eq(
    `select count(*)::int from role_document_change_acceptances where user_id='${user.cleaner}'`,
    1,
    "C9: retries save one role acceptance",
  );
  await eq(
    `select evidence->'request'->>'ip' from role_document_change_acceptances where user_id='${user.cleaner}'`,
    "192.0.2.10",
    "C9: observed IP retained in immutable evidence",
  );
  await eq(
    `select content_hash=acceptance_evidence->'document'->>'contentHash' and document_title='TEST ONLY Cleaner Agreement' from account_legal_acceptances where user_id='${user.cleaner}' and version='1.1'`,
    true,
    "C9: existing acceptance exports retain the exact document title and fingerprint",
  );
  await eq(
    `select evidence->'checkboxes'->0->>'text' from role_document_change_acceptances where user_id='${user.cleaner}'`,
    "I have read and accept TEST ONLY Cleaner Agreement (Version 1.1).",
    "C9: exact displayed tick-box wording saved",
  );
  await eq(
    `select evidence->>'acceptedAt'=to_jsonb(accepted_at)#>>'{}' from role_document_change_acceptances where user_id='${user.cleaner}'`,
    true,
    "C9: stored acceptance and evidence use the same timestamp",
  );
  await denied(
    "update role_document_change_acceptances set evidence='{}'",
    /Immutable acceptance/i,
    "C9: acceptance evidence cannot be edited",
  );
  await actor(user.cleaner);
  await eq(
    `select provider_service_approved('${provider.cleaner}','cleaning')`,
    true,
    "C29: accepting restores new cleaning work eligibility",
  );
  await eq(
    "select count(*)::int from my_role_document_updates('cleaner')",
    0,
    "C29: accepted update no longer prompts",
  );
  await eq(
    "select count(*)::int from my_role_document_versions('cleaner')",
    1,
    "C10: accepted current versions keep their approved document link",
  );
  await eq(
    `select count(*)::int from document_change_for_me('${proPlan}')`,
    1,
    "C10: professionals can read the approved snapshot after acceptance",
  );
  await owner();
  await eq(
    "select count(*)::int from legal_documents where version='1.1'",
    2,
    "Only disposable fictional documents used for version tests",
  );
  await sql(migration("publish_cleaner_terms_and_social_links"));
  const cleanerTerms = JSON.parse(
    readFileSync("lib/finalLegalPack.json", "utf8"),
  )["cleaner-terms"];
  await eq(
    "select content_html from legal_documents where slug='cleaner-terms' and published",
    cleanerTerms.contentHtml,
    "Cleaner Terms publication uses the exact bundled wording",
  );
  await eq(
    "select pdf_sha256 from document_change_plans where document_slug='cleaner-terms'",
    cleanerTerms.pdfSha256,
    "Cleaner Terms plan uses the original PDF fingerprint",
  );
  await eq(
    "select published from legal_documents where slug='professional-partner-agreement'",
    false,
    "Cleaner Terms retire the previous agreement",
  );
  const cleanerTermsPlan = await scalar(
    "select id from document_change_plans where document_slug='cleaner-terms'",
  );
  await actor(user.cleaner);
  await eq(
    "select document_slug from my_role_document_updates('cleaner')",
    "cleaner-terms",
    "Existing cleaners are prompted for the new terms",
  );
  await eq(
    `select provider_service_approved('${provider.cleaner}','cleaning')`,
    false,
    "Pending Cleaner Terms block new cleaning work",
  );
  await eq(
    `select pdf_sha256 from document_change_for_me('${cleanerTermsPlan}')`,
    cleanerTerms.pdfSha256,
    "Eligible cleaner can load the protected versioned PDF metadata",
  );
  await actor(user.customer);
  await eq(
    `select count(*)::int from document_change_for_me('${cleanerTermsPlan}')`,
    0,
    "Customer-only account cannot load the protected Cleaner Terms snapshot",
  );
  await actor(user.cleaner, "aal1", "service_role");
  await sql(
    `select accept_role_document_update('${user.cleaner}','cleaner','${cleanerTermsPlan}',true,'192.0.2.10','TEST ONLY fictional browser')`,
  );
  await actor(user.cleaner);
  await eq(
    `select provider_service_approved('${provider.cleaner}','cleaning')`,
    true,
    "Accepting the Cleaner Terms restores eligibility",
  );
  await owner();
  await sql(`
    update providers set display_name = '  Dr. Anne-Marie Example' where id = '${provider.cleaner}';
    insert into bookings(id,provider_id,status,customer_id)
    values ('${id(201)}','${provider.cleaner}','scheduled','${user.customer}');
    insert into notifications values
      ('${user.customer}','Anne-Marie Formername is running late','System delay notice','/account/visit/${id(201)}'),
      ('${user.customer}','Message from Dr. Anne-Marie Example','User message','/account/visit/${id(201)}'),
      ('${user.customer}','Message from Opulence Bliss','Staff message','/account/visit/${id(201)}');
  `);
  await sql(migration("customer_cleaner_first_names"));
  await eq(
    `select customer_first_name from providers where id='${provider.cleaner}'`,
    "Anne-Marie",
    "Customer name strips titles and surnames while keeping hyphenated names",
  );
  await eq(
    `select display_name from providers where id='${provider.cleaner}'`,
    "  Dr. Anne-Marie Example",
    "Original staff and worker name is preserved",
  );
  await eq(
    `select display_name from my_previous_cleaners() where provider_id='${provider.cleaner}'`,
    "Anne-Marie",
    "Previous-cleaner RPC returns the first name",
  );
  await eq(
    "select string_agg(title, ' | ' order by title) from notifications",
    "Anne-Marie is running late | Message from Anne-Marie | Message from Opulence Bliss",
    "Historical customer notification titles are projected without altering staff messages",
  );
  await eq(
    "select body from notifications where title='Message from Anne-Marie'",
    "User message",
    "Customer message body stays intact",
  );
  console.log(
    `PASS ${checks} isolated shared-foundation database checks; no external database or payment API used.`,
  );
} catch (failure) {
  console.error(failure.message);
  if (failure.where) console.error(failure.where);
  if (failure.query) console.error(failure.query.slice(0, 1200));
  if (failure.actual !== undefined)
    console.error({ actual: failure.actual, expected: failure.expected });
  process.exitCode = 1;
} finally {
  await db.close();
}
