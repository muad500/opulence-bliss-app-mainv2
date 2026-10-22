import { createClient } from "@supabase/supabase-js";
import { deliverWebPush } from "@/lib/webPushDelivery";
import { deliverExtraNotificationEmails } from "@/lib/notificationExtraEmail";
import { webPushEnvironment } from "@/lib/webPushPolicy";
export const maxDuration = 60;
export async function GET(req: Request) {
  // Production's scheduler already holds this credential in Vault. Keep the
  // separate Preview credential and never copy a Preview bypass into Production.
  const secret =
    webPushEnvironment(process.env) === "production"
      ? process.env.CRON_SECRET
      : process.env.WEB_PUSH_CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    // Independent bounded outboxes must fit within the cron's 60s ceiling,
    // including when provider requests take their full timeout.
    const [result, email] = await Promise.all([
      deliverWebPush(admin),
      deliverExtraNotificationEmails(admin),
    ]);
    return Response.json(
      { ...result, email },
      {
        status: result.failed || email.failed ? 503 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { error: "Push processing unavailable" },
      { status: 503 },
    );
  }
}
