import { NextRequest, NextResponse } from 'next/server';
import { handymanContext, isAccountError } from '@/lib/handymanServer';
import {
  validHandymanTask,
  handymanReviewSummary
} from '@/lib/handymanMarketplace';
export async function GET(req: NextRequest) {
  const ctx = await handymanContext(req);
  if (isAccountError(ctx)) return ctx;
  const q = req.nextUrl.searchParams,
    task = q.get('task'),
    postcode = q.get('postcode')?.trim().toUpperCase(),
    slot = q.get('slot'),
    minutes = Number(q.get('minutes'));
  if (
    !validHandymanTask(task) ||
    !postcode ||
    !/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode) ||
    !slot ||
    !Number.isFinite(Date.parse(slot)) ||
    Date.parse(slot) < Date.now() + 7200000 ||
    Date.parse(slot) > Date.now() + 6 * 86400000 ||
    !Number.isInteger(minutes) ||
    minutes < 60 ||
    minutes > 480 ||
    minutes % 30
  )
    return NextResponse.json(
      {
        error:
          'Choose a valid task, postcode, duration and time in the next six days, with two hours notice.'
      },
      { status: 400 }
    );
  const { data: rates, error } = await ctx.admin
    .from('provider_task_rates')
    .select('provider_id,hourly_rate_pence')
    .eq('task_name', task);
  if (error)
    return NextResponse.json(
      { error: 'Professionals could not be loaded.' },
      { status: 503 }
    );
  const result: {
    id: string;
    display_name: string;
    bio: string | null;
    photo_url: string | null;
    years_experience: number | null;
    hourlyRatePence: number;
    vatBps: number;
    equipment: boolean;
    completedJobs: number;
    ratingCount: number;
    rating: number | null;
    publicReviews: {
      rating: number;
      comment: string | null;
      reviewed_at: string;
    }[];
  }[] = [];
  for (const rate of rates ?? []) {
    const { data: available, error: availabilityError } = await ctx.admin.rpc(
      'handyman_available',
      {
        p_provider: rate.provider_id,
        p_customer: ctx.user.id,
        p_postcode: postcode,
        p_slot: slot,
        p_minutes: minutes
      }
    );
    if (availabilityError)
      return NextResponse.json(
        { error: 'Availability could not be checked.' },
        { status: 503 }
      );
    if (!available) continue;
    const [{ data: p }, { data: s }, { data: jobs }] = await Promise.all([
      ctx.admin
        .from('providers')
        .select('id,display_name,bio,photo_url,years_experience')
        .eq('id', rate.provider_id)
        .single(),
      ctx.admin
        .from('provider_profile_settings')
        .select('vat_number,brings_equipment')
        .eq('provider_id', rate.provider_id)
        .single(),
      ctx.admin
        .from('handyman_jobs')
        .select('id')
        .eq('provider_id', rate.provider_id)
        .eq('status', 'completed')
    ]);
    const { data: reviews, error: reviewError } = jobs?.length
      ? await ctx.admin
          .from('handyman_reviews')
          .select('rating,comment,is_public,reviewed_at')
          .in(
            'job_id',
            jobs.map((x) => x.id)
          )
      : { data: [], error: null };
    if (reviewError)
      return NextResponse.json(
        { error: 'Reviews could not be loaded.' },
        { status: 503 }
      );
    if (!p || !s) continue;
    result.push({
      ...p,
      hourlyRatePence: rate.hourly_rate_pence,
      vatBps: s.vat_number ? 2000 : 0,
      equipment: s.brings_equipment,
      completedJobs: jobs?.length ?? 0,
      ...handymanReviewSummary(reviews ?? [])
    });
  }
  return NextResponse.json(
    { professionals: result },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
