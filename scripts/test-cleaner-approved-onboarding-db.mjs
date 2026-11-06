import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE)
  throw Error("Local PGLITE_MODULE required; no remote database accepted.");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
const catalog = JSON.parse(
  readFileSync("content/cleaner-onboarding-drafts.json", "utf8"),
);
const staff = "00000000-0000-4000-8000-000000000001";
let count = 0,
  application;
async function actor(
  role = "authenticated",
  scope = "manager",
  aal = "aal2",
  named = true,
  sub = staff,
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub, scope, aal, named }),
  ]);
  await db.exec(`set role ${role}`);
}
async function value(sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
async function check(label, work) {
  await work();
  count++;
  console.log(`PASS ${label}`);
}
async function denied(label, work) {
  await check(label, () => assert.rejects(work));
}
async function record(action, stage, details = {}) {
  return value("select staff_record_cleaner_application($1,$2,$3,$4,$5)", [
    application,
    action,
    stage,
    details,
    "TEST fictional evidence note",
  ]);
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema auth,public to anon,authenticated,service_role;
    create table auth.users(id uuid primary key);create table providers(id uuid primary key,created_at timestamptz not null default clock_timestamp());
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    create function staff_has_permission(text) returns boolean language sql stable as $$
      select coalesce(current_setting('request.jwt.claims',true)::jsonb->>'aal'='aal2' and
        case current_setting('request.jwt.claims',true)::jsonb->>'scope'
          when 'manager' then true when 'onboarding' then $1 in('onboarding','first_review','private_evidence')
          when 'second_signoff' then $1 in('onboarding','second_signoff') else false end,false)$$;
    create function can_review_professional() returns boolean language sql stable as $$select public.staff_has_permission('onboarding')$$;
    create function can_view_dbs() returns boolean language sql stable as $$select coalesce(current_setting('request.jwt.claims',true)::jsonb->>'named'='true',false) and public.staff_has_permission('private_evidence')$$;`);
  for (const file of [
    "20261105020000_cleaner_application_records.sql",
    "20261105021000_private_cleaner_assessment.sql",
    "20261105022000_cleaner_application_intake_retention.sql",
    "20261105102000_cleaner_onboarding_workflow.sql",
    "20261105104243_cleaner_assessment_decision_mail.sql",
    "20261105134126_cleaner_onboarding_approved_workflow.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await actor("anon");
  await denied("anonymous callers cannot approve wording", () =>
    value("select install_cleaner_onboarding_wording($1)", [catalog]),
  );
  await actor("service_role");
  await check(
    "exact approved catalog installs once and is immutable",
    async () => {
      await value("select install_cleaner_onboarding_wording($1)", [catalog]);
      await value("select install_cleaner_onboarding_wording($1)", [catalog]);
      await assert.rejects(() =>
        value("select install_cleaner_onboarding_wording($1)", [
          { ...catalog, title: "changed" },
        ]),
      );
    },
  );
  const details = {
    fullName: "TEST Fictional Cleaner",
    email: "test-cleaner@example.invalid",
    phone: "+442079460002",
    postcode: "SW1A1AA",
    areas: ["TEST area"],
    experience: "TEST experience",
    availability: "TEST hours",
    rightToWorkType: "TEST permission",
    checksAcknowledged: true,
  };
  await denied("old draft declaration cannot be recorded as approved", () =>
    value("select submit_cleaner_application($1,$2,$3,$4)", [
      details,
      "DRAFT",
      "Onboarding Process 3.1A",
      "1.0",
    ]),
  );
  await check(
    "approved no-login application records exact D01 and queues E01 once",
    async () => {
      await value("select intake_cleaner_application($1,$2,$3,$4,$5,$6)", [
        details,
        catalog.declarations[0].wording,
        "Onboarding Process 3.1A",
        "1.0",
        "192.0.2.1",
        "a".repeat(64),
      ]);
      await db.exec("reset role");
      const row = (await db.query("select * from cleaner_applications"))
        .rows[0];
      application = row.id;
      assert.equal(row.declaration_pending, false);
      assert.equal(row.declaration_version, "1.0");
      assert.equal(row.declaration_text, catalog.declarations[0].wording);
      assert.equal(row.declaration_ip, "192.0.2.1");
      assert.equal(await value("select count(*)::int from auth.users"), 0);
      assert.equal(await value("select count(*)::int from providers"), 0);
      assert.equal(
        await value("select status from cleaner_application_communications"),
        "queued",
      );
    },
  );
  await actor();
  await denied("stage completion without every approved tick is blocked", () =>
    record("complete", "screened"),
  );
  await actor("authenticated", "onboarding", "aal1");
  await denied("ticks require staff MFA", () =>
    value("select staff_tick_cleaner_checklist($1,$2,$3,true,$4)", [
      application,
      "deskScreening",
      "application-record",
      "TEST note saved correctly",
    ]),
  );
  await actor();
  await check("each tick records staff UTC time note and version", async () => {
    for (const item of catalog.checklists[0].items)
      await value("select staff_tick_cleaner_checklist($1,$2,$3,true,$4)", [
        application,
        "deskScreening",
        item.id,
        "TEST fictional screening note",
      ]);
    const row = await value("select staff_open_cleaner_application($1,false)", [
      application,
    ]);
    assert.equal(row.checklist.length, 6);
    for (const tick of row.checklist) {
      assert.equal(tick.actor, staff);
      assert.equal(tick.version, "1.0");
      assert.ok(tick.recorded_at);
      assert.ok(tick.note.startsWith("TEST"));
    }
    await record("record", "screened", { note: "TEST screening evidence" });
    await record("complete", "screened");
  });
  await actor("authenticated", "onboarding", "aal2", false);
  await denied("private checklist cannot be ticked without named access", () =>
    value("select staff_tick_cleaner_checklist($1,$2,$3,true,$4)", [
      application,
      "dbsReview",
      "dbs-access",
      "TEST evidence note retained",
    ]),
  );
  await actor("authenticated", "onboarding");
  await denied("onboarding member cannot publish a DBS decision", () =>
    value(
      "select staff_publish_cleaner_decision($1,$2,$3,$4,$5,now()+interval '1 day',true)",
      [
        application,
        "TEST considered decision",
        "TEST detailed reasons",
        "TEST applicant explanation",
        "b".repeat(64),
      ],
    ),
  );
  await actor();
  await check(
    "Manager publishes private reasons with an expiring revocable link",
    async () => {
      await value(
        "select staff_publish_cleaner_decision($1,$2,$3,$4,$5,now()+interval '1 day',true)",
        [
          application,
          "TEST considered decision",
          "TEST detailed reasons",
          "TEST applicant explanation",
          "b".repeat(64),
        ],
      );
      const general = await value(
        "select staff_open_cleaner_application($1,false)",
        [application],
      );
      assert.deepEqual(general.secureDecisions, []);
      assert.ok(!JSON.stringify(general).includes("TEST detailed reasons"));
    },
  );
  await actor("service_role");
  await denied("wrong personal token cannot read a decision", () =>
    value("select open_cleaner_secure_decision($1)", ["c".repeat(64)]),
  );
  await check(
    "applicant can read own written reasons and request human review once",
    async () => {
      const opened = await value("select open_cleaner_secure_decision($1)", [
        "b".repeat(64),
      ]);
      assert.equal(opened.reasons, "TEST detailed reasons");
      const review = await value("select open_cleaner_secure_decision($1,$2)", [
        "b".repeat(64),
        "TEST please review this explanation",
      ]);
      assert.equal(review.reviewRequested, true);
      await value("select open_cleaner_secure_decision($1,$2)", [
        "b".repeat(64),
        "TEST repeated request",
      ]);
      await db.exec("reset role");
      assert.equal(
        await value(
          "select count(*)::int from cleaner_onboarding_private.case_locks where resolved_at is null",
        ),
        1,
      );
    },
  );
  await actor("service_role");
  await check(
    "email queue routes fictional tests only to one allowlisted inbox",
    async () => {
      const rows = await value(
        "select claim_cleaner_onboarding_emails(array['owner@example.invalid'])",
      );
      assert.ok(rows.length >= 2);
      assert.ok(rows.every((r) => r.email === "owner@example.invalid"));
      assert.deepEqual(
        await value(
          "select claim_cleaner_onboarding_emails(array['owner@example.invalid'])",
        ),
        [],
      );
      const mail = rows.find((r) => r.template_key === "applicationReceived");
      assert.ok(mail);
      const payload = {
        to: [mail.email],
        from: "staging@opulencebliss.com",
        subject: "TEST email",
        text: "TEST exact frozen body",
      };
      assert.deepEqual(
        await value("select prepare_cleaner_onboarding_email($1,$2,$3)", [
          mail.id,
          mail.claim_token,
          payload,
        ]),
        payload,
      );
      assert.deepEqual(
        await value("select prepare_cleaner_onboarding_email($1,$2,$3)", [
          mail.id,
          mail.claim_token,
          { ...payload, text: "changed" },
        ]),
        payload,
      );
      assert.equal(
        await value("select finish_cleaner_onboarding_email($1,$2,true)", [
          mail.id,
          mail.claim_token,
        ]),
        true,
      );
      assert.equal(
        await value("select finish_cleaner_onboarding_email($1,$2,true)", [
          mail.id,
          mail.claim_token,
        ]),
        false,
      );
    },
  );
  await actor("authenticated", "developer");
  await check(
    "developer is refused and the denied opening is audited without disclosing a record",
    async () => {
      assert.deepEqual(
        await value("select staff_open_cleaner_application($1,true)", [
          application,
        ]),
        { accessDenied: true },
      );
      await db.exec("reset role");
      assert.equal(
        await value(
          "select count(*)::int from cleaner_onboarding_private.events where action='record_access_denied'",
        ),
        1,
      );
      await actor("authenticated", "developer");
    },
  );
  await denied("staff cannot read raw private decision table", () =>
    db.exec("select * from cleaner_onboarding_private.secure_decisions"),
  );
  await db.exec(`reset role;
    alter table auth.users add column email text;
    create table profiles(id uuid primary key,email text,full_name text,phone text,role text);
    alter table providers alter column id set default gen_random_uuid(),add column profile_id uuid,
      add column display_name text,add column services text[],add column vetting_status text default 'pending',
      add column show_on_our_pros boolean default false,add column is_suspended boolean default false,
      add column service_approvals jsonb default '{"cleaning":"pending"}',add column stripe_account_id text,
      add column suspended_at timestamptz,add column suspension_reason text,add column dbs_verified boolean default false;
    create table provider_dbs_checks(provider_id uuid primary key,certificate_number text,issue_date date,status text,
      reviewed_at timestamptz,reviewed_by uuid,review_note text,certificate_original_name text not null,
      certificate_mime_type text not null);
    create table professional_setup_invitations(provider_id uuid primary key,user_id uuid,created_by uuid,setup_completed_at timestamptz);
    create function professional_reviewed_documents(uuid,uuid) returns boolean language sql as $$select false$$;
    create function professional_approval_fingerprint(uuid) returns text language sql as $$select md5($1::text)$$;
    create table provider_profile_settings(provider_id uuid primary key,emergency_contact_name text,emergency_contact_phone text);
    create table legal_documents(slug text,version text,published boolean,title text,content_html text);
    create table account_legal_acceptances(id bigint generated always as identity primary key,user_id uuid,document_slug text,version text,
      accepted_at timestamptz default clock_timestamp(),acceptance_evidence jsonb,booking_id uuid,
      unique nulls not distinct(user_id,document_slug,version,booking_id));
    create table booking_offers(provider_id uuid);create table booking_offer_queue(provider_id uuid);
    create table bookings(id uuid default gen_random_uuid(),provider_id uuid,scheduled_at timestamptz,status text);
    create table check_ins(booking_id uuid,left_at timestamptz);
    create table provider_job_invoices(booking_id uuid,provider_id uuid,completed_at timestamptz);
    create table provider_verification_items(provider_id uuid,document_type text,status text,expires_at date,next_check_at date,
      label text,document_storage_path text,document_original_name text,document_mime_type text,uploaded_at timestamptz,
      checked_at timestamptz,reviewed_by uuid,review_note text,gov_uk_checked_on date,updated_at timestamptz,unique(provider_id,document_type));
    create schema storage;create table storage.objects(bucket_id text,name text);
    create table staff_role_memberships(profile_id uuid,active boolean,staff_role text);
    create table notifications(user_id uuid,title text,body text,href text);
    create table account_incidents(subject_provider_id uuid,reporter_id uuid,complainant_email text,status text);
    create function professional_verification_block(uuid) returns text language sql as $$select null::text$$;
    create function retention_delete_authorised() returns boolean language sql as $$select false$$;
  `);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261027000100_acceptance_evidence_retention_guards.sql",
      "utf8",
    ).match(
      /create function public\.guard_acceptance_evidence_mutation\(\)[\s\S]*?\$function\$;/,
    )[0],
  );
  for (const file of [
    "20261106091246_cleaner_induction_account_handoff.sql",
    "20261106092348_cleaner_stage2_activation_followups.sql",
    "20261106101839_cleaner_stage2_evidence_handoff.sql",
    "20261106132822_cleaner_stage2_runtime_updates.sql",
    "20261106134034_cleaner_stage2_policy_acceptances.sql",
    "20261106202602_cleaner_stage2_completed_visit_followups.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await actor("service_role");
  const secondDetails = {
    ...details,
    email: "second-cleaner@example.invalid",
    phone: "+442079460003",
  };
  application = await value("select submit_cleaner_application($1,$2,$3,$4)", [
    secondDetails,
    catalog.declarations[0].wording,
    "Onboarding Process 3.1A",
    "1.0",
  ]);
  await actor();
  await check(
    "approved checklist and actual evidence progress the five stages in order",
    async () => {
      for (const [stage, evidence] of [
        ["screened", { note: "TEST desk check" }],
        ["interviewed", { notes: "TEST meets published requirements" }],
        [
          "id_rtw_verified",
          {
            checked_on: new Date().toISOString().slice(0, 10),
            document_type: "TEST live evidence",
            outcome: "verified",
            no_expiry: true,
            self_employment_permitted: true,
          },
        ],
        [
          "dbs_recorded",
          {
            certificate_name: "TEST Fictional Cleaner",
            certificate_number: "000000000001",
            issue_date: new Date().toISOString().slice(0, 10),
            outcome: "clear",
          },
        ],
        ["experience_checked", { evidence: "TEST fictional reference" }],
      ]) {
        const group = catalog.checklists.find((g) => g.stage === stage);
        for (const item of group.items)
          await value("select staff_tick_cleaner_checklist($1,$2,$3,true,$4)", [
            application,
            group.id,
            item.id,
            "TEST factual evidence reviewed",
          ]);
        await record("record", stage, evidence);
        await record("complete", stage);
      }
    },
  );
  let host;
  await check(
    "personal induction invitation creates no Auth identity and starts closed",
    async () => {
      host = await value(
        "select staff_issue_cleaner_induction($1,now()+interval '1 day',$2,$3,now()+interval '1 day 6 hours',null)",
        [application, "https://meet.google.com/abc-defg-hij", "d".repeat(64)],
      );
      await db.exec("reset role");
      assert.equal(await value("select count(*)::int from auth.users"), 0);
      assert.equal(
        await value(
          "select opened from cleaner_assessment_private.host_sessions where id=$1",
          [host],
        ),
        false,
      );
    },
  );
  await actor("service_role");
  await denied("no account upgrade before a passed assessment", () =>
    value("select cleaner_passed_setup_context($1)", ["e".repeat(64)]),
  );
  await actor();
  await value("select staff_cleaner_assessment_host($1,true,$2,true,$3)", [
    host,
    application,
    "TEST attended live induction",
  ]);
  await db.exec("reset role");
  await db.exec(
    "insert into cleaner_assessment_private.questions select n,'TEST question '||n,array['TEST correct','TEST alternative','TEST alternative 2'],1 from generate_series(1,25)n; insert into cleaner_assessment_private.writing_prompts select n,'TEST writing prompt '||n from generate_series(1,5)n",
  );
  await actor("service_role");
  let snapshot = await value("select cleaner_assessment_start($1,$2,true)", [
    "d".repeat(64),
    "e".repeat(64),
  ]);
  await check(
    "real server marking followed by staff writing pass unlocks account handoff",
    async () => {
      for (let n = 1; n <= 15; n++)
        snapshot = await value(
          "select cleaner_assessment_command($1,$2,'answer',$3,$4,null)",
          [
            "e".repeat(64),
            snapshot.attemptId,
            n,
            snapshot.choices.find((c) => c.text === "TEST correct").id,
          ],
        );
      assert.equal(snapshot.phase, "writing");
      snapshot = await value(
        "select cleaner_assessment_command($1,$2,'writing_submit',null,null,$3)",
        [
          "e".repeat(64),
          snapshot.attemptId,
          "TEST fictional writing submitted by the applicant",
        ],
      );
      await actor();
      await value("select staff_mark_cleaner_writing($1,true,$2)", [
        snapshot.attemptId,
        "TEST writing meets the published criteria",
      ]);
      await actor("service_role");
      const context = await value("select cleaner_passed_setup_context($1)", [
        "e".repeat(64),
      ]);
      assert.equal(context.applicationId, application);
    },
  );
  const user = "00000000-0000-4000-8000-000000000002";
  const second = "00000000-0000-4000-8000-000000000003";
  await db.exec("reset role");
  await db.query("insert into auth.users values($1,$2)", [
    user,
    secondDetails.email,
  ]);
  await db.query(
    "insert into profiles values($1,$2,'TEST existing customer name',null,'customer')",
    [user, secondDetails.email],
  );
  await actor("service_role");
  const provider = await value("select link_cleaner_passed_account($1,$2)", [
    "e".repeat(64),
    user,
  ]);
  await check(
    "account handoff keeps an existing identity and stored name with no DBS copy",
    async () => {
      assert.equal(
        await value("select link_cleaner_passed_account($1,$2)", [
          "e".repeat(64),
          user,
        ]),
        provider,
      );
      await db.exec("reset role");
      assert.equal(
        await value("select full_name from profiles where id=$1", [user]),
        "TEST existing customer name",
      );
      assert.equal(
        await value(
          "select certificate_mime_type from provider_dbs_checks where provider_id=$1",
          [provider],
        ),
        null,
      );
      assert.equal(
        await value("select vetting_status from providers where id=$1", [
          provider,
        ]),
        "pending",
      );
    },
  );
  await actor();
  await check(
    "private evidence requires named MFA staff, actual stored file and insurance cover",
    async () => {
      const args = [
        application,
        "photo_id",
        provider + "/photo_id/TEST.pdf",
        "TEST fictional ID.pdf",
        "application/pdf",
        null,
        "TEST original inspected evidence",
        null,
      ];
      await assert.rejects(() =>
        value(
          "select staff_file_cleaner_evidence($1,$2,$3,$4,$5,$6,$7,$8)",
          args,
        ),
      );
      await db.exec("reset role");
      await db.query(
        "insert into storage.objects values('provider-verification',$1)",
        [args[2]],
      );
      await actor("authenticated", "manager", "aal1");
      await assert.rejects(() =>
        value(
          "select staff_file_cleaner_evidence($1,$2,$3,$4,$5,$6,$7,$8)",
          args,
        ),
      );
      await actor();
      await value(
        "select staff_file_cleaner_evidence($1,$2,$3,$4,$5,$6,$7,$8)",
        args,
      );
      await db.exec("reset role");
      assert.equal(
        await value("select professional_reviewed_documents($1,$2)", [
          provider,
          staff,
        ]),
        true,
      );
      await db.exec("reset role");
      const insurance = provider + "/public_liability_insurance/TEST.pdf";
      await db.query(
        "insert into storage.objects values('provider-verification',$1)",
        [insurance],
      );
      await actor();
      await assert.rejects(() =>
        value(
          "select staff_file_cleaner_evidence($1,'public_liability_insurance',$2,'TEST insurance.pdf','application/pdf',current_date+30,'TEST cover reviewed',99999999)",
          [application, insurance],
        ),
      );
      await value(
        "select staff_file_cleaner_evidence($1,'public_liability_insurance',$2,'TEST insurance.pdf','application/pdf',current_date+30,'TEST cover reviewed',100000000)",
        [application, insurance],
      );
    },
  );
  await actor("authenticated", "customer", "aal1", false, user);
  await check(
    "own setup is visible but cannot self-complete or receive work",
    async () => {
      assert.equal(
        (await value("select own_cleaner_stage2_setup()")).providerId,
        provider,
      );
      await assert.rejects(() =>
        value("select complete_cleaner_stage2_setup($1,'acct_TEST')", [user]),
      );
      await db.exec("reset role");
      await db.query("insert into booking_offers values($1)", [provider]);
      assert.equal(await value("select count(*)::int from booking_offers"), 0);
    },
  );
  await actor("service_role");
  await denied("missing post-assessment acceptances block setup", () =>
    value("select complete_cleaner_stage2_setup($1,'acct_TEST')", [user]),
  );
  await db.exec("reset role");
  await db.query(
    "insert into account_legal_acceptances(user_id,document_slug,version,accepted_at,acceptance_evidence) values($1,'privacy','1.0',now()-interval '1 day','{}')",
    [user],
  );
  const acceptedDocuments = [];
  for (const slug of [
    "cleaner-terms",
    "cleaner-cancellation",
    "privacy",
    "safeguarding",
    "dbs-data",
  ]) {
    await db.query(
      "insert into legal_documents values($1,'1.0',true,$1,'TEST canonical '||$1)",
      [slug],
    );
    await db.query(
      "insert into account_legal_acceptances(user_id,document_slug,version,acceptance_evidence) values($1,$2,'1.0',$3) on conflict do nothing",
      [
        user,
        slug,
        {
          document: { slug, version: "1.0", title: slug },
          checkboxes: [{ key: slug, checked: true, text: "TEST consent" }],
        },
      ],
    );
    acceptedDocuments.push({
      slug,
      version: "1.0",
      title: slug,
      sourceContentHtml: "TEST canonical " + slug,
      contentHash: createHash("sha256")
        .update("TEST canonical " + slug)
        .digest("hex"),
    });
  }
  await actor("service_role");
  await check(
    "existing customer can give fresh post-assessment acceptances without rewriting earlier evidence",
    async () => {
      await value("select record_cleaner_stage2_acceptances($1,$2)", [
        user,
        {
          schemaVersion: 1,
          acceptedAt: new Date().toISOString(),
          request: { ip: "192.0.2.1" },
          checkboxes: Array.from({ length: 5 }, (_, n) => ({
            key: "TEST-" + n,
            text: "TEST agreement",
            checked: true,
          })),
          documents: acceptedDocuments,
        },
      ]);
      await db.exec("reset role");
      assert.equal(
        await value(
          "select count(*)::int from cleaner_stage2_policy_acceptances where user_id=$1",
          [user],
        ),
        5,
      );
      assert.equal(
        await value(
          "select accepted_at<now()-interval '12 hours' from account_legal_acceptances where user_id=$1 and document_slug='privacy'",
          [user],
        ),
        true,
      );
      await assert.rejects(() =>
        db.query(
          "update cleaner_stage2_policy_acceptances set accepted_at=now() where user_id=$1",
          [user],
        ),
      );
      await actor("service_role");
    },
  );
  await denied("missing emergency contact blocks setup", () =>
    value("select complete_cleaner_stage2_setup($1,'acct_TEST')", [user]),
  );
  await db.exec("reset role");
  await db.query(
    "insert into provider_profile_settings values($1,'TEST Contact','+442079460004','TEST relationship')",
    [provider],
  );
  await actor("service_role");
  await denied("missing own payout account blocks setup", () =>
    value("select complete_cleaner_stage2_setup($1,'acct_TEST')", [user]),
  );
  await db.exec("reset role");
  await db.query(
    "update providers set stripe_account_id='acct_TEST' where id=$1",
    [provider],
  );
  await actor("service_role");
  await check(
    "completed setup queues accepted-version welcome without activation",
    async () => {
      await value("select complete_cleaner_stage2_setup($1,'acct_TEST')", [
        user,
      ]);
      await db.exec("reset role");
      assert.equal(
        await value("select status from cleaner_applications where id=$1", [
          application,
        ]),
        "accepted_setup",
      );
      assert.equal(
        await value(
          "select count(*)::int from cleaner_application_communications where application_id=$1 and template_key='stage2Welcome'",
          [application],
        ),
        1,
      );
      await assert.rejects(() =>
        db.query(
          'update providers set service_approvals=\'{"cleaning":"approved"}\' where id=$1',
          [provider],
        ),
      );
    },
  );
  await actor();
  for (const group of catalog.checklists.filter((g) =>
    ["insuranceCheck", "inductionAssessment", "acceptancesSetup"].includes(
      g.id,
    ),
  ))
    for (const item of group.items)
      await value("select staff_tick_cleaner_checklist($1,$2,$3,true,$4)", [
        application,
        group.id,
        item.id,
        "TEST required setup evidence reviewed",
      ]);
  await actor("authenticated", "manager", "aal2", true, second);
  for (const item of catalog.checklists.find(
    (g) => g.id === "independentActivation",
  ).items)
    await value("select staff_tick_cleaner_checklist($1,$2,$3,true,$4)", [
      application,
      "independentActivation",
      item.id,
      "TEST independent checklist review",
    ]);
  await db.exec("reset role");
  await check(
    "every onboarding participant stays excluded from second sign-off",
    async () => {
      assert.equal(
        await value("select professional_reviewed_documents($1,$2)", [
          provider,
          staff,
        ]),
        true,
      );
      assert.equal(
        await value("select professional_reviewed_documents($1,$2)", [
          provider,
          second,
        ]),
        false,
      );
    },
  );
  await db.exec(`create table professional_approval_reviews(provider_id uuid,service text,
    first_reviewer uuid,second_reviewer uuid,evidence_fingerprint text);
    create function is_admin() returns boolean language sql stable as $$select public.staff_has_permission('second_signoff')$$;`);
  const independent = readFileSync(
    "supabase/migrations/20261103153510_professional_second_signoff.sql",
    "utf8",
  );
  const guardStart = independent.indexOf(
    "create function public.guard_independent_professional_activation()",
  );
  const guardEnd = independent.indexOf("$fn$;", guardStart);
  assert.ok(guardStart > 0 && guardEnd > guardStart);
  await db.exec(independent.slice(guardStart, guardEnd + 5));
  await db.exec(
    "create trigger independent_professional_activation before update of service_approvals,vetting_status on providers for each row execute function guard_independent_professional_activation()",
  );
  await db.query(
    "insert into professional_approval_reviews values($1,'cleaning',$2,$3,professional_approval_fingerprint($1))",
    [provider, staff, second],
  );
  await actor();
  await check(
    "same-person activation fails and the independent reviewer can activate",
    async () => {
      // Fixture writes use the real historical independence guard plus the new
      // Stage 2 guard. No remote identity or approval exists in this database.
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          sub: staff,
          scope: "manager",
          aal: "aal2",
          named: true,
        }),
      ]);
      await assert.rejects(() =>
        db.query(
          "update providers set service_approvals='{\"cleaning\":\"approved\"}',vetting_status='approved' where id=$1",
          [provider],
        ),
      );
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          sub: second,
          scope: "manager",
          aal: "aal2",
          named: true,
        }),
      ]);
      await db.query(
        "update providers set service_approvals='{\"cleaning\":\"approved\"}',vetting_status='approved' where id=$1",
        [provider],
      );
      assert.equal(
        await value("select status from cleaner_applications where id=$1", [
          application,
        ]),
        "active",
      );
    },
  );
  await check(
    "first/fifth reminders use actual checkout or retained invoice time once per booking",
    async () => {
      await db.query(
        "insert into bookings(provider_id,status) values($1,'completed')",
        [provider],
      );
      for (let n = 1; n <= 5; n++) {
        const booking = await value(
          "insert into bookings(provider_id,status) values($1,'completed') returning id",
          [provider],
        );
        if (n !== 1) {
          await db.query(
            "insert into check_ins values($1,now()-($2||' minutes')::interval),($1,now()-interval '1 day')",
            [booking, n],
          );
        }
        await db.query(
          "insert into provider_job_invoices values($1,$2,now()-($3||' minutes')::interval)",
          [booking, provider, n],
        );
      }
      await value("select process_cleaner_stage2_followups()");
      await value("select process_cleaner_stage2_followups()");
      assert.equal(
        await value(
          "select count(*)::int from cleaner_application_communications where application_id=$1 and template_key in('firstJobFollowUpReminder','fifthJobReviewReminder')",
          [application],
        ),
        2,
      );
    },
  );
  await check(
    "open cases protect expired application records from retention",
    async () => {
      await db.query(
        "update cleaner_applications set status='not_progressed',retention_due_at=now()-interval '1 day' where id=$1",
        [application],
      );
      await db.query(
        "insert into account_incidents values($1,null,null,'open')",
        [provider],
      );
      await value("select purge_expired_cleaner_applications()");
      assert.equal(
        await value(
          "select count(*)::int from cleaner_applications where id=$1",
          [application],
        ),
        1,
      );
    },
  );
  console.log(
    `${count} approved-workflow checks passed with fictional data; no remote changes or email.`,
  );
} catch (error) {
  console.error(error.message);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
