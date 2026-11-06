// Server/operator tooling only. This module contains no client bank or key.
// Never import a source pack into app/, public/, a test fixture or a bundle.
import { createHash } from "node:crypto";
export const ASSESSMENT_SOURCE_ID = "1rqjzRHK8qiz8kmSOQ-2Xk6_VdFsOQI4c";
export const ASSESSMENT_APPROVED_SHA256 =
  "d9354835cf191d3ce88f41ee334bd275453cef3c2bf57f524f86ab38859868cb";
export const ASSESSMENT_CORE_IDS = [3, 6, 7, 8, 10];

export function parseAssessmentParagraphs(paragraphs) {
  if (
    !Array.isArray(paragraphs) ||
    paragraphs.some((line) => typeof line !== "string")
  )
    throw Error("Invalid source structure.");
  const lines = paragraphs.map((line) => line.trim()).filter(Boolean);
  if (
    lines[0] !== "CLEANER ASSESSMENT CONTENT PACK" ||
    !lines.some((line) =>
      line.includes("Version 1.0 | Effective from: 1 October 2026"),
    )
  )
    throw Error("The approved v1.0 source header is required.");
  const sections = [2, 3, 4].map((n) =>
    lines.findIndex((line) => line.startsWith(`Part ${n}.`)),
  );
  if (
    sections.some((n) => n < 0) ||
    sections[0] >= sections[1] ||
    sections[1] >= sections[2]
  )
    throw Error("The source sections are missing or out of order.");
  const questions = [];
  const bank = lines.slice(sections[0] + 1, sections[1]);
  for (let pos = 0; pos < bank.length; pos += 4) {
    const question = bank[pos]?.match(/^(\d{1,2})\. (.+)$/);
    if (!question) throw Error("A source question is malformed.");
    const id = Number(question[1]);
    const options = [],
      marked = [];
    for (let n = 0; n < 3; n++) {
      const option = bank[pos + n + 1]?.match(/^([ABC])\. (.+)$/);
      if (!option || option[1] !== "ABC"[n])
        throw Error("A source choice is missing or out of order.");
      const correct = /\s+\(correct\)$/.test(option[2]);
      const text = correct
        ? option[2].replace(/\s+\(correct\)$/, "")
        : option[2];
      if (!text || /\(correct\)/i.test(text))
        throw Error("A marking annotation is malformed.");
      options.push(text);
      if (correct) marked.push(n + 1);
    }
    if (marked.length !== 1 || questions.some((q) => q.id === id))
      throw Error(
        "Each question needs one private marking annotation and a unique number.",
      );
    const core = /^\[core\] /i.test(question[2]);
    if (core !== ASSESSMENT_CORE_IDS.includes(id))
      throw Error("The supplied core-question selection differs.");
    questions.push({
      id,
      prompt: question[2],
      options,
      correct_option: marked[0],
    });
  }
  if (
    questions.length !== 25 ||
    questions.some((q, index) => q.id !== index + 1)
  )
    throw Error("Exactly 25 ordered source questions are required.");
  const writing = lines
    .slice(sections[1] + 1, sections[2])
    .filter((line) => /^\d\. /.test(line))
    .map((line) => {
      const match = line.match(/^(\d)\. (.+)$/);
      return { id: Number(match[1]), prompt: match[2] };
    });
  if (writing.length !== 5 || writing.some((q, index) => q.id !== index + 1))
    throw Error("Exactly five ordered writing prompts are required.");
  return {
    questions,
    writing,
    copyParagraphs: [
      ...lines.slice(0, sections[0]),
      ...lines.slice(sections[1]),
    ],
    version: "1.0",
  };
}

export function privateBankHash(pack) {
  return createHash("sha256")
    .update(
      JSON.stringify({ questions: pack.questions, writing: pack.writing }),
    )
    .digest("hex");
}

// Returns a fingerprint only, never marking data. Its serialization matches
// privateBankHash so the imported server rows can be checked against the file.
export const assessmentBankFingerprintSql = `
with questions as (
  select string_agg('{"id":' || id::text || ',"prompt":' || to_json(prompt)::text ||
    ',"options":' || to_json(options)::text || ',"correct_option":' || correct_option::text || '}', ',' order by id) as body
  from cleaner_assessment_private.questions
), writing as (
  select string_agg('{"id":' || id::text || ',"prompt":' || to_json(prompt)::text || '}', ',' order by id) as body
  from cleaner_assessment_private.writing_prompts
)
select encode(sha256(convert_to('{"questions":[' || questions.body || '],"writing":[' || writing.body || ']}', 'UTF8')), 'hex') as bank_sha256
from questions cross join writing;
`;

const literal = (value) =>
  "E'" + value.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";
export function assessmentImportSql(pack, sourceSha256) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256))
    throw Error("Source fingerprint required.");
  // Input must come from the strict parser, not a browser or an unvalidated
  // JSON body. Deliberately keep this SQL out of the migration ledger/repo.
  const hash = privateBankHash(pack);
  return `begin;
do $guard$
begin
  if not exists(select 1 from vault.secrets where name = 'opulence_staging_recovery_secret')
    or exists(select 1 from vault.secrets where name = 'opulence_production_visit_payments_secret') then
    raise exception 'Staging database required.';
  end if;
  if exists(select 1 from cleaner_assessment_private.attempts where phase in
    ('questions','writing','writing_review','manager_review')) then
    raise exception 'Finish or resolve active assessments before replacing the pack.';
  end if;
end;
$guard$;
lock table cleaner_assessment_private.questions, cleaner_assessment_private.writing_prompts in access exclusive mode;
insert into cleaner_assessment_private.questions(id,prompt,options,correct_option)
select id,prompt,options,correct_option from jsonb_to_recordset(${literal(JSON.stringify(pack.questions))}::jsonb)
  as q(id smallint,prompt text,options text[],correct_option smallint)
on conflict(id) do update set prompt=excluded.prompt,options=excluded.options,correct_option=excluded.correct_option;
insert into cleaner_assessment_private.writing_prompts(id,prompt)
select id,prompt from jsonb_to_recordset(${literal(JSON.stringify(pack.writing))}::jsonb) as p(id smallint,prompt text)
on conflict(id) do update set prompt=excluded.prompt;
insert into cleaner_assessment_private.pack_imports(source_sha256,bank_sha256,source_document_id,pack_version)
values(${literal(sourceSha256)},${literal(hash)},${literal(ASSESSMENT_SOURCE_ID)},'1.0')
on conflict(source_sha256) do nothing;
do $verify$
begin
  if (select count(*) from cleaner_assessment_private.questions) <> 25
    or (select count(*) from cleaner_assessment_private.writing_prompts) <> 5 then
    raise exception 'Pack import was incomplete.';
  end if;
end;
$verify$;
commit;
`;
}
