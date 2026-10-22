begin;

-- A customer may explicitly opt in from Settings before making a booking.
-- The friendly automatic prompt still waits for the first booking, and work
-- notifications still require professional approval. No device is enrolled here.
create or replace function public.web_push_enrolment()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with account as (
    select
      auth.uid() as user_id,
      auth.uid() is not null and public.account_is_active() as active
  )
  select jsonb_build_object(
    'eligible', account.active,
    'customerCanEnable', account.active,
    'professional', account.active and exists (
      select 1
      from public.providers
      where profile_id = account.user_id
        and vetting_status::text = 'approved'
        and not coalesce(is_suspended, false)
    ),
    'customerEligible', account.active and exists (
      select 1 from public.bookings where customer_id = account.user_id
    ),
    'hasConsent', exists (
      select 1
      from public.web_push_preferences
      where user_id = account.user_id
        and enabled
        and exists (
          select 1 from public.web_push_subscriptions
          where user_id = account.user_id
        )
    ),
    'promptAfter', (
      select prompt_after from public.web_push_preferences
      where user_id = account.user_id
    ),
    'optedOut', exists (
      select 1 from public.web_push_preferences
      where user_id = account.user_id and not enabled
    )
  )
  from account;
$$;

commit;
