import { NextRequest, NextResponse } from 'next/server';
import {
  handymanContext,
  isAccountError,
  handymanCheckout,
  handymanStripe
} from '@/lib/handymanServer';
import { readAccountBody, normaliseGbPhone } from '@/lib/accountApi';
import {
  validHandymanTask,
  regulatedHandymanDescription
} from '@/lib/handymanMarketplace';
export async function GET(req: NextRequest) {
  const ctx = await handymanContext(req);
  if (isAccountError(ctx)) return ctx;
  let query = ctx.admin
    .from('handyman_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  query = ctx.providerId
    ? query.or(`customer_id.eq.${ctx.user.id},provider_id.eq.${ctx.providerId}`)
    : query.eq('customer_id', ctx.user.id);
  const { data, error } = await query;
  return error
    ? NextResponse.json({ error: 'Jobs could not be loaded.' }, { status: 503 })
    : NextResponse.json(
        { jobs: data },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
}
export async function POST(req: NextRequest) {
  const ctx = await handymanContext(req, true);
  if (isAccountError(ctx)) return ctx;
  const b = await readAccountBody(req);
  if (b instanceof NextResponse) return b;
  const description =
      typeof b.description === 'string' ? b.description.trim() : '',
    address = typeof b.address === 'string' ? b.address.trim() : '',
    postcode =
      typeof b.postcode === 'string' ? b.postcode.trim().toUpperCase() : '';
  if (
    !validHandymanTask(b.task) ||
    description.length < 10 ||
    description.length > 2000 ||
    regulatedHandymanDescription(description) ||
    address.length < 5 ||
    address.length > 300 ||
    !/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode) ||
    typeof b.providerId !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(b.providerId) ||
    typeof b.slot !== 'string' ||
    !Number.isInteger(b.minutes) ||
    Number(b.minutes) < 60 ||
    Number(b.minutes) > 480 ||
    Number(b.minutes) % 30 ||
    !Number.isInteger(b.materialsBudgetPence) ||
    Number(b.materialsBudgetPence) < 0 ||
    Number(b.materialsBudgetPence) > 500000
  )
    return NextResponse.json(
      {
        error:
          'Check the job details. Gas, electrical, structural and other regulated work cannot be booked.'
      },
      { status: 400 }
    );
  const { data: profile } = await ctx.admin
    .from('profiles')
    .select('phone')
    .eq('id', ctx.user.id)
    .single();
  try {
    if (!normaliseGbPhone(profile?.phone)) throw Error();
  } catch {
    return NextResponse.json(
      { error: 'Save a valid UK phone number in My profile before booking.' },
      { status: 400 }
    );
  }
  try {
    const { data: j, error } = await ctx.admin.rpc('reserve_handyman_job', {
      p_customer: ctx.user.id,
      p_provider: b.providerId,
      p_task: b.task,
      p_description: description,
      p_address: address,
      p_postcode: postcode,
      p_slot: b.slot,
      p_minutes: b.minutes,
      p_materials: b.materialsBudgetPence
    });
    if (error)
      return NextResponse.json(
        { error: 'That professional or time is no longer available.' },
        { status: 409 }
      );
    return NextResponse.json(
      await handymanCheckout(
        handymanStripe(),
        ctx.admin,
        j,
        ctx.user,
        req.nextUrl.origin
      )
    );
  } catch {
    return NextResponse.json(
      {
        error: 'Card authorisation could not be started. No payment was taken.'
      },
      { status: 503 }
    );
  }
}
