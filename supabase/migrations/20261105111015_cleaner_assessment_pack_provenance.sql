begin;

-- Content is imported separately, privately, from the approved client source.
-- Neither bank text nor answers enter Git or the migration ledger.
create table cleaner_assessment_private.pack_imports (
  source_sha256 text primary key check (source_sha256 ~ '^[a-f0-9]{64}$'),
  bank_sha256 text not null check (bank_sha256 ~ '^[a-f0-9]{64}$'),
  source_document_id text not null,
  pack_version text not null,
  imported_at timestamptz not null default clock_timestamp(),
  imported_by text not null default current_user
);
alter table cleaner_assessment_private.pack_imports enable row level security;
alter table cleaner_assessment_private.questions enable row level security;
alter table cleaner_assessment_private.writing_prompts enable row level security;
revoke all on cleaner_assessment_private.pack_imports from public, anon, authenticated, service_role;

create function public.cleaner_assessment_pack_status()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('questions', (select count(*) from cleaner_assessment_private.questions),
    'writingPrompts', (select count(*) from cleaner_assessment_private.writing_prompts),
    'version', p.pack_version, 'sourceSha256', p.source_sha256, 'bankSha256', p.bank_sha256)
  from cleaner_assessment_private.pack_imports p order by p.imported_at desc limit 1;
$fn$;
revoke all on function public.cleaner_assessment_pack_status() from public, anon, authenticated, service_role;
grant execute on function public.cleaner_assessment_pack_status() to service_role;

alter function public.cleaner_assessment_start(text,text,boolean) set schema cleaner_assessment_private;
revoke all on function cleaner_assessment_private.cleaner_assessment_start(text,text,boolean)
  from public, anon, authenticated, service_role;
create function public.cleaner_assessment_start(p_invitation_hash text,p_session_hash text,p_rules_accepted boolean)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  if not exists(select 1 from cleaner_assessment_private.pack_imports where
    source_document_id = '1rqjzRHK8qiz8kmSOQ-2Xk6_VdFsOQI4c' and pack_version = '1.0'
    and source_sha256 = 'd9354835cf191d3ce88f41ee334bd275453cef3c2bf57f524f86ab38859868cb') then
    raise exception 'The approved assessment pack has not been imported.';
  end if;
  return cleaner_assessment_private.cleaner_assessment_start(p_invitation_hash,p_session_hash,p_rules_accepted);
end;
$fn$;
revoke all on function public.cleaner_assessment_start(text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.cleaner_assessment_start(text,text,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
