import { createClient } from "@/lib/supabase/server";
import {
  validNotificationPreference,
  uuidPattern,
} from "@/lib/notificationSettings";
import { webPushEnabled } from "@/lib/webPushPolicy";
import { bookingSmsConfig } from "@/lib/bookingSms";
export const dynamic = "force-dynamic";
const json = (data: object, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  if (!webPushEnabled(process.env)) return json({ enabled: false });
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return json({ error: "Sign in first" }, 401);
  const device = new URL(request.url).searchParams.get("device");
  if (!device || !uuidPattern.test(device))
    return json({ error: "Device required" }, 400);
  const { data, error } = await client.rpc("notification_settings", {
    p_device: device,
  });
  return error
    ? json({ error: "Settings could not be loaded" }, 503)
    : json({
        ...data,
        enabled: true,
        smsEnabled: Boolean(bookingSmsConfig(process.env)),
      });
}
export async function POST(request: Request) {
  if (!webPushEnabled(process.env)) return json({ error: "Unavailable" }, 404);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Origin not allowed" }, 403);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return json({ error: "Sign in first" }, 401);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 16000) return json({ error: "Too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (body?.action === "marketing" && typeof body.enabled === "boolean") {
    const { error } = await client.rpc("save_notification_marketing", {
      p_enabled: body.enabled,
    });
    return error
      ? json({ error: "Could not save consent" }, 503)
      : json({ ok: true });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !uuidPattern.test(body.deviceId ?? "") ||
    !Array.isArray(body.preferences) ||
    body.preferences.length > 36 ||
    !body.preferences.every(validNotificationPreference)
  )
    return json({ error: "Invalid preferences" }, 400);
  if (
    !bookingSmsConfig(process.env) &&
    body.preferences.some((p: { channel: string }) => p.channel === "sms")
  )
    return json({ error: "SMS is not available yet" }, 409);
  const { error } = await client.rpc("save_notification_settings", {
    p_device: body.deviceId,
    p_changes: body.preferences,
  });
  return error
    ? json({ error: "Could not save preferences" }, 503)
    : json({ ok: true });
}
