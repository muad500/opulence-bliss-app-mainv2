// Offline source/import verification. Default bank is invented. Optional
// --approved-source reads only the ignored, local approved source store.
// No bank text, choice, answer key, session capability or personal data output.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  parseAssessmentParagraphs,
  assessmentImportSql,
  privateBankHash,
  ASSESSMENT_APPROVED_SHA256,
  ASSESSMENT_CORE_IDS,
  assessmentBankFingerprintSql,
} from "./cleaner-assessment-pack.mjs";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE) throw Error("Local PGLITE_MODULE required.");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
const actualSource = process.argv.includes("--approved-source");
const staff = "00000000-0000-4000-8000-000000000001";
let checks = 0;
async function value(sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
async function check(label, body) {
  await body();
  checks++;
  console.log(`PASS ${label}`);
}
async function role(name = "service_role") {
  await db.exec(`reset role;set role ${name}`);
}
function inventedPack() {
  const p = [
    "CLEANER ASSESSMENT CONTENT PACK",
    "TEST | Version 1.0 | Effective from: 1 October 2026",
    "Part 2. TEST",
  ];
  for (let n = 1; n <= 25; n++)
    p.push(
      `${n}. ${ASSESSMENT_CORE_IDS.includes(n) ? "[core] " : ""}TEST invented question ${n}?`,
      "A. TEST option ' one \\ £  (correct)",
      "B. TEST option two",
      "C. TEST option three",
    );
  p.push("Part 3. TEST");
  for (let n = 1; n <= 5; n++) p.push(`${n}. TEST invented prompt ${n}`);
  p.push("Part 4. TEST");
  return parseAssessmentParagraphs(p);
}
try {
  const pack = actualSource
    ? JSON.parse(
        readFileSync(
          ".local-secrets/assessment-source/parsed-private-pack.json",
          "utf8",
        ),
      )
    : inventedPack();
  const sql = actualSource
    ? readFileSync(
        ".local-secrets/assessment-source/import-staging-assessment.sql",
        "utf8",
      )
    : assessmentImportSql(pack, ASSESSMENT_APPROVED_SHA256);
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema vault;create table vault.secrets(name text);
    create table auth.users(id uuid primary key);create table public.providers(id uuid primary key);
    insert into vault.secrets values('opulence_staging_recovery_secret');
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select '${staff}'::uuid$$;
    create function staff_has_permission(text) returns boolean language sql stable as $$select false$$;
    create function can_review_professional() returns boolean language sql stable as $$select false$$;
    create function can_view_dbs() returns boolean language sql stable as $$select false$$;`);
  for (const file of [
    "20261105020000_cleaner_application_records.sql",
    "20261105021000_private_cleaner_assessment.sql",
    "20261105022000_cleaner_application_intake_retention.sql",
    "20261105102000_cleaner_onboarding_workflow.sql",
    "20261105104243_cleaner_assessment_decision_mail.sql",
    "20261105111015_cleaner_assessment_pack_provenance.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await role();
  await check("unimported bank cannot start an assessment", () =>
    assert.rejects(
      db.query("select cleaner_assessment_start($1,$2,true)", [
        "a".repeat(64),
        "b".repeat(64),
      ]),
    ),
  );
  await db.exec("reset role");
  await db.exec(sql);
  await check(
    "source import is exact and marker-free on device choices",
    async () => {
      const saved = {
        questions: (
          await db.query(
            "select id,prompt,options,correct_option from cleaner_assessment_private.questions order by id",
          )
        ).rows,
        writing: (
          await db.query(
            "select id,prompt from cleaner_assessment_private.writing_prompts order by id",
          )
        ).rows,
      };
      // Compare fingerprints, not objects: assertion failures must not dump a key.
      assert.equal(privateBankHash(saved), privateBankHash(pack));
      assert.equal(
        await value(assessmentBankFingerprintSql),
        privateBankHash(pack),
      );
      assert.equal(
        saved.questions.some((q) =>
          q.options.some((o) => /\(correct\)/i.test(o)),
        ),
        false,
      );
    },
  );
  await db.exec(sql);
  await check(
    "repeating an identical import keeps one provenance record",
    async () => {
      assert.equal(
        await value(
          "select count(*)::int from cleaner_assessment_private.pack_imports",
        ),
        1,
      );
    },
  );
  for (const name of ["anon", "authenticated", "service_role"]) {
    await role(name);
    await check(`${name} cannot bulk-read the bank or marking key`, () =>
      assert.rejects(
        db.query("select * from cleaner_assessment_private.questions"),
      ),
    );
  }
  await role();
  await check(
    "private status contains counts/fingerprints without a bank or answer",
    async () => {
      const status = await value("select cleaner_assessment_pack_status()");
      assert.equal(status.questions, 25);
      assert.equal(status.writingPrompts, 5);
      assert.equal(Object.hasOwn(status, "correct_option"), false);
    },
  );
  async function attempt(correctCount, salt) {
    await db.exec("reset role");
    const application = await value(
      "insert into cleaner_applications(full_name,email,phone,postcode,areas,experience,availability,right_to_work_type,checks_acknowledged,declaration_text,declaration_source,privacy_version,status) values('TEST Fictional Quiz Applicant',$1,$2,'SW1A1AA',array['TEST area'],'TEST','TEST','TEST',true,'TEST pending','TEST source','TEST-1','invited') returning id",
      [`test-${salt}@example.invalid`, `+44207946000${salt}`],
    );
    const host = await value(
      "insert into cleaner_assessment_private.host_sessions(opened) values(true) returning id",
    );
    const hash = String(salt).repeat(64);
    const device = String(salt + 2).repeat(64);
    const invitation = await value(
      "insert into cleaner_assessment_private.invitations(application_id,host_session_id,token_hash,expires_at,attendance_confirmed) values($1,$2,$3,now()+interval '1 day',true) returning id",
      [application, host, hash],
    );
    await role();
    let snapshot = await value("select cleaner_assessment_start($1,$2,true)", [
      hash,
      device,
    ]);
    const id = snapshot.attemptId;
    for (let position = 1; position <= 15; position++) {
      if (
        Object.hasOwn(snapshot, "correct_option") ||
        JSON.stringify(snapshot).includes("(correct)")
      )
        throw Error("Private marking data leaked into a device response.");
      await db.exec("reset role");
      // Private owner-side oracle; never part of a device payload or output.
      const choice = await value(
        `select option_tokens[array_position(option_order,
        case when $3 then correct_option else (correct_option % 3 + 1)::smallint end)]
        from cleaner_assessment_private.attempt_questions where attempt_id=$1 and position=$2`,
        [id, position, position <= correctCount],
      );
      await role();
      snapshot = await value(
        "select cleaner_assessment_command($1,$2,'answer',$3,$4)",
        [device, id, position, choice],
      );
    }
    return { snapshot, id, invitation };
  }
  const passed = await attempt(12, 1);
  await check(
    "twelve server-marked answers unlock writing without activating an account",
    async () => {
      assert.equal(passed.snapshot.phase, "writing");
    },
  );
  await db.exec("reset role");
  await check(
    "source replacement is blocked during an active attempt",
    async () => {
      await assert.rejects(db.exec(sql));
      await db.exec("rollback");
    },
  );
  // Finish this isolated fixture, without marking writing or activating anyone.
  await db.query(
    "update cleaner_assessment_private.attempts set phase='failed',failure_reason='TEST fixture ended',decided_at=now() where id=$1",
    [passed.id],
  );
  const failed = await attempt(11, 2);
  await check(
    "eleven server-marked answers fail and never open writing",
    async () => {
      assert.equal(failed.snapshot.phase, "failed");
    },
  );
  await db.exec("reset role");
  await check(
    "the reusable staging smoke rolls back every fictional record",
    async () => {
      await db.exec(
        readFileSync(
          "supabase/tests/cleaner_assessment_pack_smoke.sql",
          "utf8",
        ),
      );
      const result = await value(
        "select current_setting('opulence.stage2_pack_smoke')::jsonb",
      );
      assert.equal(result.pass, true);
      assert.equal(result.fixtureRecordsLeft, 0);
      assert.equal(result.cases, 2);
    },
  );
  await db.exec(
    "insert into vault.secrets values('opulence_production_visit_payments_secret')",
  );
  await check("the import refuses a Production marker", async () => {
    await assert.rejects(db.exec(sql));
    await db.exec("rollback");
  });
  console.log(
    `${checks} isolated pack/import/marking checks passed (${actualSource ? "approved private source" : "invented bank"}); no network, account, email or payment.`,
  );
} catch (error) {
  // Never print database query/parameters or a diff of the actual source bank.
  console.error(
    error?.code
      ? `Private pack verification failed (${error.code}).`
      : error.message,
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
