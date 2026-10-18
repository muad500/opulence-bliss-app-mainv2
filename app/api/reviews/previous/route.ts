import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/accountApi";
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Open the review link on this website." },
      { status: 403 },
    );
  const raw = await request.text();
  if (raw.length > 5000)
    return NextResponse.json(
      { error: "Keep the review under 2,000 characters." },
      { status: 413 },
    );
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid review." }, { status: 400 });
  }
  if (
    !/^[a-f0-9]{64}$/.test(body?.token ?? "") ||
    !Number.isInteger(body.rating) ||
    body.rating < 1 ||
    body.rating > 5 ||
    typeof body.comment !== "string" ||
    !body.comment.trim() ||
    body.comment.trim().length > 2000
  )
    return NextResponse.json(
      { error: "Choose a rating and write your review." },
      { status: 400 },
    );
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const result = await admin.rpc("submit_previous_customer_review", {
    p_token: createHash("sha256").update(body.token).digest("hex"),
    p_rating: body.rating,
    p_comment: body.comment,
  });
  if (result.error || result.data !== true)
    return NextResponse.json(
      {
        error: "This link has expired or a review has already been submitted.",
      },
      { status: 409 },
    );
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
