begin;

-- A retry must pay the account quoted at booking, even if onboarding changes.
alter table public.handyman_jobs add column payout_account_id text;
update public.handyman_jobs j set payout_account_id=p.stripe_account_id
from public.providers p where p.id=j.provider_id;
alter table public.handyman_jobs alter column payout_account_id set not null;

create or replace function public.freeze_handyman_booking_terms()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
 if tg_op='INSERT' then
  select stripe_account_id into new.payout_account_id from public.providers where id=new.provider_id;
  if new.payout_account_id is null then raise exception 'Assigned payout account is required';end if;
 elsif new.provider_id is distinct from old.provider_id or new.customer_id is distinct from old.customer_id
  or new.hourly_rate_pence is distinct from old.hourly_rate_pence or new.vat_bps is distinct from old.vat_bps
  or new.payout_account_id is distinct from old.payout_account_id then
  raise exception 'Booked professional, rate, VAT and payout account cannot be changed';
 end if;
 return new;
end $fn$;
create trigger handyman_terms_snapshot before insert or update of provider_id,customer_id,hourly_rate_pence,vat_bps,payout_account_id
on public.handyman_jobs for each row execute function public.freeze_handyman_booking_terms();
revoke all on function public.freeze_handyman_booking_terms() from public,anon,authenticated,service_role;

create or replace function public.apply_handyman_trade(p_user uuid,p_details jsonb)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare pid uuid;item record;period jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 perform 1 from public.profiles where id=p_user for update;if not found then raise exception 'Account not found';end if;
 update public.profiles set full_name=p_details->>'legalName' where id=p_user;
 select id into pid from public.providers where profile_id=p_user;
 if pid is null then insert into public.providers(profile_id,display_name,services,vetting_status,show_on_our_pros) values(p_user,p_details->>'displayName',array['handyman'],'pending',false) returning id into pid;
 else update public.providers set services=(select array_agg(distinct skill) from unnest(services||array['handyman']) skill),vetting_status='pending' where id=pid;end if;
 update public.providers set display_name=p_details->>'displayName',bio=p_details->>'bio',years_experience=(p_details->>'yearsExperience')::integer where id=pid;
 insert into public.provider_onboarding_details(provider_id,resident_status,self_employed_confirmed,date_of_birth) values(pid,p_details->>'residentStatus',true,(p_details->>'dateOfBirth')::date) on conflict(provider_id) do update set resident_status=excluded.resident_status,date_of_birth=excluded.date_of_birth,self_employed_confirmed=true;
 insert into public.provider_profile_settings(provider_id,coverage_postcodes,max_travel_miles,max_daily_hours,accepts_same_day,brings_equipment,availability_configured) values(pid,array(select jsonb_array_elements_text(p_details->'coveragePostcodes')),(p_details->>'maxTravelMiles')::integer,(p_details->>'maxDailyHours')::integer,(p_details->>'acceptsSameDay')::boolean,(p_details->>'bringsEquipment')::boolean,true) on conflict(provider_id) do update set coverage_postcodes=excluded.coverage_postcodes,max_travel_miles=excluded.max_travel_miles,max_daily_hours=excluded.max_daily_hours,accepts_same_day=excluded.accepts_same_day,brings_equipment=excluded.brings_equipment,availability_configured=true;
 update public.provider_profile_settings set home_postcode=p_details->>'homePostcode' where provider_id=pid;
 delete from public.provider_task_rates where provider_id=pid;
 for item in select key,value from jsonb_each_text(p_details->'rates') loop insert into public.provider_task_rates(provider_id,task_name,hourly_rate_pence) values(pid,item.key,item.value::integer);end loop;
 delete from public.provider_availability where provider_id=pid;
 for period in select value from jsonb_array_elements(p_details->'availability') loop insert into public.provider_availability(provider_id,weekday,start_time,end_time) values(pid,(period->>'weekday')::integer,(period->>'start')::time,(period->>'end')::time);end loop;
 return pid;
end $fn$;
revoke all on function public.apply_handyman_trade(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_handyman_trade(uuid,jsonb) to service_role;
commit;
