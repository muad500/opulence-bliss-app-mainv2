import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isValidUkPhone, normalizeUkPhone } from "@/lib/ukPhone";
import { isSameOriginMutation, readAccountBody } from "@/lib/accountApi";
import { handymanEstimatePence } from "@/lib/handymanEstimate";

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
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Use the website to request a quote." }, { status: 403 });
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

    const body = await readAccountBody(request);
    if (body instanceof NextResponse) return body;
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

    let rateSnapshot: Record<string, unknown> = {};
    if (body.preferredProviderId) {
      const preferredProviderId = text(body.preferredProviderId, 36);
      if (!/^[0-9a-f-]{36}$/i.test(preferredProviderId)) return NextResponse.json({ error: "Choose a valid professional." }, { status: 400 });
      const { data: eligible, error: eligibleError } = await supabase.rpc("public_eligible_provider_ids").eq("id", preferredProviderId);
      if (eligibleError || !eligible?.length) return NextResponse.json({ error: "This professional is no longer available for quotes." }, { status: 409 });
      const [worker, rate] = await Promise.all([
        admin.from("providers").select("services").eq("id", preferredProviderId).single(),
        admin.from("provider_task_rates").select("hourly_rate_pence").eq("provider_id", preferredProviderId).eq("task_name", taskType).maybeSingle(),
      ]);
      if (worker.error || rate.error) return NextResponse.json({ error: "The professional's rate could not be checked." }, { status: 503 });
      if (!worker.data.services?.includes("handyman") || !rate.data) return NextResponse.json({ error: "This professional has no listed rate for that task." }, { status: 400 });
      if (body.expectedHourlyRatePence !== rate.data.hourly_rate_pence) return NextResponse.json({ error: "The listed rate has changed. Refresh the page before requesting your quote." }, { status: 409 });
      const total = handymanEstimatePence(rate.data.hourly_rate_pence, body.estimatedHours);
      if (total === null) return NextResponse.json({ error: "Choose between half an hour and 16 hours, in half-hour steps." }, { status: 400 });
      rateSnapshot = { preferred_provider_id: preferredProviderId, quoted_hourly_rate_pence: rate.data.hourly_rate_pence, estimated_hours: body.estimatedHours, estimate_total_pence: total };
    }

    const { data, error } = await admin
      .from("handyman_quote_requests")
      .insert({
        customer_id: user.id,
        ...rateSnapshot,
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
