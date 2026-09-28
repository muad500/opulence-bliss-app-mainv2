-- Keep the public FAQ list to the questions supplied by the client. The
-- insurance answer remains unpublished until active cover is confirmed.
begin;

delete from public.faqs
where lower(trim(question)) in (
  'can i send photos or files to my professional?',
  'can i arrange regular cleaning?',
  'are professionals vetted?'
);

update public.faqs
set answer = 'Yes. You can book a one-off service, or arrange regular cleaning on a weekly, fortnightly or monthly basis.',
    updated_at = now()
where lower(trim(question)) = 'can i book a one-off or recurring service?';

update public.faqs
set answer = 'Tasks can be agreed on before your appointment so we can focus on the areas that matter most to you.',
    updated_at = now()
where lower(trim(question)) = 'can i choose which cleaning tasks are prioritised?';

commit;
