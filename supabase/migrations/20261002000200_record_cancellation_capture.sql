-- Do not grant direct UPDATE on financial totals. Record a reduced capture
-- only against this booking's completed, durable Stripe money operation.
begin;
create or replace function public.system_record_cancellation_capture(
  p_payment_id uuid, p_operation_id uuid, p_split_breakdown jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_payment public.payments;
  v_operation public.money_operations;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  select * into v_operation from public.money_operations where id = p_operation_id for update;
  if not found or v_operation.status <> 'succeeded'
     or v_operation.operation_type <> 'capture'
     or v_operation.booking_id is distinct from v_payment.booking_id
     or v_operation.stripe_object_id is distinct from v_payment.stripe_payment_ref
     or v_operation.operation_key is distinct from
       ('capture:cancellation:' || v_payment.booking_id::text || ':' || round(v_operation.amount * 100)::bigint::text)
     or v_operation.amount <= 0 or v_operation.amount > v_payment.gross_amount
     or coalesce(v_payment.kind, 'booking') <> 'booking'
     or v_payment.status not in ('capturing', 'succeeded') then
    raise exception 'A confirmed cancellation capture for this payment is required';
  end if;
  if v_payment.gross_amount = v_operation.amount then
    return jsonb_build_object('changed', false, 'gross_amount', v_payment.gross_amount);
  end if;
  if jsonb_typeof(p_split_breakdown) is distinct from 'object'
     or p_split_breakdown->>'provider' is null
     or p_split_breakdown->>'platform_margin' is null
     or (p_split_breakdown->>'original_gross_amount')::numeric is distinct from v_payment.gross_amount
     or (p_split_breakdown->>'provider')::numeric < 0
     or (p_split_breakdown->>'platform_margin')::numeric < 0
     or coalesce((p_split_breakdown->>'provider')::numeric, -1)
       + coalesce((p_split_breakdown->>'platform_margin')::numeric, -1) <> v_operation.amount then
    raise exception 'Cancellation allocation must equal the confirmed captured amount';
  end if;
  update public.payments set gross_amount = v_operation.amount,
    split_breakdown = p_split_breakdown where id = p_payment_id;
  insert into public.payment_events(payment_id, from_status, to_status, actor_kind, reason, meta)
  values (p_payment_id, v_payment.status, v_payment.status, 'system',
    'Cancellation capture totals reconciled against confirmed Stripe operation',
    jsonb_build_object('operation_id', p_operation_id, 'stripe_payment_ref', v_operation.stripe_object_id,
      'original_gross_amount', v_payment.gross_amount, 'captured_amount', v_operation.amount));
  return jsonb_build_object('changed', true, 'gross_amount', v_operation.amount);
end $fn$;
revoke all on function public.system_record_cancellation_capture(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.system_record_cancellation_capture(uuid, uuid, jsonb) to service_role;
commit;
