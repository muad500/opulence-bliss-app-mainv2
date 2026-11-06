// Offline database tests ONLY. The bank below is invented test data, not the
// client's assessment or answer key. No network/database credentials accepted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE) throw Error("Local PGLITE_MODULE required.");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
let checks = 0;
const staff = "00000000-0000-4000-8000-000000000001";
const token = "a".repeat(64),
  device = "b".repeat(64),
  secondDevice = "c".repeat(64);
let attempt;
async function actor(role = "service_role", aal = "aal1", scope = "manager") {
  await db.exec(
    `reset role;select set_config('request.jwt.claims','${JSON.stringify({ sub: staff, aal, scope })}',false);set role ${role}`,
  );
}
async function pass(label, body) {
  await body();
  checks++;
  console.log(`PASS ${label}`);
}
async function denied(sql, label) {
  await pass(label, () => assert.rejects(db.exec(sql)));
}
async function value(sql) {
  return Object.values((await db.query(sql)).rows[0])[0];
}
async function start(session = device) {
  return value(`select cleaner_assessment_start('${token}','${session}',true)`);
}
async function command(
  action,
  position = null,
  choice = null,
  writing = null,
  session = device,
) {
  return (
    await db.query("select cleaner_assessment_command($1,$2,$3,$4,$5,$6)", [
      session,
      attempt,
      action,
      position,
      choice,
      writing,
    ])
  ).rows[0].cleaner_assessment_command;
}
async function resetAttempt(multiplier = 1) {
  await db.exec(`reset role;delete from cleaner_assessment_private.attempts;
    update cleaner_assessment_private.invitations set session_hash=null,reopens_used=0,adjustment=${multiplier};
    update cleaner_applications set status='invited';
    update cleaner_assessment_private.settings set confirm_automatic_fail=false;
    update cleaner_assessment_private.host_sessions set opened=true;`);
  await actor();
  const current = await start();
  attempt = current.attemptId;
  return current;
}
async function answerAll(correctCount) {
  let current = await resetAttempt();
  for (let n = 1; n <= 15; n++) {
    // Query ONLY the private invented fixture as database owner, not the API.
    await db.exec("reset role");
    const wanted = await value(
      `select option_tokens[array_position(option_order,${n <= correctCount ? 1 : 2}::smallint)] from cleaner_assessment_private.attempt_questions where attempt_id='${attempt}' and position=${n}`,
    );
    await actor();
    current = await command("answer", n, wanted);
  }
  return current;
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema auth,public to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    create function can_review_professional() returns boolean language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb->>'aal'='aal2'$$;
    create function staff_has_permission(text) returns boolean language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb->>'aal'='aal2'
      and (current_setting('request.jwt.claims',true)::jsonb->>'scope'='manager' or $1='first_review')$$;`);
  for (const migration of [
    "20261105020000_cleaner_application_records.sql",
    "20261105021000_private_cleaner_assessment.sql",
    "20261105022000_cleaner_application_intake_retention.sql",
    "20261106211204_cleaner_stage2_writing_review_status.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(`insert into cleaner_applications(full_name,email,phone,postcode,areas,experience,availability,right_to_work_type,checks_acknowledged,declaration_text,declaration_source,privacy_version,status)
    values('TEST Applicant Only','test-assessment@example.invalid','+442079460001','SW1A1AA',array['TEST area'],'TEST experience','TEST mornings','TEST type',true,'[TEST pending]','TEST pending','TEST-1','invited');
    insert into cleaner_assessment_private.questions select n,'TEST question '||n,array['TEST fictional option 1','TEST fictional option 2','TEST fictional option 3'],1 from generate_series(1,25)n;
    insert into cleaner_assessment_private.writing_prompts select n,'TEST fictional writing prompt '||n from generate_series(1,5)n;
    insert into cleaner_assessment_private.host_sessions default values;
    insert into cleaner_assessment_private.invitations(application_id,host_session_id,token_hash,expires_at)
      select a.id,h.id,'${token}',clock_timestamp()+interval '1 hour' from cleaner_applications a cross join cleaner_assessment_private.host_sessions h;`);
  await actor("anon");
  await denied(
    `select cleaner_assessment_start('${token}','${device}',true)`,
    "anonymous client cannot call server assessment entry point",
  );
  await denied(
    "select * from cleaner_assessment_private.questions",
    "test 47: browser role cannot read private bank",
  );
  await actor("authenticated", "aal2");
  await denied(
    "select * from cleaner_assessment_private.questions",
    "test 47: staff cannot fetch the answer bank directly",
  );
  await actor();
  await denied(
    "select * from cleaner_assessment_private.questions",
    "service API role cannot bulk-fetch the private bank",
  );
  await denied(
    `select cleaner_assessment_start('${token}','${device}',true)`,
    "test 38: closed host session blocks assessment",
  );
  await db.exec(
    "reset role;update cleaner_assessment_private.host_sessions set opened=true",
  );
  await actor();
  await denied(
    `select cleaner_assessment_start('${token}','${device}',true)`,
    "manual host attendance is required",
  );
  await db.exec(
    "reset role;update cleaner_assessment_private.invitations set attendance_confirmed=true",
  );
  await actor();
  await denied(
    `select cleaner_assessment_start('${token}','${device}',false)`,
    "rules checkbox must be explicitly accepted",
  );
  let current = await start();
  attempt = current.attemptId;
  await pass(
    "test 47: only current question, opaque option tokens and deadline leave server",
    async () => {
      assert.deepEqual(
        Object.keys(current).sort(),
        [
          "attemptId",
          "choices",
          "deadline",
          "phase",
          "position",
          "prompt",
          "questionCount",
          "serverTime",
        ].sort(),
      );
      assert.equal(current.choices.length, 3);
      assert.ok(
        current.choices.every(
          (c) => Object.keys(c).sort().join(",") === "id,text",
        ),
      );
    },
  );
  await db.exec("reset role");
  await pass(
    "test 43: fifteen unique questions include all five core questions",
    async () => {
      assert.equal(
        await value(
          `select count(*)::int from cleaner_assessment_private.attempt_questions where attempt_id='${attempt}'`,
        ),
        15,
      );
      assert.equal(
        await value(
          `select count(distinct question_id)::int from cleaner_assessment_private.attempt_questions where attempt_id='${attempt}'`,
        ),
        15,
      );
      assert.equal(
        await value(
          `select count(*)::int from cleaner_assessment_private.attempt_questions where attempt_id='${attempt}' and question_id in(3,6,7,8,10)`,
        ),
        5,
      );
    },
  );
  await actor();
  await start(secondDevice);
  await pass("test 39: second device revokes first device session", () =>
    assert.rejects(command("heartbeat")),
  );
  await pass("replacement session remains valid", async () =>
    assert.equal(
      (await command("heartbeat", null, null, null, secondDevice)).phase,
      "questions",
    ),
  );
  current = await resetAttempt();
  await pass("test 41: future question cannot be answered", () =>
    assert.rejects(command("answer", 2, current.choices[0].id)),
  );
  await pass("unrecognised option tokens are rejected", () =>
    assert.rejects(
      command("answer", 1, "00000000-0000-4000-8000-000000000099"),
    ),
  );
  current = await command("answer", 1, current.choices[0].id);
  await pass("test 41: answered question cannot be revisited", () =>
    assert.rejects(command("answer", 1, current.choices[0].id)),
  );
  await denied(
    `update cleaner_assessment_private.attempts set score=15`,
    "test 48: API role cannot alter immutable score",
  );
  await resetAttempt();
  await db.exec(
    `reset role;update cleaner_assessment_private.attempt_questions set opened_at=clock_timestamp()-interval '11 seconds' where attempt_id='${attempt}' and position=1`,
  );
  await actor();
  await pass(
    "test 40: expired question is marked wrong using server time",
    async () => assert.equal((await command("heartbeat")).position, 2),
  );
  await db.exec("reset role");
  await pass("expired question cannot be backdated by the device", async () =>
    assert.equal(
      await value(
        `select correct from cleaner_assessment_private.attempt_questions where attempt_id='${attempt}' and position=1`,
      ),
      false,
    ),
  );
  await resetAttempt();
  await pass("test 44: explicit page leave ends assessment", async () =>
    assert.equal((await command("page_left")).phase, "failed"),
  );
  await resetAttempt();
  await db.exec(
    `reset role;update cleaner_assessment_private.attempts set last_seen_at=clock_timestamp()-interval '6 seconds' where id='${attempt}'`,
  );
  await actor();
  await pass(
    "test 46: missing heartbeat beyond grace ends assessment",
    async () => assert.equal((await command("heartbeat")).phase, "failed"),
  );
  await pass("test 42: eleven correct answers do not pass", async () =>
    assert.equal((await answerAll(11)).phase, "failed"),
  );
  await pass("test 42: twelve correct answers progress to writing", async () =>
    assert.equal((await answerAll(12)).phase, "writing"),
  );
  await command("writing_save", null, null, "TEST fictional saved writing.");
  await db.exec(
    `reset role;update cleaner_assessment_private.attempts set writing_started_at=clock_timestamp()-interval '301 seconds' where id='${attempt}'`,
  );
  await actor();
  await pass(
    "test 50: writing deadline submits last saved text, not a late replacement",
    async () => {
      assert.equal(
        (await command("writing_submit", null, null, "TEST late replacement"))
          .phase,
        "writing_review",
      );
      await db.exec("reset role");
      assert.equal(
        await value(
          `select writing_text from cleaner_assessment_private.attempts where id='${attempt}'`,
        ),
        "TEST fictional saved writing.",
      );
    },
  );
  await actor("authenticated");
  await denied(
    "select staff_set_cleaner_automatic_fail_review(true,'TEST setting reason')",
    "MFA required to change fail-confirmation setting",
  );
  await actor("authenticated", "aal2");
  await denied(
    "select staff_set_cleaner_automatic_fail_review(true,'')",
    "setting changes require a logged reason",
  );
  await db.exec(
    "select staff_set_cleaner_automatic_fail_review(true,'TEST setting reason')",
  );
  await resetAttempt();
  await actor("authenticated", "aal2");
  await db.exec(
    "select staff_set_cleaner_automatic_fail_review(true,'TEST setting enabled')",
  );
  await actor();
  await pass(
    "optional staff-confirmation setting holds an automatic failure",
    async () =>
      assert.equal((await command("page_left")).phase, "manager_review"),
  );
  await db.exec("reset role");
  await pass(
    "unconfirmed automatic failure has no final decision date",
    async () =>
      assert.equal(
        await value(
          `select decided_at is null from cleaner_assessment_private.attempts where id='${attempt}'`,
        ),
        true,
      ),
  );
  await actor("authenticated", "aal2", "onboarding");
  await denied(
    `select staff_review_cleaner_assessment('${attempt}','reopen','TEST review reason')`,
    "test 55: non-Manager cannot reopen an assessment",
  );
  await actor("authenticated", "aal2");
  await db.exec(
    `select staff_review_cleaner_assessment('${attempt}','confirm_fail','TEST final fail reason')`,
  );
  await pass("staff confirmation makes a held failure final", async () => {
    await db.exec("reset role");
    assert.equal(
      await value(
        `select phase from cleaner_assessment_private.attempts where id='${attempt}'`,
      ),
      "failed",
    );
  });
  await actor("authenticated", "aal2");
  await db.exec(
    `select staff_review_cleaner_assessment('${attempt}','reopen','TEST technical review reason')`,
  );
  await actor();
  current = await start();
  const oldAttempt = attempt;
  attempt = current.attemptId;
  await pass(
    "test 55: Manager reopening creates a fresh attempt, not changed old marks",
    async () => {
      assert.notEqual(attempt, oldAttempt);
      assert.equal(current.position, 1);
      await db.exec("reset role");
      assert.equal(
        await value(
          `select attempt_number from cleaner_assessment_private.attempts where id='${attempt}'`,
        ),
        2,
      );
    },
  );
  await actor();
  await command("page_left");
  await actor("authenticated", "aal2");
  await denied(
    `select staff_review_cleaner_assessment('${attempt}','reopen','TEST repeated reopen reason')`,
    "test 55: a second reopening is rejected",
  );
  await denied(
    `select staff_review_cleaner_assessment('${oldAttempt}','reopen','TEST old attempt reason')`,
    "an older failure cannot reopen over a newer attempt",
  );
  await answerAll(15);
  await command(
    "writing_submit",
    null,
    null,
    "TEST fictional writing submission.",
  );
  await actor("authenticated");
  await denied(
    `select staff_mark_cleaner_writing('${attempt}',true,'TEST marking reason')`,
    "test 51: writing marking requires staff MFA",
  );
  await actor("authenticated", "aal2", "onboarding");
  await db.exec(
    `select staff_mark_cleaner_writing('${attempt}',false,'TEST human writing criteria reason')`,
  );
  await pass(
    "test 51: writing failure waits for Manager even with automatic-fail setting off",
    async () => {
      await db.exec("reset role");
      assert.equal(
        await value(
          `select phase from cleaner_assessment_private.attempts where id='${attempt}'`,
        ),
        "manager_review",
      );
      assert.equal(
        (
          await value(
            `select cleaner_assessment_private.snapshot('${attempt}')`,
          )
        ).reviewStage,
        "writing",
      );
      assert.equal(
        await value(`select status from cleaner_applications limit 1`),
        "invited",
      );
    },
  );
  await answerAll(15);
  await command(
    "writing_submit",
    null,
    null,
    "TEST fictional writing submission.",
  );
  await actor("authenticated", "aal2", "onboarding");
  await db.exec(
    `select staff_mark_cleaner_writing('${attempt}',true,'TEST human writing passed reason')`,
  );
  await pass(
    "test 52: human writing pass reaches assessment passed, never Active",
    async () => {
      await db.exec("reset role");
      assert.equal(
        await value("select status from cleaner_applications limit 1"),
        "assessment_passed",
      );
    },
  );
  await actor("authenticated", "aal2");
  await denied(
    `select staff_mark_cleaner_writing('${attempt}',false,'TEST changed marking reason')`,
    "a completed writing decision cannot be silently overwritten",
  );
  await resetAttempt(3);
  await db.exec(`reset role;
    update cleaner_assessment_private.attempt_questions set opened_at=clock_timestamp()-interval '11 seconds' where attempt_id='${attempt}' and position=1`);
  await actor();
  await pass(
    "test 53: triple time persists on server and survives device requests",
    async () => assert.equal((await command("heartbeat")).position, 1),
  );
  await actor("authenticated");
  await denied(
    "select staff_cleaner_assessment_host(null,true,null,null,'TEST host reason')",
    "manual host console requires staff MFA",
  );
  await actor("authenticated", "aal2");
  const host = await value(
    "select id from public.cleaner_applications limit 1",
  );
  await db.exec("reset role");
  const hostId = await value(
    "select id from cleaner_assessment_private.host_sessions limit 1",
  );
  await actor("authenticated", "aal2");
  await db.exec(
    `select staff_cleaner_assessment_host('${hostId}',true,'${host}',false,'TEST manual absent record')`,
  );
  await actor();
  await denied(
    `select cleaner_assessment_start('${token}','${device}',true)`,
    "manual absent status denies the assessment without a Meet integration",
  );
  await actor("authenticated");
  await denied(
    "select staff_cleaner_assessment_overview()",
    "host progress and writing are not readable without MFA",
  );
  await actor("authenticated", "aal2");
  await pass(
    "host overview has no question bank, option mappings or correct answers",
    async () => {
      const rows = await value("select staff_cleaner_assessment_overview()");
      assert.equal(rows.length, 1);
      assert.deepEqual(
        Object.keys(rows[0]).sort(),
        [
          "application_id",
          "full_name",
          "status",
          "host_session_id",
          "host_open",
          "attendance_confirmed",
          "adjustment",
          "reopens_used",
          "attempt_id",
          "phase",
          "position",
          "score",
          "failure_reason",
          "writing_text",
          "last_seen_at",
          "legal_hold",
          "decided_at",
        ].sort(),
      );
    },
  );
  await denied(
    `select staff_adjust_cleaner_assessment('${host}',2)`,
    "timing adjustment cannot change after an assessment has started",
  );
  await db.exec("reset role;delete from cleaner_assessment_private.attempts;");
  await actor("authenticated", "aal2");
  await db.exec(`select staff_adjust_cleaner_assessment('${host}',2)`);
  await pass(
    "adjustments record only the grant, with no free-text medical detail",
    async () => {
      await db.exec("reset role");
      assert.equal(
        await value(
          "select adjustment from cleaner_assessment_private.invitations limit 1",
        ),
        2,
      );
      assert.equal(
        await value(
          "select reason is null from cleaner_assessment_private.audit where event='adjustment_granted' order by id desc limit 1",
        ),
        true,
      );
    },
  );
  await actor("authenticated", "aal2");
  await denied(
    `select staff_adjust_cleaner_assessment('${host}',4)`,
    "unsupported timing multipliers are rejected",
  );
  await db.exec(
    `reset role;update cleaner_assessment_private.invitations set attendance_confirmed=true;`,
  );
  await resetAttempt();
  await db.exec(
    `reset role;update cleaner_assessment_private.attempts set last_seen_at=clock_timestamp()-interval '6 seconds' where id='${attempt}'`,
  );
  await actor("authenticated", "aal2");
  await denied(
    "select sweep_cleaner_assessments()",
    "browser/staff cannot invoke the scheduler's service-only recovery entry point",
  );
  await actor();
  await pass(
    "test 44/46: killed browser fails from scheduler without any further device request",
    async () => {
      assert.equal(await value("select sweep_cleaner_assessments()"), 1);
      await db.exec("reset role");
      assert.equal(
        await value(
          `select phase from cleaner_assessment_private.attempts where id='${attempt}'`,
        ),
        "failed",
      );
    },
  );
  await actor();
  await pass("repeated recovery is idempotent", async () =>
    assert.equal(await value("select sweep_cleaner_assessments()"), 0),
  );
  await answerAll(15);
  await command(
    "writing_save",
    null,
    null,
    "TEST saved writing before deadline.",
  );
  await db.exec(
    `reset role;update cleaner_assessment_private.attempts set writing_started_at=clock_timestamp()-interval '301 seconds',last_seen_at=clock_timestamp()-interval '3 seconds' where id='${attempt}'`,
  );
  await actor();
  await pass(
    "test 50: scheduler submits writing saved by a device connected at its deadline",
    async () => {
      assert.equal(await value("select sweep_cleaner_assessments()"), 1);
      await db.exec("reset role");
      assert.equal(
        await value(
          `select phase from cleaner_assessment_private.attempts where id='${attempt}'`,
        ),
        "writing_review",
      );
    },
  );
  const applicationDetails = {
    fullName: "TEST Reapplication Only",
    email: "TEST-REAPPLICATION@EXAMPLE.INVALID",
    phone: "+442079460002",
    postcode: "SW1A1AA",
    areas: ["TEST area"],
    experience: "TEST experience",
    availability: "TEST weekdays",
    rightToWorkType: "TEST declaration",
    checksAcknowledged: true,
  };
  const submit = async (details = applicationDetails) =>
    (
      await db.query(
        "select submit_cleaner_application($1,'[TEST declaration placeholder]','TEST source','TEST-1')",
        [JSON.stringify(details)],
      )
    ).rows[0].submit_cleaner_application;
  await actor("anon");
  await pass(
    "anonymous clients cannot bypass application validation using the intake RPC",
    () => assert.rejects(submit()),
  );
  await actor();
  const reapplication = await submit();
  await pass("duplicate active applications are rejected atomically", () =>
    assert.rejects(submit()),
  );
  await db.exec(
    `reset role;update cleaner_applications set status='not_progressed',decision_at=clock_timestamp()-interval '1 month',retention_due_at=clock_timestamp()+interval '5 months' where id='${reapplication}'`,
  );
  await actor();
  await pass("test 56: reapplication at one month is blocked", () =>
    assert.rejects(submit()),
  );
  await pass(
    "changing email cannot evade the same-phone reapplication restriction",
    () =>
      assert.rejects(
        submit({
          ...applicationDetails,
          email: "TEST-CHANGED@EXAMPLE.INVALID",
        }),
      ),
  );
  await db.exec(
    `reset role;update cleaner_applications set decision_at=clock_timestamp()-interval '3 months' where id='${reapplication}'`,
  );
  await actor();
  await pass(
    "test 56: reapplication at three calendar months is allowed",
    async () => assert.notEqual(await submit(), reapplication),
  );
  await db.exec(`reset role;update cleaner_assessment_private.attempts set phase='passed',decided_at=clock_timestamp()-interval '7 months',writing_text='TEST expired writing' where id='${attempt}';
    update cleaner_applications set status='active' where id='${host}'`);
  await actor("authenticated", "aal2", "onboarding");
  await denied(
    `select staff_hold_cleaner_application('${host}',true,'TEST legal hold reason')`,
    "only a Manager can set or release a legal hold",
  );
  await actor("authenticated", "aal2");
  await denied(
    `select staff_hold_cleaner_application('${host}',true,'')`,
    "legal hold changes require a logged reason",
  );
  await db.exec(
    `select staff_hold_cleaner_application('${host}',true,'TEST unresolved complaint hold')`,
  );
  await actor();
  await pass(
    "test 57: legal hold retains expired assessment answers and writing",
    async () =>
      assert.equal(
        (await value("select purge_expired_cleaner_applications()"))
          .assessments,
        0,
      ),
  );
  await actor("authenticated", "aal2");
  await db.exec(
    `select staff_hold_cleaner_application('${host}',false,'TEST complaint resolved release')`,
  );
  await actor();
  await pass(
    "test 57: six-month cleanup removes assessment answers/writing but not an active application",
    async () => {
      assert.equal(
        (await value("select purge_expired_cleaner_applications()"))
          .assessments,
        1,
      );
      await db.exec("reset role");
      assert.equal(
        await value(
          `select count(*)::int from cleaner_assessment_private.attempt_questions where attempt_id='${attempt}'`,
        ),
        0,
      );
      assert.equal(
        await value(
          `select count(*)::int from cleaner_applications where id='${host}'`,
        ),
        1,
      );
    },
  );
  await db.exec(
    `reset role;update cleaner_applications set status='not_progressed',retention_due_at=clock_timestamp()-interval '1 day',legal_hold=true where id='${reapplication}'`,
  );
  await actor();
  await pass(
    "legal hold also protects an expired rejected application",
    async () =>
      assert.equal(
        (await value("select purge_expired_cleaner_applications()"))
          .applications,
        0,
      ),
  );
  await db.exec(
    `reset role;update cleaner_applications set legal_hold=false where id='${reapplication}'`,
  );
  await actor();
  await pass("released hold permits rejected-application cleanup", async () =>
    assert.equal(
      (await value("select purge_expired_cleaner_applications()")).applications,
      1,
    ),
  );
  await actor("authenticated", "aal2");
  await denied(
    "select purge_expired_cleaner_applications()",
    "staff/browser cannot bypass the retention scheduler",
  );
  console.log(
    `${checks} offline assessment database checks passed; fictional bank only.`,
  );
} finally {
  await db.close();
}
