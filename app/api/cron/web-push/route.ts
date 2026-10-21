import { createClient } from "@supabase/supabase-js";
import { deliverWebPush } from "@/lib/webPushDelivery";
export const maxDuration = 60;
export async function GET(req: Request) {
  if (
    !process.env.WEB_PUSH_CRON_SECRET ||
    req.headers.get("authorization") !==
      `Bearer ${process.env.WEB_PUSH_CRON_SECRET}`
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await deliverWebPush(
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      ),
    );
    return Response.json(result, {
      status: result.failed ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Push processing unavailable" },
      { status: 503 },
    );
  }
}
