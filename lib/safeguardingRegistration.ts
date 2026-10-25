import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** No fallback policy: consent is required only after an explicit publish-day
 * switch AND a real published document. An unavailable check fails closed. */
export async function safeguardingRegistration(client: SupabaseClient) {
  const { data, error } = await client.rpc("safeguarding_registration_config");
  if (error || !data || typeof data.enabled !== "boolean")
    throw new Error(
      "Registration policies could not be checked. Please retry.",
    );
  return data as { enabled: boolean; version: string | null };
}
