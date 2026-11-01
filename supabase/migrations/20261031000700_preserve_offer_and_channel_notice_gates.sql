-- Extend the underlying series notice gate, preserving the later ranked-offer
-- and channel-preference wrappers around the public delivery check.
begin;
do $series_gate$
declare
  source text;
  marker text := '  elsif v_notice.kind = ''series_paused'' then';
begin
  source := replace(pg_get_functiondef(
    'public.visit_matching_notice_allowed_before_offer_waves(uuid,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  if strpos(source, marker) = 0 then
    raise exception 'Underlying notice gate changed. Review the adapter.';
  end if;
  source := replace(source, marker, $branch$
  elsif v_notice.kind = 'series_ended' then
    return v_series.ended_at is not null and v_series.billing_paused
      and v_notice.series_generation = v_series.pause_generation;
  elsif v_notice.kind = 'series_paused' then$branch$);
  execute source;
end;
$series_gate$;

create or replace function public.visit_matching_notice_allowed(p_id uuid,p_token uuid)
returns boolean
language sql stable security definer set search_path = public
as $fn$
  select public.visit_matching_notice_allowed_before_channels(p_id,p_token) and case
    when exists(select 1 from public.job_offer_emails where id = p_id) then exists (
      select 1 from public.job_offer_emails email
      join public.providers provider on provider.id = email.provider_id
      where email.id = p_id and public.notification_channel_allowed(
        provider.profile_id, 'professional', 'offers', 'email'
      )
    ) else exists (
      select 1 from public.visit_matching_notices notice
      where notice.id = p_id and (
        notice.kind = 'admin_48h' or public.notification_channel_allowed(
          notice.user_id, 'customer', public.notification_category(notice.title,notice.href),
          notice.channel, null,
          notice.kind = 'series_ended' or public.notification_essential_email(notice.title)
        )
      )
    )
  end;
$fn$;
revoke all on function public.visit_matching_notice_allowed(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.visit_matching_notice_allowed(uuid,uuid) to service_role;
commit;
