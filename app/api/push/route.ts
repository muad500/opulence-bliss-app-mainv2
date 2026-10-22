import { createClient } from "@/lib/supabase/server";
import { validPushSubscription, webPushEnabled } from "@/lib/webPushPolicy";
import { uuidPattern } from "@/lib/notificationSettings";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (data: object, status = 200) =>
  Response.json(data, { status, headers });

export async function GET() {
  if (!webPushEnabled(process.env)) return json({ enabled: false });
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return json({ enabled: false }, 401);
  const result = await client.rpc("web_push_enrolment");
  if (result.error)
    return json({ error: "Notification settings unavailable" }, 503);
  return json({
    ...result.data,
    enabled: true,
    userId: user.id,
    publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
  });
}

export async function POST(req: Request) {
  if (!webPushEnabled(process.env)) return json({ error: "Unavailable" }, 404);
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Origin not allowed" }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > 4096)
    return json({ error: "Too large" }, 413);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return json({ error: "Sign in first" }, 401);
  let body;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return json({ error: "Too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return json({ error: "Invalid request" }, 400);
  if (body.action === "snooze") {
    const result = await client.rpc("snooze_web_push_prompt");
    return result.error
      ? json({ error: "Could not save preference" }, 503)
      : json({ ok: true });
  }
  if (typeof body.deviceId !== "string" || !uuidPattern.test(body.deviceId))
    return json({ error: "Device required" }, 400);
  if (body.action === "disable" || body.action === "test") {
    const result = await client.rpc(
      body.action === "test"
        ? "test_web_push_device"
        : "remove_web_push_device",
      { p_device: body.deviceId },
    );
    return result.error
      ? json({ error: "Could not disable notifications" }, 503)
      : json({ ok: true });
  }
  if (!validPushSubscription(body.subscription))
    return json({ error: "Unsupported subscription" }, 400);
  const s = body.subscription;
  const result = await client.rpc("save_web_push_device", {
    p_endpoint: s.endpoint,
    p_auth: s.keys.auth,
    p_p256dh: s.keys.p256dh,
    p_opt_in: body.optIn === true,
    p_device: body.deviceId,
    p_name:
      typeof body.deviceName === "string"
        ? body.deviceName.slice(0, 60)
        : "Browser",
  });
  return result.error
    ? json(
        {
          error:
            "Could not save this device. Sign out of other accounts on this browser and retry.",
        },
        409,
      )
    : json({ ok: true });
}
