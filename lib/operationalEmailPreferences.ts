import { createClient } from "@supabase/supabase-js";
import { webPushEnabled } from "./webPushPolicy";
// This branch is staging-only. No Production key, schema or behaviour change.
export async function operationalEmailAllowed(
  email: string,
  title: string,
  href = "/account",
) {
  if (!webPushEnabled(process.env)) return true;
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await admin.rpc("operational_email_allowed", {
    p_email: email,
    p_title: title,
    p_href: href,
  });
  if (error) throw new Error("Notification preferences unavailable");
  return data === true;
}
