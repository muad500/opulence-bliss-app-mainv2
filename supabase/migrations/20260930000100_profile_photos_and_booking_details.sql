begin;

alter table public.account_profile_details add column if not exists photo_storage_path text;
alter table public.provider_profile_settings add column if not exists photo_storage_path text;
alter table public.booking_checkout_time_choices add column if not exists household_notes text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',false,4194304,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- All reads and uploads pass through the account routes. A worker's photo is
-- deliberately exposed by its public route only while the profile is eligible.
create or replace function public.replace_account_photo(p_user_id uuid,p_professional boolean,p_path text,p_url text)
returns text language plpgsql security definer set search_path=public as $fn$
declare v_previous text; v_provider uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  perform 1 from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Account not found'; end if;
  if p_path is not null and (not starts_with(p_path,p_user_id::text || '/' || case when p_professional then 'professional/' else 'client/' end)
    or not exists(select 1 from storage.objects where bucket_id='profile-photos' and name=p_path)) then
    raise exception 'Photo not found';
  end if;
  if p_professional then
    select id into v_provider from public.providers where profile_id=p_user_id for update;
    if v_provider is null then raise exception 'Professional not found'; end if;
    select photo_storage_path into v_previous from public.provider_profile_settings where provider_id=v_provider;
    insert into public.provider_profile_settings(provider_id,photo_storage_path,updated_at) values(v_provider,p_path,now())
      on conflict(provider_id) do update set photo_storage_path=excluded.photo_storage_path,updated_at=excluded.updated_at;
    update public.providers set photo_url=p_url where id=v_provider;
  else
    select photo_storage_path into v_previous from public.account_profile_details where user_id=p_user_id;
    insert into public.account_profile_details(user_id,photo_storage_path,photo_url,updated_at) values(p_user_id,p_path,null,now())
      on conflict(user_id) do update set photo_storage_path=excluded.photo_storage_path,photo_url=null,updated_at=excluded.updated_at;
  end if;
  return v_previous;
end $fn$;
revoke all on function public.replace_account_photo(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.replace_account_photo(uuid,boolean,text,text) to service_role;

commit;
