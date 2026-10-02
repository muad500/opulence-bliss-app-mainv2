-- Staging integration checks. Every fixture and mutation is rolled back.
begin;
do $test$
declare
 customer uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); professional uuid:=gen_random_uuid();
 first_address uuid; second_address uuid; foreign_address uuid; request_id uuid; booking_id uuid; package_id uuid;
 before_count integer; quote_id uuid; photo_path text; doc_path text; dbs_path text; result jsonb; caught boolean; item record;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 insert into auth.users(id,email,raw_user_meta_data) values(customer,customer::text||'@fixture.invalid','{}'),(other_user,other_user::text||'@fixture.invalid','{}');
 insert into public.profiles(id,role,full_name,email) values(customer,'customer','Synthetic account',customer::text||'@fixture.invalid'),(other_user,'customer','Synthetic other',other_user::text||'@fixture.invalid')
 on conflict(id) do update set full_name=excluded.full_name;
 insert into public.providers(id,profile_id,services,vetting_status) values(professional,customer,array['cleaning'],'pending');
 for item in select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('account_profile_details','customer_addresses','provider_profile_settings','account_erasure_jobs') loop
   if not item.relrowsecurity or has_table_privilege('anon','public.'||item.relname,'SELECT') or has_table_privilege('authenticated','public.'||item.relname,'SELECT') then raise exception 'Private table access failed: %',item.relname; end if;
 end loop;
 if has_function_privilege('authenticated','public.prepare_account_erasure(uuid,text)','EXECUTE') or has_function_privilege('anon','public.replace_account_photo(uuid,boolean,text,text)','EXECUTE') then raise exception 'Private RPC exposed'; end if;
 insert into public.customer_addresses(user_id,line1,city,postcode,is_default) values(customer,'1 Fixture Street','London','SW3 1AA',true) returning id into first_address;
 insert into public.customer_addresses(user_id,line1,city,postcode) values(customer,'2 Fixture Street','London','SW3 1AA') returning id into second_address;
 insert into public.customer_addresses(user_id,line1,city,postcode) values(other_user,'3 Fixture Street','London','SW3 1AA') returning id into foreign_address;
 perform public.set_default_customer_address(customer,second_address);
 if not exists(select 1 from public.customer_addresses where id=second_address and is_default) or exists(select 1 from public.customer_addresses where id=first_address and is_default) then raise exception 'Default address not switched'; end if;
 caught:=false;
 begin perform public.set_default_customer_address(customer,foreign_address); exception when no_data_found then caught:=true; end;
 if not caught then raise exception 'Foreign address accepted'; end if;
 insert into public.account_profile_details(user_id,notify_messages,notify_bookings) values(customer,false,false);
 select count(*) into before_count from public.notifications where user_id=customer;
 insert into public.notifications(user_id,title,body,href) values(customer,'Message from your professional','Synthetic','/account/visits/fixture');
 insert into public.notifications(user_id,title,body,href) values(customer,'Your booking is in 24 hours','Synthetic','/account/visits/fixture');
 if (select count(*) from public.notifications where user_id=customer)<>before_count then raise exception 'Notification opt-out ignored'; end if;
 insert into public.notifications(user_id,title,body,href) values(customer,'Booking confirmed','Synthetic','/account/visits/fixture');
 if (select count(*) from public.notifications where user_id=customer)<>before_count+1 then raise exception 'Essential confirmation suppressed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',customer)::text,true);
 perform public.save_my_professional_availability('[]');
 if not exists(select 1 from public.provider_profile_settings where provider_id=professional and availability_configured) or exists(select 1 from public.provider_availability where provider_id=professional) then raise exception 'Empty published hours ignored'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 photo_path:=customer::text||'/client/synthetic.webp';
 doc_path:=professional::text||'/right_to_work/synthetic.pdf';
 dbs_path:=professional::text||'/dbs/synthetic.pdf';
 insert into storage.objects(bucket_id,name) values('profile-photos',photo_path),('provider-verification',doc_path),('provider-dbs',dbs_path);
 perform public.replace_account_photo(customer,false,photo_path,null);
 if not exists(select 1 from public.account_profile_details where user_id=customer and photo_storage_path=photo_path) then raise exception 'Photo was not stored'; end if;
 perform public.replace_provider_verification_document(professional,'right_to_work','Right to work',doc_path,'Synthetic.pdf','application/pdf',current_date,null,'SYNTH1234');
 if not exists(select 1 from public.provider_verification_items where provider_id=professional and document_type='right_to_work' and reference='SYNTH1234' and status='pending') then raise exception 'Share code not saved pending review'; end if;
 perform public.replace_provider_dbs_certificate(professional,'123456789012',current_date,dbs_path,'Synthetic.pdf','application/pdf');
 if not exists(select 1 from public.provider_dbs_checks where provider_id=professional and status='pending') then raise exception 'DBS upload was not pending'; end if;
 update public.provider_dbs_checks set status='verified',reviewed_at=now()-interval '1 year'+interval '20 days' where provider_id=professional;
 perform public.remind_professional_document_checks();
 perform public.remind_professional_document_checks();
 if (select count(*) from public.notifications where user_id=customer and title='Annual DBS re-check due')<>1 then raise exception 'DBS annual reminder missing or duplicated'; end if;
 insert into public.account_incidents(reporter_id,category,description) values(customer,'account','Synthetic account problem for rollback test only');
 if has_table_privilege('authenticated','public.account_incidents','SELECT') or has_table_privilege('anon','public.account_incidents','SELECT') then raise exception 'Private incident reports exposed'; end if;
 insert into public.handyman_quote_requests(customer_id,full_name,email,phone,address,postcode,task_type,description,preferred_provider_id,quoted_hourly_rate_pence,estimated_hours,estimate_total_pence)
 values(customer,'Synthetic customer',customer::text||'@fixture.invalid','+447700900123','Fixture address','SW3 1AA','Furniture assembly','Synthetic quote for rollback only',professional,2900,2.5,7250) returning id into quote_id;
 caught:=false;
 begin update public.handyman_quote_requests set estimate_total_pence=1 where id=quote_id; exception when check_violation then caught:=true; end;
 if not caught then raise exception 'Inconsistent quote estimate accepted'; end if;
 select id into package_id from public.packages limit 1;
 if package_id is null then insert into public.packages(name,price,service_type,duration_minutes,active) values('Synthetic fixture clean',19,'cleaning',120,false) returning id into package_id; end if;
 insert into public.account_deletion_requests(user_id,status) values(customer,'in_review') returning id into request_id;
 begin
 insert into public.bookings(customer_id,package_id,scheduled_at,status,address) values(customer,package_id,((current_date+10)+time '09:00') at time zone 'Europe/London','offered','SW3 1AA') returning id into booking_id;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',customer)::text,true);
 if public.account_booking_actor(booking_id,true)<>'customer' then raise exception 'Dual-role customer is not recognized'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 caught:=false;
 begin perform public.prepare_account_erasure(request_id,'Synthetic retention reason only'); exception when others then
   if sqlerrm not like 'Resolve all unfinished bookings%' then raise; end if; caught:=true;
 end;
 if not caught or exists(select 1 from public.account_erasure_jobs where user_id=customer) then raise exception 'Unsafe erasure was allowed'; end if;
 -- Undo this entire booking subtransaction, including immutable event rows.
 raise exception '__ROLLBACK_ONLY_BOOKING__';
 exception when raise_exception then if sqlerrm<>'__ROLLBACK_ONLY_BOOKING__' then raise; end if; end;
 result:=public.prepare_account_erasure(request_id,'Synthetic retention reason only');
 if result->>'userId'<>customer::text or not exists(select 1 from public.profiles where id=customer and account_deleted_at is not null and full_name='Deleted account')
 or exists(select 1 from public.customer_addresses where user_id=customer) or exists(select 1 from public.provider_profile_settings where provider_id=professional) then raise exception 'Account anonymization failed'; end if;
 if not exists(select 1 from public.customer_addresses where id=foreign_address) then raise exception 'Another account was changed'; end if;
 if public.prepare_account_erasure(request_id,'Synthetic retention reason only')<>result then raise exception 'Erasure retry was not idempotent'; end if;
 if jsonb_array_length(result->'files')<>3 then raise exception 'Private storage cleanup manifest incomplete'; end if;
 caught:=false;
 begin perform public.review_account_deletion_request(request_id,'declined','Synthetic decline reason'); exception when others then
 if sqlerrm not like 'Erasure has started%' then raise; end if; caught:=true; end;
 if not caught then raise exception 'Partially erased account could be declined'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',customer)::text,true);
 if public.account_is_active() then raise exception 'Erased account stays active'; end if;
 caught:=false;
 begin insert into public.notifications(user_id,title,body,href) values(customer,'Synthetic stale token','Synthetic','/account'); exception when insufficient_privilege then caught:=true; end;
 if not caught then raise exception 'Stale JWT mutation accepted'; end if;
end $test$;
rollback;
select 'PASS: private access, default-address ownership, notification choices, dual roles, published hours, erasure guards, private documents and photos, DBS reminder, reports, quote snapshot, retry and stale-token rejection; fixtures rolled back' as result;
