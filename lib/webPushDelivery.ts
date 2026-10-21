import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pushCopy,
  pushHref,
  validPushSubscription,
  webPushEnabled,
} from "./webPushPolicy";

export async function deliverWebPush(admin: SupabaseClient) {
  if (!webPushEnabled(process.env))
    return { enabled: false, sent: 0, failed: 0 };
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject?.startsWith("mailto:"))
    throw new Error("Web Push is not configured");
  const { data, error } = await admin.rpc("claim_web_push", { p_limit: 5 });
  if (error) throw new Error("Push queue unavailable");
  let sent = 0,
    failed = 0;
  for (const row of data ?? []) {
    let outcome = "retry";
    try {
      const fresh = await admin.rpc("web_push_delivery_allowed", {
        p_id: row.id,
        p_token: row.claim_token,
      });
      if (fresh.error) throw new Error("Eligibility check unavailable");
      const subscription = {
        endpoint: row.endpoint,
        keys: { auth: row.auth_key, p256dh: row.p256dh },
      };
      if (
        !fresh.data ||
        !validPushSubscription(subscription) ||
        !pushCopy[row.kind]
      )
        outcome = "cancelled";
      else {
        const [title, body] = pushCopy[row.kind];
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title,
            body,
            href: pushHref(row.href),
            tag: `ob-${row.notification_id}`,
            userId: row.user_id,
          }),
          {
            vapidDetails: { subject, publicKey, privateKey },
            TTL: 300,
            timeout: 8000,
            topic: row.notification_id.replaceAll("-", ""),
            urgency: "normal",
          },
        );
        outcome = "sent";
        sent++;
      }
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      outcome = status === 404 || status === 410 ? "expired" : "retry";
      failed++;
    }
    const result = await admin.rpc("finish_web_push", {
      p_id: row.id,
      p_token: row.claim_token,
      p_outcome: outcome,
    });
    if (result.error) throw new Error("Push result could not be saved");
  }
  return { enabled: true, sent, failed };
}
