-- STAGING ONLY: comwdjprdedmsnxtvuuk. Existing explicitly synthetic F1 fixtures.
-- Fully rolled back: no customer mail, financial operations or lasting check changes.
begin;
create temporary table chat_test_results (test text, passed boolean);
alter table chat_test_results enable row level security;
do $test$
declare
 provider public.providers; client uuid; booking uuid; pkg uuid;
 user_email text; delivered record; retry record; sent_id uuid; msg jsonb; n integer;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 select p.* into provider from public.providers p join public.profiles u on u.id=p.profile_id
 where u.full_name like '[TEST ONLY F1]%' order by p.id limit 1;
 select id into client from public.profiles where full_name='[TEST ONLY F1] customer' limit 1;
 if provider.id is null or client is null then raise exception 'Synthetic F1 fixtures required'; end if;
 update public.providers set is_suspended=false where id=provider.id;
 update public.service_areas set active=true where name like '[TEST ONLY F1]%';
 select id into pkg from public.packages where name='Essential Clean' limit 1;
 insert into public.bookings(customer_id,package_id,provider_id,scheduled_at,duration_minutes,status,address,household_notes,customer_email)
 values(client,pkg,provider.id,date_trunc('day',now()+interval '3 days')+interval '10 hours',120,'scheduled','[TEST ONLY] Fictional Place, ZE1 0AA','CHAT EMAIL ROLLBACK TEST',null)
 returning id into booking;
 insert into public.account_profile_details(user_id,notify_messages,contact_email) values(client,true,true)
 on conflict(user_id) do update set notify_messages=true,contact_email=true;
 select email into user_email from auth.users where id=client;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',provider.profile_id,'role','authenticated')::text,true);
 msg:=public.send_booking_message(booking,'Hello, staging message one.');
 if coalesce((msg->>'ok')::boolean,false) is not true then raise exception 'Message blocked'; end if;
 select count(*) into n from public.chat_message_emails where booking_id=booking;
 if n<>1 then raise exception 'Expected first unread email, got %',n; end if;
 perform public.send_booking_message(booking,'Hello, staging message two.');
 select count(*) into n from public.chat_message_emails where booking_id=booking;
 if n<>1 then raise exception 'Unread burst queued duplicate'; end if;
 insert into chat_test_results values('First unread message queues once; unread burst suppressed',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 select * into delivered from public.claim_chat_message_emails(2) where href='/account/visit/'||booking::text;
 if delivered.id is null or delivered.body<>'Hello, staging message one.' then raise exception 'Claim/body missing'; end if;
 sent_id:=delivered.id;
 select count(*) into n from public.claim_chat_message_emails(2) where href='/account/visit/'||booking::text;
 if n<>0 then raise exception 'Concurrent worker lease not exclusive'; end if;
 if not public.chat_message_email_allowed(delivered.id,delivered.claim_token,user_email)
   or public.chat_message_email_allowed(delivered.id,delivered.claim_token,'wrong@example.invalid') then raise exception 'Recipient validation failed'; end if;
 insert into chat_test_results values('Exact recipient, full text and exclusive delivery lease',true);
 perform public.finish_chat_message_email(delivered.id,delivered.claim_token,'retry');
 update public.chat_message_emails set next_attempt_at=now() where id=sent_id;
 select * into retry from public.claim_chat_message_emails(2) where href='/account/visit/'||booking::text;
 if retry.id<>sent_id or retry.claim_token=delivered.claim_token then raise exception 'Retry identity failed'; end if;
 perform public.finish_chat_message_email(retry.id,retry.claim_token,'sent');
 perform public.finish_chat_message_email(retry.id,retry.claim_token,'retry');
 if (select status from public.chat_message_emails where id=sent_id)<>'sent' then raise exception 'Duplicate finish changed delivery'; end if;
 insert into chat_test_results values('Failure retries same idempotency key; finish replay is inert',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',client,'role','authenticated')::text,true);
 perform public.mark_messages_read(booking);
 if exists(select 1 from public.notifications where user_id=client and href='/account/visit/'||booking::text and title like 'Message from %' and not read) then raise exception 'Chat read left unread notifications'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',provider.profile_id,'role','authenticated')::text,true);
 perform public.send_booking_message(booking,'Hello, cooldown message.');
 if (select count(*) from public.chat_message_emails where booking_id=booking)<>1 then raise exception '15 minute cap failed'; end if;
 insert into chat_test_results values('Reading clears notification; fresh message within 15 minutes suppressed',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',client,'role','authenticated')::text,true);
 perform public.mark_messages_read(booking);
 update public.chat_email_threads set next_email_at=now()-interval '1 second' where booking_id=booking;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',provider.profile_id,'role','authenticated')::text,true);
 perform public.send_booking_message(booking,'Hello, after cooldown.');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 select * into delivered from public.claim_chat_message_emails(2) where href='/account/visit/'||booking::text;
 if delivered.id is null then raise exception 'No new email after cooldown'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',client,'role','authenticated')::text,true);
 perform public.mark_messages_read(booking);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 if public.chat_message_email_allowed(delivered.id,delivered.claim_token,user_email) then raise exception 'Read message still deliverable'; end if;
 perform public.finish_chat_message_email(delivered.id,delivered.claim_token,'cancelled');
 insert into chat_test_results values('After cooldown new email permitted; reading before send cancels it',true);
 update public.account_profile_details set notify_messages=false where user_id=client;
 update public.chat_email_threads set next_email_at=now()-interval '1 second' where booking_id=booking;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',provider.profile_id,'role','authenticated')::text,true);
 perform public.send_booking_message(booking,'Hello, notifications off.');
 if exists(select 1 from public.chat_message_emails where booking_id=booking and status in('pending','processing')) then raise exception 'Preference ignored'; end if;
 insert into chat_test_results values('Notification opt-out suppresses chat email',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 update public.account_profile_details set notify_messages=true where user_id=client;
 -- Reverse direction: a customer message goes to the assigned professional only.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',client,'role','authenticated')::text,true);
 perform public.send_booking_message(booking,'Hello, message from customer.');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 select * into delivered from public.claim_chat_message_emails(2) where href='/worker/job/'||booking::text;
 if delivered.sender_role<>'customer' or delivered.email<>(select email from auth.users where id=provider.profile_id) then raise exception 'Professional direction failed'; end if;
 update public.bookings set status='cancelled' where id=booking;
 if public.chat_message_email_allowed(delivered.id,delivered.claim_token,delivered.email) then raise exception 'Cancelled booking leaked mail'; end if;
 insert into chat_test_results values('Customer-to-cleaner routing and closed booking suppression',true);
 if has_table_privilege('authenticated','public.chat_message_emails','SELECT')
   or has_function_privilege('authenticated','public.claim_chat_message_emails(integer)','EXECUTE') then raise exception 'Private queue exposed'; end if;
 insert into chat_test_results values('Private outbox inaccessible to browser accounts',true);
end $test$;
select * from chat_test_results;
rollback;
