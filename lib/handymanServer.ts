import 'server-only';
import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accountContext, accountError, isAccountError } from '@/lib/accountApi';
import { handymanEnabled } from '@/lib/handymanMarketplace';
import { getOrCreateBillingCustomer } from '@/lib/accountBilling';
export async function handymanContext(request: NextRequest, mutation = false) {
  if (!handymanEnabled()) return accountError('Not found.', 404);
  return accountContext(request, { mutation });
}
export const handymanStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!);
export type HandymanJob = {
  id: string;
  customer_id: string;
  provider_id: string;
  payout_account_id: string;
  task_name: string;
  description: string;
  address: string;
  postcode: string;
  scheduled_at: string;
  estimated_minutes: number;
  hourly_rate_pence: number;
  vat_bps: number;
  materials_budget_pence: number;
  held_pence: number;
  status: string;
  checkout_session: string | null;
  payment_intent: string | null;
  previous_payment_intent: string | null;
  transfer_ref: string | null;
  started_at: string | null;
  ended_at: string | null;
  worked_minutes: number | null;
  bill: {
    gross: number;
    provider: number;
    platform: number;
    labour: number;
    vat: number;
    materials: number;
    billedMinutes: number;
  } | null;
  approved_at: string | null;
};
export async function privateHandymanJob(
  admin: SupabaseClient,
  id: string,
  user: string,
  provider: string | null
) {
  const { data, error } = await admin
    .from('handyman_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (
    error ||
    !data ||
    (data.customer_id !== user && data.provider_id !== provider)
  )
    return null;
  return data as HandymanJob;
}

type HandymanAttempt = {
  id: string;
  job_id: string;
  revision: 'initial' | 'final';
  amount_pence: number;
  parameters: Stripe.Checkout.SessionCreateParams | null;
  session_id: string | null;
  payment_intent: string | null;
  status: string;
  legacy: boolean;
};
export class HandymanAuthorisationRequired extends Error {}

function validateHandymanIntent(pi: Stripe.PaymentIntent, j: HandymanJob) {
  if (
    pi.metadata.job_id !== j.id ||
    pi.metadata.customer_id !== j.customer_id ||
    pi.metadata.kind !== 'handyman' ||
    pi.capture_method !== 'manual' ||
    pi.transfer_data?.destination ||
    pi.application_fee_amount ||
    pi.currency !== 'gbp'
  ) throw new Error('Payment does not match the job.');
}

async function loadHandymanJob(admin: SupabaseClient, id: string) {
  const { data, error } = await admin.from('handyman_jobs')
    .select('*').eq('id', id).single();
  if (error || !data) throw new Error('Job could not be loaded.');
  return data as HandymanJob;
}

/** An ambiguous database response must NOT cause a cancellation. */
async function checkedRpc<T>(
  admin: SupabaseClient, name: string, parameters: Record<string, unknown>
): Promise<T> {
  const { data, error } = await admin.rpc(name, parameters);
  if (error) throw new Error('Payment record needs a retry: ' + name);
  return data as T;
}

async function findAttemptSession(stripe: Stripe, a: HandymanAttempt) {
  if (a.session_id) return stripe.checkout.sessions.retrieve(a.session_id);
  const customer = a.parameters?.customer;
  if (typeof customer !== 'string') throw new Error('Checkout needs reconciliation.');
  // Reconcile an unknown create outcome BEFORE issuing another create request.
  // This also avoids relying on Stripe keeping idempotency results forever.
  let checked = 0;
  for await (const session of stripe.checkout.sessions.list({
    customer, limit: 100
  })) {
    if (session.metadata?.attempt_id === a.id) return session;
    if (++checked >= 1000) throw new Error('Checkout history needs support review.');
  }
  return null;
}

export async function releaseHandymanAttempt(
  admin: SupabaseClient, stripe: Stripe, a: HandymanAttempt
) {
  if (!a.payment_intent || !['release_pending', 'released'].includes(a.status))
    throw new Error('No release decision was recorded.');
  const j = await loadHandymanJob(admin, a.job_id);
  // A release decision can never cancel the currently assigned payment.
  if (j.payment_intent === a.payment_intent)
    throw new Error('Current payment cannot be released through recovery.');
  const pi = await stripe.paymentIntents.retrieve(a.payment_intent);
  validateHandymanIntent(pi, j);
  if (pi.amount !== a.amount_pence)
    throw new Error('Release amount does not match its authorisation.');
  if (pi.status === 'requires_capture') {
    await stripe.paymentIntents.cancel(pi.id, {}, {
      idempotencyKey: 'handyman-release-' + pi.id
    });
  } else if (pi.status !== 'canceled') {
    throw new Error('A captured payment needs support review.');
  }
  await checkedRpc(admin, 'finish_handyman_hold_release', {
    p_attempt: a.id, p_intent: pi.id
  });
}

async function cleanPreviousHandymanHold(
  admin: SupabaseClient, stripe: Stripe, j: HandymanJob
) {
  if (!j.previous_payment_intent) return;
  const { data: a, error } = await admin.from('handyman_payment_attempts')
    .select('*').eq('job_id', j.id)
    .eq('payment_intent', j.previous_payment_intent).maybeSingle();
  if (error) throw new Error('Previous authorisation could not be loaded.');
  if (a) {
    await releaseHandymanAttempt(admin, stripe, a as HandymanAttempt);
    return;
  }
  // Preserve history for a replacement made before the ledger existed.
  const old = await stripe.paymentIntents.retrieve(j.previous_payment_intent);
  validateHandymanIntent(old, j);
  if (old.id === j.payment_intent) throw new Error('Previous payment is current.');
  const { error: insertError } = await admin.from('handyman_payment_attempts')
    .upsert({
      job_id: j.id, revision: 'initial', amount_pence: old.amount,
      payment_intent: old.id, status: 'release_pending', legacy: true
    }, { onConflict: 'payment_intent', ignoreDuplicates: true });
  if (insertError) throw new Error('Previous hold recovery could not be recorded.');
  const { data: recorded, error: lookupError } = await admin
    .from('handyman_payment_attempts').select('*')
    .eq('job_id', j.id).eq('payment_intent', old.id).single();
  if (lookupError || !recorded)
    throw new Error('Previous hold recovery could not be loaded.');
  await releaseHandymanAttempt(admin, stripe, recorded as HandymanAttempt);
}

export async function handymanCheckout(
  stripe: Stripe,
  admin: SupabaseClient,
  j: HandymanJob,
  user: { id: string; email?: string },
  site: string
) {
  if (j.customer_id !== user.id) throw new Error('Checkout is private.');
  const revision = j.status === 'awaiting_authorization' ? 'final' : 'initial';
  const amount = revision === 'final' ? j.bill?.gross : j.held_pence;
  if (!amount) throw new Error('No bill is ready.');
  const { data: p, error } = await admin.from('providers')
    .select('stripe_account_id').eq('id', j.provider_id).single();
  if (error || p?.stripe_account_id !== j.payout_account_id)
    throw new Error('Professional payout account changed or is unavailable.');
  const account = await stripe.accounts.retrieve(j.payout_account_id);
  if (account.deleted || account.capabilities?.transfers !== 'active')
    throw new Error('Professional payout account is not ready.');
  const customer = await getOrCreateBillingCustomer(stripe, user);
  const parameters: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment', customer, payment_method_types: ['card'],
    client_reference_id: user.id,
    metadata: { kind: 'handyman', job_id: j.id, revision },
    payment_intent_data: {
      capture_method: 'manual', transfer_group: 'handyman_' + j.id,
      metadata: { kind: 'handyman', job_id: j.id, revision, customer_id: user.id }
    },
    line_items: [{
      price_data: {
        currency: 'gbp', unit_amount: amount,
        product_data: {
          name: revision === 'final'
            ? 'Handyman approved bill authorisation' : j.task_name,
          description: 'Card hold. Payment is collected after the completed job and approved bill.'
        }
      }, quantity: 1
    }],
    success_url: site + '/handyman/jobs/' + j.id + '?checkout=complete',
    cancel_url: site + '/handyman/jobs/' + j.id
  };
  for (let retry = 0; retry < 2; retry++) {
    const a = await checkedRpc<HandymanAttempt>(admin, 'begin_handyman_checkout', {
      p_job: j.id, p_user: user.id, p_parameters: parameters
    });
    let session = await findAttemptSession(stripe, a);
    if (!session) {
      const expires = Number(a.parameters?.expires_at);
      if (!a.parameters || !Number.isFinite(expires))
        throw new Error('Checkout needs reconciliation.');
      if (expires < Math.floor(Date.now() / 1000) + 1800) {
        await checkedRpc(admin, 'expire_handyman_attempt', {
          p_attempt: a.id, p_session: null
        });
        continue;
      }
      session = await stripe.checkout.sessions.create(a.parameters, {
        idempotencyKey: 'handyman-checkout-' + a.id
      });
    }
    await checkedRpc(admin, 'record_handyman_session', {
      p_attempt: a.id, p_session: session.id
    });
    if (session.status === 'expired') {
      await checkedRpc(admin, 'expire_handyman_attempt', {
        p_attempt: a.id, p_session: session.id
      });
      continue;
    }
    if (session.status === 'complete' && session.payment_intent) {
      const intentId = typeof session.payment_intent === 'string'
        ? session.payment_intent : session.payment_intent.id;
      await finalizeHandymanCheckout(
        admin, stripe, session, await stripe.paymentIntents.retrieve(intentId)
      );
      return { url: null, jobId: j.id, authorised: true };
    }
    if (session.status !== 'open' || !session.url)
      throw new Error('Checkout is unavailable.');
    return { url: session.url, jobId: j.id };
  }
  throw new Error('Reservation or checkout expired. Refresh the job.');
}

export async function finalizeHandymanCheckout(
  admin: SupabaseClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  pi: Stripe.PaymentIntent
) {
  if (!handymanEnabled()) return;
  const id = session.metadata?.job_id;
  const sessionIntent = typeof session.payment_intent === 'string'
    ? session.payment_intent : session.payment_intent?.id;
  if (
    !id || session.metadata?.kind !== 'handyman' ||
    session.mode !== 'payment' || session.status !== 'complete' ||
    !['initial', 'final'].includes(session.metadata?.revision ?? '') ||
    pi.metadata.revision !== session.metadata?.revision ||
    sessionIntent !== pi.id
  ) throw new Error('Invalid handyman checkout.');
  const j = await loadHandymanJob(admin, id);
  validateHandymanIntent(pi, j);
  if (session.client_reference_id !== j.customer_id)
    throw new Error('Checkout owner does not match.');
  let query = admin.from('handyman_payment_attempts')
    .select('*').eq('job_id', id);
  query = session.metadata?.attempt_id
    ? query.eq('id', session.metadata.attempt_id)
    : query.eq('session_id', session.id);
  let { data, error } = await query.single();
  if (!data && !session.metadata?.attempt_id) {
    const historic = await admin.from('handyman_payment_attempts')
      .select('*').eq('job_id', id).eq('payment_intent', pi.id).maybeSingle();
    if (historic.data?.legacy && !historic.data.session_id &&
        ['release_pending', 'released'].includes(historic.data.status)) {
      data = historic.data;
      error = historic.error;
    }
  }
  const a = data as HandymanAttempt | null;
  if (
    error || !a ||
    (a.session_id && a.session_id !== session.id) ||
    (a.payment_intent && a.payment_intent !== pi.id) ||
    pi.amount !== a.amount_pence ||
    (!a.legacy && a.revision !== session.metadata?.revision)
  ) throw new Error('Authorisation does not match its recorded attempt.');

  // Validate ownership/history FIRST, then acknowledge a known delayed event.
  // The live PaymentIntent may already be captured or cancelled by now.
  if (a.payment_intent === pi.id && a.status === 'attached') {
    if (j.payment_intent !== pi.id)
      throw new Error('Replaced hold needs reconciliation.');
    if (
      pi.status === 'succeeded' &&
      (!j.approved_at || !j.bill || pi.amount_received !== j.bill.gross)
    ) throw new Error('Captured amount does not match the approved bill.');
    if (!['requires_capture', 'succeeded', 'canceled'].includes(pi.status))
      throw new Error('Recorded payment needs support review.');
    await cleanPreviousHandymanHold(admin, stripe, j);
    return;
  }
  if (a.payment_intent === pi.id &&
      ['release_pending', 'released'].includes(a.status)) {
    await releaseHandymanAttempt(admin, stripe, a);
    return;
  }
  if (pi.status !== 'requires_capture' || pi.amount_received !== 0 ||
      pi.amount_capturable !== pi.amount)
    throw new Error('A new card hold must be uncaptured.');
  const chargeId = typeof pi.latest_charge === 'string'
    ? pi.latest_charge : pi.latest_charge?.id;
  const charge = chargeId ? await stripe.charges.retrieve(chargeId) : null;
  const deadline = charge?.payment_method_details?.card?.capture_before;
  const result = await checkedRpc<{
    decision: string; job: HandymanJob; attempt: HandymanAttempt;
  }>(admin, 'finalize_handyman_attempt', {
    p_job: id, p_attempt: a.id, p_session: session.id, p_intent: pi.id,
    p_amount: pi.amount, p_final: session.metadata?.revision === 'final',
    p_capture_before: deadline ? new Date(deadline * 1000).toISOString() : null
  });
  if (result.decision === 'release' || result.decision === 'released') {
    await releaseHandymanAttempt(admin, stripe, result.attempt);
    return;
  }
  if (result.decision !== 'attached') throw new Error('Unknown hold decision.');
  await cleanPreviousHandymanHold(admin, stripe, result.job);
}

/** Retry recorded release decisions and missed checkout finalisation. No capture. */
export async function recoverHandymanPayments(
  admin: SupabaseClient, stripe: Stripe
) {
  let checked = 0, recovered = 0, failed = 0;
  for (const states of [['release_pending'], ['creating', 'open']]) {
    const { data, error } = await admin.from('handyman_payment_attempts')
      .select('*').in('status', states).order('updated_at').limit(20);
    if (error) throw new Error('Payment recovery queue could not be loaded.');
    for (const row of data ?? []) {
      checked++;
      const a = row as HandymanAttempt;
      try {
        if (a.status === 'release_pending') {
          await releaseHandymanAttempt(admin, stripe, a);
          recovered++;
          continue;
        }
        const session = await findAttemptSession(stripe, a);
        if (!session) {
          if (a.parameters?.expires_at &&
              a.parameters.expires_at < Math.floor(Date.now() / 1000)) {
            await checkedRpc(admin, 'expire_handyman_attempt', {
              p_attempt: a.id, p_session: null
            });
            recovered++;
          }
          continue;
        }
        await checkedRpc(admin, 'record_handyman_session', {
          p_attempt: a.id, p_session: session.id
        });
        if (session.status === 'expired') {
          await checkedRpc(admin, 'expire_handyman_attempt', {
            p_attempt: a.id, p_session: session.id
          });
          recovered++;
        } else if (session.status === 'complete' && session.payment_intent) {
          const id = typeof session.payment_intent === 'string'
            ? session.payment_intent : session.payment_intent.id;
          await finalizeHandymanCheckout(admin, stripe, session,
            await stripe.paymentIntents.retrieve(id));
          recovered++;
        }
      } catch {
        // Keep the persisted attempt for the next run or support review.
        failed++;
      }
    }
  }
  return { checked, recovered, failed };
}

export async function settleHandyman(
  admin: SupabaseClient,
  stripe: Stripe,
  j: HandymanJob
) {
  if (
    !j.bill ||
    !j.payment_intent ||
    j.status !== 'payment_pending' ||
    !j.approved_at
  )
    throw new Error('Customer approval is required.');
  const { data: p, error } = await admin
    .from('providers')
    .select('stripe_account_id')
    .eq('id', j.provider_id)
    .single();
  if (error || !p?.stripe_account_id)
    throw new Error('Assigned professional has no payout account.');
  if (p.stripe_account_id !== j.payout_account_id)
    throw new Error(
      'Assigned payout account changed; support review is required.'
    );
  const account = await stripe.accounts.retrieve(j.payout_account_id);
  if (account.deleted || account.capabilities?.transfers !== 'active')
    throw new Error('Assigned professional account cannot receive transfers.');
  let pi = await stripe.paymentIntents.retrieve(j.payment_intent);
  if (
    pi.metadata.job_id !== j.id ||
    pi.metadata.customer_id !== j.customer_id ||
    pi.metadata.kind !== 'handyman' ||
    pi.capture_method !== 'manual' ||
    pi.transfer_data?.destination ||
    pi.application_fee_amount ||
    pi.currency !== 'gbp'
  )
    throw new Error('Payment does not match the job.');
  await cleanPreviousHandymanHold(admin, stripe, j);
  async function requestFreshAuthorisation() {
    await checkedRpc(admin, 'reauthorise_handyman_bill', {
      p_job: j.id, p_intent: pi.id
    });
    throw new HandymanAuthorisationRequired(
      'Your earlier card hold expired. Authorise the approved bill again.'
    );
  }
  if (pi.status === 'canceled') await requestFreshAuthorisation();
  if (pi.status === 'requires_capture') {
    if (pi.amount_capturable < j.bill.gross)
      throw new Error('Additional authorisation is required.');
    try {
      pi = await stripe.paymentIntents.capture(
        pi.id,
        { amount_to_capture: j.bill.gross },
        { idempotencyKey: 'handyman-capture-' + pi.id }
      );
    } catch (failure) {
      // Expiry may occur between retrieve and capture. Check the actual outcome;
      // an unknown network result must never start another payment.
      pi = await stripe.paymentIntents.retrieve(j.payment_intent!);
      validateHandymanIntent(pi, j);
      if (pi.status === 'canceled') await requestFreshAuthorisation();
      if (pi.status !== 'succeeded') throw failure;
    }
  }
  if (
    pi.status !== 'succeeded' ||
    pi.amount_received !== j.bill.gross ||
    !pi.latest_charge
  )
    throw new Error('Payment has not completed.');
  const chargeId = typeof pi.latest_charge === 'string'
    ? pi.latest_charge : pi.latest_charge.id;
  function checkTransfer(transfer: Stripe.Transfer) {
    const destination = typeof transfer.destination === 'string'
      ? transfer.destination : transfer.destination?.id;
    const source = typeof transfer.source_transaction === 'string'
      ? transfer.source_transaction : transfer.source_transaction?.id;
    if (transfer.amount !== j.bill!.provider || transfer.currency !== 'gbp' ||
        destination !== j.payout_account_id || source !== chargeId ||
        transfer.reversed || transfer.amount_reversed !== 0 ||
        transfer.metadata.handyman_job_id !== j.id ||
        transfer.metadata.provider_id !== j.provider_id)
      throw new Error('Transfer history needs support review.');
  }
  // Reconcile unknown outcomes even after Stripe's idempotency cache expires.
  const history = await stripe.transfers.list({
    transfer_group: 'handyman_' + j.id, limit: 100
  });
  if (history.has_more || history.data.length > 1)
    throw new Error('Multiple transfers need support review.');
  let transfer = history.data[0];
  if (transfer) checkTransfer(transfer);
  else {
    transfer = await stripe.transfers.create({
      amount: j.bill.provider, currency: 'gbp',
      destination: j.payout_account_id, source_transaction: chargeId,
      transfer_group: 'handyman_' + j.id,
      metadata: { handyman_job_id: j.id, provider_id: j.provider_id }
    }, { idempotencyKey: 'handyman-payout-' + j.id });
    checkTransfer(transfer);
  }
  const { data: paid, error: paidError } = await admin
    .from('handyman_jobs')
    .update({
      status: 'completed',
      transfer_ref: transfer.id,
      previous_payment_intent: null,
      last_payment_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', j.id)
    .eq('status', 'payment_pending')
    .eq('payment_intent', pi.id)
    .select('id');
  if (paidError)
    throw new Error('Payment was processed; record needs reconciliation.');
  if (paid?.length !== 1) {
    const current = await loadHandymanJob(admin, j.id);
    if (current.status !== 'completed' || current.transfer_ref !== transfer.id)
      throw new Error('Transfer was processed; record needs reconciliation.');
  }
  return transfer.id;
}
export async function handymanFailure(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
export { isAccountError };
