import { NextResponse } from 'next/server';
import { handymanEnabled } from '@/lib/handymanMarketplace';
export async function GET() {
  return NextResponse.json(
    { enabled: handymanEnabled() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
