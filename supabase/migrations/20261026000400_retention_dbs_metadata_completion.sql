-- Keep the existing non-null certificate metadata schema while clearing personal filenames.
begin;
create or replace function public.apply_retention_candidate(p_category text,p_entity text,p_scope jsonb)
returns void language plpgsql security definer set search_path=public as $fn$
declare person uuid; stamp timestamptz;
begin
  if not public.retention_delete_authorised() then raise exception 'Retention transaction required'; end if;
  if public.retention_has_hold(p_scope) then raise exception 'Record is protected'; end if;
  case p_category
    when 'emergency_contacts' then
      update public.provider_profile_settings set emergency_contact_name=null,emergency_contact_phone=null
        where provider_id=p_entity::uuid;
    when 'dbs_outcomes' then
      delete from public.provider_dbs_checks where provider_id=p_entity::uuid;
      update public.providers set dbs_verified=false where id=p_entity::uuid;
    when 'dbs_copies' then
      update public.provider_dbs_checks set certificate_storage_path=null,certificate_original_name='Deleted certificate',
        certificate_deleted_at=now()
        where certificate_storage_path in(select value->>'path' from public.data_retention_file_tasks t cross join lateral jsonb_array_elements(t.files) value
          where t.category=p_category and t.entity_id=p_entity);
    when 'check_ins' then
      perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table',
        case p_scope->>'type' when 'challenge' then 'public.check_in_challenges'
          when 'challenge_event' then 'public.check_in_challenge_events' else 'public.check_ins' end,
        'key',jsonb_build_object('id',p_entity::uuid))));
    when 'messages' then
      perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table','public.booking_messages','key',jsonb_build_object('id',p_entity::bigint))));
    when 'job_photos' then
      if p_scope->>'type'='chat' then delete from public.booking_message_attachments where message_id=p_entity::bigint;
      else delete from public.handyman_files where id=p_entity::uuid; end if;
    when 'unsuccessful_applicants' then
      -- Shared customer login, saved cards and customer bookings are unaffected.
      delete from public.provider_verification_items where provider_id=p_entity::uuid;
      delete from public.provider_dbs_checks where provider_id=p_entity::uuid;
      delete from public.provider_onboarding_details where provider_id=p_entity::uuid;
      delete from public.provider_profile_settings where provider_id=p_entity::uuid;
      delete from public.provider_availability where provider_id=p_entity::uuid;
      delete from public.provider_time_off where provider_id=p_entity::uuid;
      delete from public.provider_task_rates where provider_id=p_entity::uuid;
      update public.providers set bio=null,photo_url=null,display_name='Expired application',insurance_ref=null,cert_ref=null,show_on_our_pros=false
        where id=p_entity::uuid;
    when 'enquiries' then delete from public.handyman_quote_requests where id=p_entity::uuid;
    when 'incidents' then
      perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table',
        case p_scope->>'type' when 'incident' then 'public.account_incidents'
          when 'hold' then 'public.data_retention_holds' when 'dispute' then 'public.handyman_disputes' else 'public.review_cases' end,
        'key',jsonb_build_object('id',p_entity::uuid))));
    when 'business_records' then
      if p_scope->>'type'='quote_contract' then
        perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table','public.handyman_quote_requests','key',jsonb_build_object('id',p_entity::uuid))));
      elsif p_scope->>'type'='closed_account' then
        perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table','public.profiles','key',jsonb_build_object('id',p_entity::uuid))));
      else perform public.retention_delete_business(p_entity::uuid,p_scope ? 'handyman'); end if;
    when 'access_instructions' then
      select customer_id,public.retention_contract_end(id) into person,stamp from public.bookings where id=p_entity::uuid;
      update public.bookings set access_instructions=null,household_notes=null where id=p_entity::uuid;
      -- Do not erase an address's newly entered instructions or instructions
      -- still needed by another active booking/series.
      if not exists(select 1 from public.bookings where customer_id=person and status::text not in('completed','cancelled')) then
        update public.customer_addresses set access_instructions=null where user_id=person and updated_at<=stamp;
      end if;
      update public.booking_checkout_time_choices c set household_notes=null,
        booking_preferences=case jsonb_typeof(c.booking_preferences)
          when 'array' then coalesce((select jsonb_agg(value-'accessInstructions') from jsonb_array_elements(c.booking_preferences)),'[]'::jsonb)
          else c.booking_preferences-'accessInstructions' end,
        cleaning_extras=coalesce((select jsonb_agg(value-'notes')
          from jsonb_array_elements(c.cleaning_extras)),'[]'::jsonb)
        where c.customer_id=person and c.checkout_session_id=(select coalesce(s.checkout_session_id,b.checkout_session_id)
          from public.bookings b left join public.regular_booking_series s on s.id=b.regular_series_id where b.id=p_entity::uuid);
    else raise exception 'Unknown retention category';
  end case;
end;
$fn$;

commit;
