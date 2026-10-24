-- STAGING comwdjprdedmsnxtvuuk ONLY. Run after migration 20261023000200.
-- Uses an existing synthetic customer, never a real account. All QA writes roll
-- back. No booking, payment, email or permanent acceptance is created.
begin;
do $smoke$
declare test_user uuid; docs jsonb; snapshots jsonb; proof jsonb; consent uuid; message text;
begin
 select p.id into test_user from public.profiles p join auth.users u on u.id=p.id
 where p.role::text='customer' and p.account_deleted_at is null and lower(u.email) like '%@example.invalid' order by p.id limit 1;
 if test_user is null then raise exception 'No synthetic customer fixture is available'; end if;
 if has_function_privilege('anon','public.prepare_booking_legal_consent_v2(uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.prepare_booking_legal_consent_v2(uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE') then raise exception 'Consent writer is exposed'; end if;
 select jsonb_agg(jsonb_build_object('slug',slug,'version',version,'updatedAt',updated_at,'isFallback',false) order by slug),
 jsonb_agg(jsonb_build_object('slug',slug,'title',title,'version',version,'updatedAt',updated_at,'isFallback',false,'sourceContentHtml',content_html,'contentHtml',content_html,'contentHash',md5(content_html),'displayContentHash',md5(content_html)) order by slug)
 into docs,snapshots from public.legal_documents where published and slug in('terms','privacy','cancellation-refund') and nullif(content_html,'') is not null;
 if jsonb_array_length(docs)<>3 then raise exception 'Published test documents are incomplete'; end if;
 proof:=jsonb_build_object('schemaVersion',1,'request',jsonb_build_object('ip','203.0.113.10','userAgent','STAGING ROLLBACK QA ONLY'),'account',jsonb_build_object('email','spoof@example.invalid'),'checkboxes',jsonb_build_array(jsonb_build_object('key','booking_policies','text','STAGING QA ONLY: synthetic acceptance, transaction is rolled back.','checked',true)));
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 consent:=public.prepare_booking_legal_consent_v2(test_user,docs,'[]'::jsonb,snapshots,proof);
 if not exists(select 1 from public.booking_checkout_legal_consents c join auth.users u on u.id=test_user where c.id=consent and c.evidence->'account'->>'email'=u.email and c.evidence->'account'->>'userId'=test_user::text and jsonb_array_length(c.documents)=3) then raise exception 'Authoritative identity or snapshot was not saved'; end if;
 begin
  update public.booking_checkout_legal_consents set evidence='{}'::jsonb where id=consent;
  raise exception 'Saved evidence was writable';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.prepare_booking_legal_consent_v2(test_user,jsonb_set(docs,'{0,version}','"outdated"'::jsonb),'[]'::jsonb,snapshots,proof);
  raise exception 'Stale version was accepted';
 exception when serialization_failure then null;
 end;
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 begin
  perform public.prepare_booking_legal_consent_v2(test_user,docs,'[]'::jsonb,snapshots,proof);
  raise exception 'Anonymous write was accepted';
 exception when raise_exception then
  get stacked diagnostics message=MESSAGE_TEXT;
  if message<>'Service role required' then raise; end if;
 end;
 begin
  perform public.booking_legal_contract('11111111-1111-4111-8111-111111111111');
  raise exception 'Anonymous contract access was accepted';
 exception when insufficient_privilege then null;
 end;
end $smoke$;
rollback;
select 'passed: published snapshots, database identity, immutability, stale-version rejection, anonymous writer/reader denial' as staging_legal_smoke, 'all QA writes rolled back; no booking, payment or email created' as safety;
