begin;
alter table public.provider_verification_items add column if not exists gov_uk_checked_on date;
comment on column public.provider_verification_items.gov_uk_checked_on is 'Date the administrator completed the GOV.UK right-to-work check; never self-certified.';

create or replace function public.submit_rtw_share_code(p_provider_id uuid,p_code text)
returns text language plpgsql security definer set search_path=public as $fn$
declare previous text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if p_code is null or p_code!~'^[A-Z0-9]{9}$' then raise exception 'Invalid share code'; end if;
 perform 1 from public.providers where id=p_provider_id for update;
 if not found then raise exception 'Professional not found'; end if;
 select document_storage_path into previous from public.provider_verification_items where provider_id=p_provider_id and document_type='right_to_work' for update;
 insert into public.provider_verification_items(provider_id,document_type,label,status,reference,uploaded_at,document_original_name)
 values(p_provider_id,'right_to_work','Right to work','pending',p_code,clock_timestamp(),'Share code for GOV.UK check')
 on conflict(provider_id,document_type) do update set status='pending',reference=p_code,uploaded_at=excluded.uploaded_at,document_storage_path=null,document_original_name=excluded.document_original_name,checked_at=null,gov_uk_checked_on=null,expires_at=null,next_check_at=null,reviewed_by=null,review_note=null,updated_at=clock_timestamp();
 return previous;
end $fn$;
revoke all on function public.submit_rtw_share_code(uuid,text) from public,anon,authenticated;
grant execute on function public.submit_rtw_share_code(uuid,text) to service_role;

create or replace function public.enforce_core_provider_documents_before_approval()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare needs_check boolean:=tg_op='INSERT';
begin
 if tg_op='UPDATE' then needs_check:=old.vetting_status is distinct from 'approved'; end if;
 if new.vetting_status='approved' and needs_check and exists(
  select 1 from(values('right_to_work'),('photo_id')) required(type)
  where not exists(select 1 from public.provider_verification_items v where v.provider_id=new.id and v.document_type=required.type
   and v.status='verified' and v.uploaded_at is not null
   and(v.expires_at is null or v.expires_at>=current_date) and(v.next_check_at is null or v.next_check_at>=current_date)
   and(required.type<>'right_to_work' or(v.gov_uk_checked_on is not null and v.gov_uk_checked_on<=current_date))
   and((required.type='right_to_work' and v.reference~'^[A-Z0-9]{9}$') or exists(select 1 from storage.objects o where o.bucket_id='provider-verification' and o.name=v.document_storage_path))
  )
 ) then raise exception 'Current right-to-work and photo ID checks must be verified before approval'; end if;
 return new;
end $fn$;
revoke all on function public.enforce_core_provider_documents_before_approval() from public,anon,authenticated;

create or replace function public.professional_verification_block(p_provider_id uuid,p_today date default current_date)
returns text language plpgsql stable security definer set search_path=public as $fn$
declare dbs public.provider_dbs_checks; rtw public.provider_verification_items;
begin
 select * into dbs from public.provider_dbs_checks where provider_id=p_provider_id;
 if not found or dbs.status<>'verified' then return 'Your DBS check needs verification before new job offers.'; end if;
 if (dbs.issue_date+interval '1 year')::date<p_today then return 'Your annual DBS re-check is overdue. New job offers are paused.'; end if;
 select * into rtw from public.provider_verification_items where provider_id=p_provider_id and document_type='right_to_work';
 if not found or rtw.status<>'verified' or rtw.gov_uk_checked_on is null or rtw.uploaded_at is null or (rtw.document_storage_path is null and coalesce(rtw.reference,'')!~'^[A-Z0-9]{9}$') then return 'Your right-to-work check needs administrator verification before new job offers.'; end if;
 if rtw.gov_uk_checked_on>p_today or (rtw.expires_at is not null and rtw.expires_at<p_today) or (rtw.next_check_at is not null and rtw.next_check_at<p_today) then return 'Your right-to-work check has expired. New job offers are paused.'; end if;
 return null;
end $fn$;
revoke all on function public.professional_verification_block(uuid,date) from public,anon,authenticated;
grant execute on function public.professional_verification_block(uuid,date) to service_role;

create or replace function public.public_eligible_provider_ids()
returns table(id uuid) language sql stable security definer set search_path=public as $fn$
 select p.id from public.providers p where p.vetting_status='approved' and p.dbs_verified and not p.is_suspended and p.show_on_our_pros
 and public.professional_verification_block(p.id) is null
 and not exists(select 1 from public.provider_verification_items v where v.provider_id=p.id and v.document_type='photo_id' and(v.status<>'verified' or(v.expires_at is not null and v.expires_at<current_date) or(v.next_check_at is not null and v.next_check_at<current_date)));
$fn$;
revoke all on function public.public_eligible_provider_ids() from public,service_role;
grant execute on function public.public_eligible_provider_ids() to anon,authenticated;

create or replace function public.guard_current_professional_verification()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare reason text;
begin
 reason:=public.professional_verification_block(new.provider_id);
 if reason is not null then
   if tg_table_name='bookings' then raise exception '%',reason using errcode='check_violation'; end if;
   return null;
 end if;
 return new;
end $fn$;
create trigger current_verification_offer_queue before insert on public.booking_offer_queue for each row execute function public.guard_current_professional_verification();
create trigger current_verification_booking_offers before insert on public.booking_offers for each row execute function public.guard_current_professional_verification();
-- A separate insert guard and a change guard leave existing scheduled work
-- intact while protecting new assignments and reschedules.
create trigger current_verification_booking_insert before insert on public.bookings for each row when(new.provider_id is not null) execute function public.guard_current_professional_verification();
create trigger current_verification_booking_assignment before update of provider_id,scheduled_at,status on public.bookings for each row
when(new.provider_id is not null and new.status::text='scheduled' and(old.status::text='offered' or new.provider_id is distinct from old.provider_id or new.scheduled_at is distinct from old.scheduled_at)) execute function public.guard_current_professional_verification();
revoke all on function public.guard_current_professional_verification() from public,anon,authenticated;

create or replace function public.validate_renewed_verification()
returns trigger language plpgsql set search_path=public as $fn$
begin
 if tg_table_name='provider_dbs_checks' then
   if new.status='verified' and (new.issue_date+interval '1 year')::date<current_date then raise exception 'Upload a DBS certificate issued within the last twelve months'; end if;
 else
   if new.document_type='right_to_work' and new.status='verified' and (new.gov_uk_checked_on is null or new.gov_uk_checked_on>current_date) then raise exception 'Record the completed GOV.UK check date'; end if;
 end if;
 return new;
end $fn$;
create trigger validate_renewed_dbs before insert or update of status,issue_date on public.provider_dbs_checks for each row execute function public.validate_renewed_verification();
create trigger validate_renewed_right_to_work before insert or update of status,gov_uk_checked_on,expires_at on public.provider_verification_items for each row execute function public.validate_renewed_verification();
revoke all on function public.validate_renewed_verification() from public,anon,authenticated;

create table public.verification_renewal_reminders(
 provider_id uuid not null references public.providers(id) on delete cascade,
 check_type text not null check(check_type in('dbs','right_to_work')),
 due_date date not null,
 phase text not null check(phase in('due_soon','expired')),
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 sent_at timestamptz not null default now(),
 primary key(provider_id,check_type,due_date,phase,recipient_id)
);
alter table public.verification_renewal_reminders enable row level security;
revoke all on public.verification_renewal_reminders from public,anon,authenticated;
grant all on public.verification_renewal_reminders to service_role;

create or replace function public.process_verification_renewals()
returns integer language plpgsql security definer set search_path=public as $fn$
declare item record; recipient record; due_phase text; inserted integer; total integer:=0;
begin
 for item in
  select p.id,p.profile_id,'dbs'::text as type,(d.issue_date+interval '1 year')::date as due
  from public.providers p join public.provider_dbs_checks d on d.provider_id=p.id where d.status='verified'
  union all
  select p.id,p.profile_id,'right_to_work',least(v.expires_at,v.next_check_at)
  from public.providers p join public.provider_verification_items v on v.provider_id=p.id where v.document_type='right_to_work' and v.status='verified' and(v.expires_at is not null or v.next_check_at is not null)
 loop
  if item.due>current_date+30 then continue; end if;
  due_phase:=case when item.due<current_date then 'expired' else 'due_soon' end;
  if item.type='dbs' and due_phase='expired' then update public.providers set dbs_verified=false where id=item.id and dbs_verified; end if;
  for recipient in select id,role::text as role from public.profiles where id=item.profile_id or role::text='admin' loop
   insert into public.verification_renewal_reminders(provider_id,check_type,due_date,phase,recipient_id) values(item.id,item.type,item.due,due_phase,recipient.id) on conflict do nothing;
   get diagnostics inserted=row_count;
   if inserted=1 then
    insert into public.notifications(user_id,title,body,href) values(recipient.id,
      case when item.type='dbs' then 'Annual DBS re-check' else 'Right-to-work re-check' end,
      case when due_phase='expired' then 'New job offers are paused until updated evidence is verified.' else 'A verification re-check is due on '||item.due::text||'. Please arrange updated evidence before it expires.' end,
      case when recipient.role='admin' then '/admin/cleaners/'||item.id::text else '/worker/profile#verification' end);
    total:=total+1;
   end if;
  end loop;
 end loop;
 return total;
end $fn$;
revoke all on function public.process_verification_renewals() from public,anon,authenticated;
grant execute on function public.process_verification_renewals() to service_role;
select cron.schedule('opulence-verification-renewals','0 7 * * *',$$select public.process_verification_renewals();$$);
commit;
