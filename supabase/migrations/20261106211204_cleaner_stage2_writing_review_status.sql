begin;

-- Expose only which review screen to show, never marks or private reasons.
create or replace function cleaner_assessment_private.snapshot(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  a cleaner_assessment_private.attempts;
  i cleaner_assessment_private.invitations;
  q cleaner_assessment_private.attempt_questions;
  choices jsonb;
begin
  select * into strict a from cleaner_assessment_private.attempts where id = p_attempt;
  select * into strict i from cleaner_assessment_private.invitations where id = a.invitation_id;
  if a.phase = 'questions' then
    select * into strict q from cleaner_assessment_private.attempt_questions
      where attempt_id = a.id and position = a.position;
    select jsonb_agg(jsonb_build_object('id', q.option_tokens[n],
      'text', q.options[q.option_order[n]]) order by n)
      into choices from generate_series(1, 3) n;
    return jsonb_build_object('attemptId', a.id, 'phase', a.phase,
      'position', a.position, 'questionCount', 15, 'prompt', q.prompt,
      'choices', choices, 'deadline', q.opened_at + make_interval(secs => 10 * a.adjustment),
      'serverTime', clock_timestamp());
  end if;
  return jsonb_build_object('attemptId', a.id, 'phase', a.phase,
    'serverTime', clock_timestamp(), 'reviewStage',
    case when a.writing_prompt_id is not null then 'writing' else 'assessment' end)
    || case when a.phase = 'writing' then jsonb_build_object('prompt', (
      select prompt from cleaner_assessment_private.writing_prompts where id = a.writing_prompt_id),
      'deadline', a.writing_started_at + make_interval(secs => 300 * a.adjustment),
      'writing', a.writing_text)
    else '{}'::jsonb end;
end;
$fn$;

notify pgrst, 'reload schema';
commit;
