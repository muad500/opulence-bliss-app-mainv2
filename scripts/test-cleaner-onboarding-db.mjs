// Isolated, fictional applicant records only. This script accepts no remote
// database URL, never sends email, and never creates a real approval.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE) throw Error("Local PGLITE_MODULE required.");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
const staff = "00000000-0000-4000-8000-000000000001";
const details = {
  fullName: "TEST Fictional Applicant",
  email: "test-applicant@example.invalid",
  phone: "+442079460001",
  postcode: "SW1A1AA",
  areas: ["TEST area"],
  experience: "TEST experience",
  availability: "TEST weekday",
  rightToWorkType: "TEST evidence",
  checksAcknowledged: true,
};
let count = 0,
  application;
async function actor(
  role = "authenticated",
  scope = "manager",
  aal = "aal2",
  named = true,
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: staff, scope, aal, named }),
  ]);
  await db.exec(`set role ${role}`);
}
async function result(sql, args = []) {
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
async function action(
  action,
  stage = null,
  details = {},
  note = "TEST fictional staff reason",
) {
  return result("select staff_record_cleaner_application($1,$2,$3,$4,$5)", [
    application,
    action,
    stage,
    details,
    note,
  ]);
}
async function intake(
  email = details.email,
  phone = details.phone,
  rateKey = "a".repeat(64),
) {
  return result("select intake_cleaner_application($1,$2,$3,$4,$5,$6)", [
    { ...details, email, phone },
    "[Onboarding Process 3.1A – wording to be supplied]",
    "Onboarding Process 3.1A",
    "TEST-1",
    "192.0.2.1",
    rateKey,
  ]);
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
    create table auth.users(id uuid primary key);
    create table providers(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    create function staff_has_permission(text) returns boolean language sql stable as $$
      select coalesce(current_setting('request.jwt.claims',true)::jsonb->>'aal'='aal2'
        and case current_setting('request.jwt.claims',true)::jsonb->>'scope'
          when 'manager' then true
          when 'onboarding' then $1 in ('onboarding','first_review','private_evidence')
          when 'second_signoff' then $1 in ('onboarding','second_signoff')
          else false end,false)$$;
    create function can_review_professional() returns boolean language sql stable as $$select public.staff_has_permission('onboarding')$$;
    create function can_view_dbs() returns boolean language sql stable as $$
      select coalesce(current_setting('request.jwt.claims',true)::jsonb->>'named'='true',false)
        and public.staff_has_permission('private_evidence')$$;
  `);
  for (const name of [
    "20261105020000_cleaner_application_records.sql",
    "20261105021000_private_cleaner_assessment.sql",
    "20261105022000_cleaner_application_intake_retention.sql",
    "20261105102000_cleaner_onboarding_workflow.sql",
    "20261105104243_cleaner_assessment_decision_mail.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await actor("service_role");
  await check("no-login intake records explicit pending consent", async () => {
    assert.deepEqual(await intake(), { ok: true });
    await db.exec("reset role");
    const rows = (
      await db.query(
        "select id,status,declaration_pending,declaration_ip from cleaner_applications",
      )
    ).rows;
    application = rows[0].id;
    assert.equal(rows[0].status, "applied");
    assert.equal(rows[0].declaration_pending, true);
    assert.equal(rows[0].declaration_ip, "192.0.2.1");
    assert.equal(await result("select count(*)::int from auth.users"), 0);
    assert.equal(await result("select count(*)::int from providers"), 0);
  });
  await actor("service_role");
  await check(
    "duplicates return same outward result without second record or email",
    async () => {
      assert.deepEqual(await intake(), { ok: true });
      await db.exec("reset role");
      assert.equal(
        await result("select count(*)::int from cleaner_applications"),
        1,
      );
      assert.equal(
        await result(
          "select count(*)::int from cleaner_application_communications where status='awaiting_wording'",
        ),
        1,
      );
    },
  );
  await actor("service_role");
  await check(
    "shared database rate limit works across repeated requests",
    async () => {
      for (let n = 0; n < 3; n++)
        assert.deepEqual(await intake(), { ok: true });
      assert.deepEqual(await intake(), { limited: true });
    },
  );
  await actor("anon");
  await denied("anonymous role cannot call server intake directly", () =>
    intake(),
  );
  await actor("authenticated", "manager", "aal1");
  await denied("staff without authenticator cannot read applications", () =>
    result("select staff_cleaner_applications()"),
  );
  await actor("authenticated", "developer");
  await denied("Developer has no applicant access", () =>
    result("select staff_cleaner_applications()"),
  );
  await actor("authenticated", "onboarding");
  await check(
    "MFA onboarding list excludes private checks and contact details",
    async () => {
      const rows = await result("select staff_cleaner_applications()");
      assert.equal(rows.length, 1);
      assert.equal(Object.hasOwn(rows[0], "email"), false);
      assert.equal(Object.hasOwn(rows[0], "phone"), false);
      assert.equal(Object.hasOwn(rows[0], "declaration_ip"), false);
    },
  );
  await denied("cannot use raw application table to bypass file locks", () =>
    result("select count(*) from cleaner_applications"),
  );
  await denied("cannot read private stage table directly", () =>
    result("select count(*) from cleaner_onboarding_private.stages"),
  );
  await check("draft evidence records staff and time without approval", () =>
    action("record", "screened", { note: "TEST pending checklist" }),
  );
  await denied("missing client checklist cannot be marked completed", () =>
    action("complete", "screened"),
  );
  await denied("stages cannot be skipped", () =>
    action("complete", "experience_checked"),
  );
  await denied(
    "unknown checklist, document numbers and score fields are refused",
    () =>
      action("record", "id_rtw_verified", {
        passport_number: "TEST-NOT-STORED",
      }),
  );
  await denied("reason is required", () =>
    action("record", "screened", {}, ""),
  );
  await actor("authenticated", "second_signoff");
  await denied("second sign-off cannot perform first-review work", () =>
    action("record", "screened", {}),
  );
  await actor("authenticated", "onboarding", "aal2", false);
  await denied(
    "private evidence opening requires named DBS authorisation",
    () =>
      result("select staff_open_cleaner_application($1,true)", [application]),
  );
  await denied("private check recording requires named DBS authorisation", () =>
    action("record", "dbs_recorded", {}),
  );
  await actor("authenticated", "onboarding");
  await check(
    "private record opens explicitly and logs its viewer",
    async () => {
      await result("select staff_open_cleaner_application($1,true)", [
        application,
      ]);
      await db.exec("reset role");
      assert.equal(
        await result(
          "select count(*)::int from cleaner_onboarding_private.events where action='private_record_opened' and actor=$1",
          [staff],
        ),
        1,
      );
    },
  );
  await actor("authenticated", "onboarding");
  await db.exec("reset role");
  const host = await result(
    "insert into cleaner_assessment_private.host_sessions(opened) values(true) returning id",
  );
  const invitation = await result(
    "insert into cleaner_assessment_private.invitations(application_id,host_session_id,token_hash,session_hash,expires_at) values($1,$2,$3,$4,now()+interval '1 day') returning id",
    [application, host, "b".repeat(64), "c".repeat(64)],
  );
  const attempt = await result(
    "insert into cleaner_assessment_private.attempts(invitation_id,attempt_number,adjustment,phase) values($1,1,1,'writing_review') returning id",
    [invitation],
  );
  await actor("authenticated", "onboarding");
  await check("escalation locks the case to Manager", () => action("escalate"));
  await check(
    "assessment overview also excludes Manager-locked applications",
    async () => {
      assert.deepEqual(
        await result("select staff_cleaner_assessment_overview()"),
        [],
      );
    },
  );
  await denied("assessment adjustment cannot bypass the case lock", () =>
    result("select staff_adjust_cleaner_assessment($1,2)", [application]),
  );
  await denied("host session control cannot bypass the case lock", () =>
    result(
      "select staff_cleaner_assessment_host($1,true,null,null,'TEST host control')",
      [host],
    ),
  );
  await denied("writing marking cannot bypass the case lock", () =>
    result("select staff_mark_cleaner_writing($1,true,'TEST staff marking')", [
      attempt,
    ]),
  );
  await denied("other onboarding staff cannot read locked file", () =>
    result("select staff_open_cleaner_application($1,false)", [application]),
  );
  await denied("other onboarding staff cannot alter locked file", () =>
    action("record", "screened", {}),
  );
  await actor("authenticated", "manager");
  await check(
    "Manager can open and resolve escalation with an audit",
    async () => {
      const opened = await result(
        "select staff_open_cleaner_application($1,false)",
        [application],
      );
      assert.equal(opened.managerReview, true);
      await action("resolve");
    },
  );
  // Supplying missing source versions is an owner-only test fixture, never an
  // exposed staff action and never a claim the real client supplied the pack.
  await db.exec(
    "reset role;update cleaner_onboarding_private.source_readiness set ready=true,supplied_version='FICTIONAL TEST ONLY'",
  );
  await actor("authenticated", "onboarding");
  await check("ordered completion snapshots staff and timestamp", async () => {
    await action("complete", "screened");
    await db.exec("reset role");
    assert.equal(
      await result(
        "select completed_by::text from cleaner_onboarding_private.stages where stage='screened'",
      ),
      staff,
    );
    assert.equal(
      await result(
        "select completed_at is not null from cleaner_onboarding_private.stages where stage='screened'",
      ),
      true,
    );
  });
  await actor("authenticated", "onboarding");
  await denied("completed evidence cannot be rewritten", () =>
    action("record", "screened", { note: "TEST rewrite" }),
  );
  await action("record", "interviewed", {
    notes: "TEST interview",
    score: "TEST client criteria pending",
  });
  await action("complete", "interviewed");
  await action("record", "id_rtw_verified", {
    checked_on: "2026-01-01",
    document_type: "TEST live evidence",
    outcome: "verified",
    self_employment_permitted: true,
  });
  await denied("missing RTW expiry or no-expiry declaration cannot pass", () =>
    action("complete", "id_rtw_verified"),
  );
  await action("record", "id_rtw_verified", {
    checked_on: "2026-01-01",
    document_type: "TEST live evidence",
    outcome: "verified",
    self_employment_permitted: false,
    no_expiry: true,
  });
  await denied("permission without self-employment rights cannot pass", () =>
    action("complete", "id_rtw_verified"),
  );
  await action("record", "id_rtw_verified", {
    checked_on: "2026-01-01",
    document_type: "TEST live evidence",
    outcome: "verified",
    self_employment_permitted: true,
    no_expiry: true,
  });
  await action("complete", "id_rtw_verified");
  await action("record", "dbs_recorded", {
    certificate_name: "TEST Fictional Applicant",
    certificate_number: "001234567890",
    issue_date: "2026-01-01",
    outcome: "unspent_conviction",
  });
  await denied("conviction cannot progress without Manager decision", () =>
    action("complete", "dbs_recorded"),
  );
  await actor("authenticated", "manager");
  await action("complete", "dbs_recorded");
  await actor("authenticated", "onboarding");
  await check(
    "general record never reveals DBS evidence or private notes",
    async () => {
      const record = await result(
        "select staff_open_cleaner_application($1,false)",
        [application],
      );
      assert.equal(JSON.stringify(record).includes("001234567890"), false);
      assert.equal(
        record.stages.some((s) => s.stage === "dbs_recorded"),
        false,
      );
      assert.equal(
        record.events.some((e) => e.stage === "dbs_recorded"),
        false,
      );
    },
  );
  await action("record", "experience_checked", { manager_waiver: true });
  await denied("onboarding member cannot waive experience", () =>
    action("complete", "experience_checked"),
  );
  await actor("authenticated", "manager");
  await check(
    "Manager evidence waiver still creates no account or activation",
    async () => {
      await action("complete", "experience_checked");
      await db.exec("reset role");
      assert.equal(
        await result("select status from cleaner_applications where id=$1", [
          application,
        ]),
        "experience_checked",
      );
      assert.equal(await result("select count(*)::int from auth.users"), 0);
      assert.equal(await result("select count(*)::int from providers"), 0);
    },
  );
  await actor("authenticated", "onboarding");
  await denied("rejection is a Manager decision", () => action("reject"));
  await actor("authenticated", "manager");
  await action("escalate");
  await check(
    "rejection records stage/reason and holds exact missing email",
    async () => {
      await action("reject");
      await db.exec("reset role");
      assert.equal(
        await result("select status from cleaner_applications where id=$1", [
          application,
        ]),
        "not_progressed",
      );
      assert.equal(
        await result(
          "select retention_due_at > now()+interval '5 months' from cleaner_applications where id=$1",
          [application],
        ),
        true,
      );
      assert.equal(
        await result(
          "select status from cleaner_application_communications where application_id=$1 and template_key='applicationRejected'",
          [application],
        ),
        "awaiting_wording",
      );
    },
  );
  await actor("service_role");
  await denied("rejection revokes the old assessment capability", () =>
    result("select cleaner_assessment_command($1,$2,'heartbeat')", [
      "c".repeat(64),
      attempt,
    ]),
  );
  await db.exec("reset role");
  await check(
    "general rejection does not send the assessment-failure template",
    async () => {
      assert.equal(
        await result(
          "select count(*)::int from cleaner_assessment_private.decision_emails",
        ),
        0,
      );
    },
  );
  await db.exec("reset role");
  await db.query(
    "update cleaner_applications set retention_due_at=now()-interval '1 day' where id=$1",
    [application],
  );
  await actor("service_role");
  await check(
    "unresolved Manager case protects expired rejected records",
    async () => {
      assert.deepEqual(
        await result("select purge_expired_cleaner_applications()"),
        { assessments: 0, applications: 0 },
      );
    },
  );
  await actor("authenticated", "manager");
  await check(
    "Manager can resolve a case after rejection without changing the decision",
    () => action("resolve"),
  );
  await actor("service_role");
  await check(
    "resolved case permits due deletion, followed by idempotent zero",
    async () => {
      assert.deepEqual(
        await result("select purge_expired_cleaner_applications()"),
        { assessments: 0, applications: 1 },
      );
      assert.deepEqual(
        await result("select purge_expired_cleaner_applications()"),
        { assessments: 0, applications: 0 },
      );
    },
  );
  await db.exec("reset role");
  const failedApplication = await result(
    "insert into cleaner_applications(full_name,email,phone,postcode,areas,experience,availability,right_to_work_type,checks_acknowledged,declaration_text,declaration_source,privacy_version,status) values('TEST failed applicant','failure@example.invalid','+442079460002','SW1A1AA',array['TEST area'],'TEST','TEST','TEST',true,'TEST pending','TEST source','TEST-1','not_progressed') returning id",
  );
  const failedInvitation = await result(
    "insert into cleaner_assessment_private.invitations(application_id,host_session_id,token_hash,expires_at) values($1,$2,$3,now()+interval '1 day') returning id",
    [failedApplication, host, "d".repeat(64)],
  );
  const failedAttempt = await result(
    "insert into cleaner_assessment_private.attempts(invitation_id,attempt_number,adjustment,phase,failure_reason,decided_at) values($1,1,1,'failed','wrong answers',now()) returning id",
    [failedInvitation],
  );
  await check(
    "only a final assessment failure creates a single decision outbox entry",
    async () => {
      await db.query(
        "update cleaner_assessment_private.attempts set phase='failed' where id=$1",
        [failedAttempt],
      );
      assert.equal(
        await result(
          "select count(*)::int from cleaner_assessment_private.decision_emails",
        ),
        1,
      );
    },
  );
  await actor("authenticated", "manager");
  await denied("even MFA staff cannot claim decision emails directly", () =>
    result(
      "select claim_cleaner_assessment_emails(array['failure@example.invalid'])",
    ),
  );
  await actor("service_role");
  await check("unapproved recipient is never claimed", async () => {
    assert.deepEqual(
      await result(
        "select claim_cleaner_assessment_emails(array['other@example.invalid'])",
      ),
      [],
    );
  });
  let mail;
  await check("one worker claims the allowed final decision once", async () => {
    const rows = await result(
      "select claim_cleaner_assessment_emails(array['failure@example.invalid'])",
    );
    assert.equal(rows.length, 1);
    mail = rows[0];
    assert.deepEqual(
      await result(
        "select claim_cleaner_assessment_emails(array['failure@example.invalid'])",
      ),
      [],
    );
  });
  await check("wrong claim cannot finish delivery", async () => {
    assert.equal(
      await result("select finish_cleaner_assessment_email($1,$2,true)", [
        mail.id,
        staff,
      ]),
      false,
    );
  });
  await check("failed send remains queued with a retry delay", async () => {
    assert.equal(
      await result("select finish_cleaner_assessment_email($1,$2,false)", [
        mail.id,
        mail.claim_token,
      ]),
      true,
    );
    assert.deepEqual(
      await result(
        "select claim_cleaner_assessment_emails(array['failure@example.invalid'])",
      ),
      [],
    );
  });
  await db.exec(
    "reset role;update cleaner_assessment_private.decision_emails set claimed_until=now()-interval '1 minute'",
  );
  await actor("service_role");
  await check(
    "retry keeps its provider idempotency identity and final send cannot repeat",
    async () => {
      const retry = (
        await result(
          "select claim_cleaner_assessment_emails(array['failure@example.invalid'])",
        )
      )[0];
      assert.equal(retry.id, mail.id);
      assert.equal(
        await result("select finish_cleaner_assessment_email($1,$2,true)", [
          retry.id,
          retry.claim_token,
        ]),
        true,
      );
      assert.equal(
        await result("select finish_cleaner_assessment_email($1,$2,true)", [
          retry.id,
          retry.claim_token,
        ]),
        false,
      );
      assert.deepEqual(
        await result(
          "select claim_cleaner_assessment_emails(array['failure@example.invalid'])",
        ),
        [],
      );
    },
  );
  console.log(
    `${count} offline onboarding checks passed; no remote data, account, email or payment.`,
  );
} catch (error) {
  console.error(error.message);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
