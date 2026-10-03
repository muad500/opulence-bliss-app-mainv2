import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handymanEnabled } from '@/lib/handymanMarketplace';
import {
  handymanStripe, recoverHandymanPayments
} from '@/lib/handymanServer';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  if (!handymanEnabled())
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret)
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  try {
    return NextResponse.json(
      await recoverHandymanPayments(admin, handymanStripe()),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'Payment recovery needs a retry.' }, { status: 503 }
    );
  }
}
