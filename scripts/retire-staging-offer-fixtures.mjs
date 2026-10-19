// Soft-retire only this run's unfunded F1 fixtures; retain their audit history.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
if (!process.argv.includes("--retire-real-staging-fixtures"))
  throw Error("Explicit retirement flag required");
const s = JSON.parse(readFileSync(".local-secrets/staging-api.json", "utf8"));
assert.equal(
  s.NEXT_PUBLIC_SUPABASE_URL,
  "https://comwdjprdedmsnxtvuuk.supabase.co",
);
const path = ".local-secrets/f1-offer-fixtures.json",
  state = JSON.parse(readFileSync(path, "utf8"));
const admin = createClient(
  s.NEXT_PUBLIC_SUPABASE_URL,
  s.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
async function need(query) {
  const r = await query;
  if (r.error) throw Error(r.error.message);
  return r.data;
}
const ids = [
  ...new Set(
    [
      ...Object.values(state.bookings),
      state.settingsBooking,
      state.clash,
    ].filter(Boolean),
  ),
];
const rows = await need(
  admin
    .from("bookings")
    .select("id,status,customer_id,household_notes")
    .in("id", ids),
);
assert.equal(rows.length, ids.length);
for (const row of rows) {
  assert.ok(state.users.some((u) => u.id === row.customer_id));
  assert.ok(row.household_notes.startsWith("F1 SYNTHETIC TEST ONLY"));
}
for (const table of [
  "payments",
  "booking_visit_billing",
  "booking_visit_money_operations",
  "money_operations",
]) {
  const q = await admin
    .from(table)
    .select("booking_id", { count: "exact", head: true })
    .in("booking_id", ids);
  assert.equal(q.error, null);
  assert.equal(q.count, 0);
}
let retired = 0;
for (const row of rows) {
  if (!["offered", "scheduled", "needs_review"].includes(row.status)) continue;
  await need(
    admin.rpc("system_transition_booking", {
      p_booking_id: row.id,
      p_to_status: "cancelled",
      p_reason:
        "F1 SYNTHETIC TEST ONLY: unfunded fixture retired after verification",
      p_meta: { f1_test_only: true },
    }),
  );
  retired++;
}
await need(
  admin
    .from("booking_offers")
    .update({ status: "expired" })
    .in("booking_id", ids)
    .eq("status", "open"),
);
const providers = await need(
  admin.from("providers").select("id,profile_id").in("id", state.providers),
);
assert.equal(providers.length, 8);
assert.ok(
  providers.every((p) => state.users.some((u) => u.id === p.profile_id)),
);
await need(
  admin
    .from("providers")
    .update({ is_suspended: true, show_on_our_pros: false })
    .in("id", state.providers),
);
await need(
  admin
    .from("service_areas")
    .update({ active: false })
    .eq("id", state.area)
    .eq("name", "[TEST ONLY F1] " + state.run),
);
await need(
  admin
    .from("profiles")
    .update({ role: "customer" })
    .eq("id", state.staff.id)
    .eq("email", `qa-f1-${state.run}-staff@example.invalid`),
);
state.retired = {
  at: new Date().toISOString(),
  bookings: retired,
  providers: 8,
  payments: 0,
  staffDemoted: true,
};
writeFileSync(path, JSON.stringify(state, null, 2));
writeFileSync(
  "artifacts/f1-staging-results.json",
  JSON.stringify(
    {
      run: state.run,
      bookings: state.bookings,
      schedulerProof: state.schedulerProof,
      retired: state.retired,
      results: [...new Set(state.results)],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    retiredBookings: retired,
    suspendedSyntheticProviders: 8,
    payments: 0,
    existingAccountsChanged: 0,
  }),
);
