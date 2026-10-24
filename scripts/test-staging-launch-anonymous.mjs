import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

// Read-only probes using the public browser key. Never load a service-role key
// or allow a production URL. Do not log records or credential values.
assert.equal(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "https://comwdjprdedmsnxtvuuk.supabase.co",
  "STAGING only",
);
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.ok(key, "A staging public browser key is required");
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
for (const table of [
  "provider_dbs_checks",
  "dbs_onboarding_staff",
  "dbs_access_events",
]) {
  const result = await client.from(table).select("*").limit(1);
  assert.equal(result.error?.code, "42501", `${table}: anonymous access denied`);
  console.log(`PASS anonymous access denied: ${table}`);
}
const record = await client.rpc("staff_view_dbs_record", {
  p_provider: "00000000-0000-4000-8000-000000000000",
  p_action: "record_view",
});
assert.equal(record.error?.code, "42501", "Anonymous RPC must be denied");
console.log("PASS anonymous access denied: audited DBS RPC");
