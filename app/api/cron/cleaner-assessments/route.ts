import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import { deliverCleanerAssessmentDecisions } from "@/lib/cleanerAssessmentDelivery";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!cleanerStage2Enabled())
    return Response.json({ error: "Not found" }, { status: 404, headers });
  const secret = process.env.CRON_SECRET;
  const sent = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (
    !secret ||
    sent.length !== expected.length ||
    !timingSafeEqual(sent, expected)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await admin.rpc("sweep_cleaner_assessments");
    if (error) throw Error("Recovery unavailable");
    const cleanup = await admin.rpc("purge_expired_cleaner_applications");
    if (cleanup.error) throw Error("Retention unavailable");
    const decisions = await deliverCleanerAssessmentDecisions(admin);
    return Response.json(
      { processed: data, retention: cleanup.data, decisions },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Assessment recovery unavailable" },
      { status: 503, headers },
    );
  }
}
