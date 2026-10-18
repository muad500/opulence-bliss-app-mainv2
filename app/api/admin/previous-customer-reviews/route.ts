import { randomBytes, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { sendPrivateAccountMail } from "@/lib/privateAccountMail";

export async function GET(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const result = await ctx.admin
    .from("previous_customer_reviews")
    .select("id,customer_name,service_label,rating,comment,status,submitted_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (result.error)
    return NextResponse.json(
      { error: "Reviews could not be loaded." },
      { status: 503 },
    );
  return NextResponse.json(
    { reviews: result.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (body.action === "moderate") {
    if (
      !/^[a-f0-9-]{36}$/.test(body.id ?? "") ||
      !["approved", "rejected"].includes(body.status)
    )
      return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
    const result = await ctx.client.rpc("moderate_previous_customer_review", {
      p_id: body.id,
      p_status: body.status,
    });
    if (result.error || !result.data)
      return NextResponse.json(
        { error: "This review is no longer awaiting approval." },
        { status: 409 },
      );
    return NextResponse.json({ ok: true });
  }
  const name = String(body.name ?? "").trim(),
    email = String(body.email ?? "")
      .trim()
      .toLowerCase(),
    service = String(body.service ?? "").trim();
  if (
    !name ||
    name.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !service ||
    service.length > 120
  )
    return NextResponse.json(
      { error: "Enter the customer's name, email and previous service." },
      { status: 400 },
    );
  const recent = await ctx.admin
    .from("previous_customer_reviews")
    .select("id", { count: "exact", head: true })
    .eq("created_by", ctx.user.id)
    .gte("created_at", new Date(Date.now() - 3600000).toISOString());
  if (recent.error || (recent.count ?? 0) >= 30)
    return NextResponse.json(
      { error: "Please wait before creating more links." },
      { status: 429 },
    );
  const token = randomBytes(32).toString("hex"),
    hash = createHash("sha256").update(token).digest("hex");
  const result = await ctx.admin
    .from("previous_customer_reviews")
    .insert({
      token_hash: hash,
      customer_name: name,
      email,
      service_label: service,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (result.error)
    return NextResponse.json(
      { error: "Review invitation could not be created." },
      { status: 503 },
    );
  const link = `${request.nextUrl.origin}/reviews/previous?token=${token}`;
  const sent = await sendPrivateAccountMail(
    email,
    "Share your previous Opulence Bliss experience",
    `Please share your previous customer experience: ${link}\nYour review will be checked by our team before publication, labelled Previous customer, and excluded from our booking star rating. Once submitted it cannot be edited.`,
    `previous-review-${result.data.id}`,
  );
  return NextResponse.json(
    {
      link,
      sent,
      message: sent
        ? "Review invitation sent."
        : "Email is unavailable. Copy this private review link to share it with this customer.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
