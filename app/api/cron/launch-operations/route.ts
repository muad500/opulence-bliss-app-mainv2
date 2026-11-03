import { createClient } from "@supabase/supabase-js";
import { deliverLaunchOperationsEmails } from "@/lib/launchOperationsMail";
export const maxDuration = 60;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const queued = await admin.rpc("queue_launch_operations_reminders");
    if (queued.error) throw Error();
    const email = await deliverLaunchOperationsEmails(admin);
    return Response.json(
      { email },
      {
        status: email.configured && !email.failed ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { error: "Operations reminders unavailable" },
      { status: 503 },
    );
  }
}
