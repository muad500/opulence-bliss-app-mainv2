import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isValidUkPhone, normalizeUkPhone } from "@/lib/ukPhone";

const admin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TASK_TYPES = new Set([
  "Mounting and hanging",
  "Furniture assembly",
  "Minor repairs",
  "Curtains and blinds",
  "Furniture moving",
  "Minor decorating",
  "Other",
]);

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in with a customer account before requesting a quote." },
        { status: 401 },
      );
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.role === "admin") {
      return NextResponse.json(
        { error: "A customer account is required to request a handyman quote." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const fullName = text(body.fullName, 120);
    const email = text(body.email, 180).toLowerCase();
    const phone = text(body.phone, 40);
    const address = text(body.address, 240);
    const postcode = text(body.postcode, 16).toUpperCase();
    const taskType = text(body.taskType, 100);
    const description = text(body.description, 2000);
    const preferredDate = text(body.preferredDate, 10) || null;
    const preferredTime = text(body.preferredTime, 80) || null;
    const consentAccepted = body.consentAccepted === true;

    if (
      !fullName ||
      !email ||
      !phone ||
      !address ||
      !postcode ||
      !taskType ||
      !description ||
      !consentAccepted
    ) {
      return NextResponse.json(
        { error: "Complete all required quotation fields." },
        { status: 400 },
      );
    }
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!isValidUkPhone(phone)) {
      return NextResponse.json({ error: "Enter a valid UK phone number." }, { status: 400 });
    }
    if (!TASK_TYPES.has(taskType)) {
      return NextResponse.json({ error: "Choose a valid handyman task." }, { status: 400 });
    }

    const { data, error } = await admin
      .from("handyman_quote_requests")
      .insert({
        customer_id: user.id,
        full_name: fullName,
        email,
        phone: normalizeUkPhone(phone),
        address,
        postcode,
        task_type: taskType,
        description,
        preferred_date: preferredDate,
        preferred_time: preferredTime,
      })
      .select("reference")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, reference: data.reference });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not send your quote request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
