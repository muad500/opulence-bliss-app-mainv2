// Explicit, synthetic F1 fixtures only. No Stripe calls and no customer mail.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

if (!process.argv.includes("--run-real-staging"))
  throw Error("Use --run-real-staging explicitly");
const secrets = JSON.parse(
  readFileSync(".local-secrets/staging-api.json", "utf8"),
);
if (
  secrets.NEXT_PUBLIC_SUPABASE_URL !==
    "https://comwdjprdedmsnxtvuuk.supabase.co" ||
  !secrets.STRIPE_SECRET_KEY.startsWith("sk_test_")
)
  throw Error("Isolated staging only");
const admin = createClient(
  secrets.NEXT_PUBLIC_SUPABASE_URL,
  secrets.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const path = ".local-secrets/f1-offer-fixtures.json";
let state;
try {
  state = JSON.parse(readFileSync(path, "utf8"));
} catch {
  state = {
    run: randomBytes(6).toString("hex"),
    users: [],
    providers: [],
    bookings: {},
    results: [],
  };
}
function save() {
  writeFileSync(path, JSON.stringify(state, null, 2));
  writeFileSync(
    "artifacts/f1-staging-results.json",
    JSON.stringify(
      { run: state.run, bookings: state.bookings, results: state.results },
      null,
      2,
    ),
  );
}
async function need(query) {
  const r = await query;
  if (r.error) throw Error(r.error.message);
  return r.data;
}
function check(condition, label) {
  assert.ok(condition, label);
  if (!state.results.includes(label)) state.results.push(label);
  save();
  console.log("PASS " + label);
}
async function person(kind, role) {
  if (state.users.find((p) => p.kind === kind))
    return state.users.find((p) => p.kind === kind);
  const email = `qa-f1-${state.run}-${kind}@example.invalid`,
    password = randomBytes(30).toString("base64url") + "aA9!";
  const { user } = await need(
    admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "[TEST ONLY F1] " + kind },
    }),
  );
  const row = { kind, id: user.id, email, password };
  state.users.push(row);
  save();
  await need(
    admin.from("profiles").upsert({
      id: user.id,
      email,
      role,
      full_name: "[TEST ONLY F1] " + kind,
    }),
  );
  await need(
    admin
      .from("account_profile_details")
      .upsert({ user_id: user.id, notify_bookings: false }),
  );
  return row;
}
async function seed() {
  const customer = await person("customer", "customer");
  if (!state.area) {
    state.area = (
      await need(
        admin
          .from("service_areas")
          .insert({
            name: "[TEST ONLY F1] " + state.run,
            postcode_prefixes: ["ZE1"],
            active: true,
          })
          .select("id")
          .single(),
      )
    ).id;
    save();
  }
  const today = new Date().toISOString().slice(0, 10),
    expiry = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  for (let index = 0; index < 8; index++) {
    const user = await person("cleaner" + index, "provider");
    let provider = state.providers[index];
    if (!provider) {
      provider = (
        await need(
          admin
            .from("providers")
            .insert({
              profile_id: user.id,
              display_name: "[TEST ONLY F1] Cleaner " + index,
              services: ["cleaning"],
              vetting_status: "pending",
              show_on_our_pros: false,
            })
            .select("id")
            .single(),
        )
      ).id;
      state.providers[index] = provider;
      save();
    }
    if (state["ready" + index]) continue;
    const pdf = Buffer.from(
      "%PDF-1.4\n% FICTIONAL STAGING F1 TEST ONLY - NOT EVIDENCE\n%%EOF",
    );
    const dbs = `${provider}/F1-FICTIONAL-TEST.pdf`;
    await need(
      admin.storage
        .from("provider-dbs")
        .upload(dbs, pdf, { contentType: "application/pdf", upsert: true }),
    );
    await need(
      admin.from("provider_dbs_checks").upsert({
        provider_id: provider,
        certificate_number: String(
          (BigInt("0x" + state.run) % 90000000000n) +
            100000000000n +
            BigInt(index),
        ),
        issue_date: today,
        status: "verified",
        certificate_storage_path: dbs,
        certificate_original_name: "F1-FICTIONAL-TEST.pdf",
        certificate_mime_type: "application/pdf",
        uploaded_at: new Date().toISOString(),
      }),
    );
    for (const type of [
      "right_to_work",
      "photo_id",
      "public_liability_insurance",
      "proof_of_address",
    ]) {
      const storage = `${provider}/${type}/F1-FICTIONAL-TEST.pdf`;
      await need(
        admin.storage.from("provider-verification").upload(storage, pdf, {
          contentType: "application/pdf",
          upsert: true,
        }),
      );
      await need(
        admin.from("provider_verification_items").upsert(
          {
            provider_id: provider,
            document_type: type,
            label: type,
            status: "verified",
            reference:
              type === "right_to_work"
                ? "F1" + state.run.slice(0, 6).toUpperCase() + index
                : null,
            issued_at: today,
            expires_at: type === "proof_of_address" ? null : expiry,
            gov_uk_checked_on: type === "right_to_work" ? today : null,
            uploaded_at: new Date().toISOString(),
            document_storage_path: storage,
            document_original_name: "F1-FICTIONAL-TEST.pdf",
            document_mime_type: "application/pdf",
          },
          { onConflict: "provider_id,document_type" },
        ),
      );
    }
    await need(
      admin.from("provider_profile_settings").upsert({
        provider_id: provider,
        home_postcode: index === 7 ? "ZE3" : index === 6 ? "ZE2" : "ZE1",
        coverage_postcodes: ["ZE1"],
        availability_configured: true,
        max_daily_hours: 8,
        accepts_same_day: true,
        alert_app: true,
        alert_email: false,
      }),
    );
    await need(
      admin.from("provider_availability").delete().eq("provider_id", provider),
    );
    await need(
      admin.from("provider_availability").insert(
        Array.from({ length: 7 }, (_, weekday) => ({
          provider_id: provider,
          weekday,
          start_time: "07:00",
          end_time: "20:00",
        })),
      ),
    );
    await need(
      admin
        .from("provider_service_areas")
        .upsert({ provider_id: provider, service_area_id: state.area }),
    );
    check(
      (await need(
        admin.rpc("professional_verification_block", {
          p_provider_id: provider,
        }),
      )) === null,
      "Synthetic cleaner " + index + " passes real verification gates",
    );
    await need(
      admin
        .from("providers")
        .update({
          vetting_status: "approved",
          dbs_verified: true,
          service_approvals: { cleaning: "approved" },
        })
        .eq("id", provider),
    );
    state["ready" + index] = true;
    save();
  }
  await need(
    admin
      .from("customer_favourite_providers")
      .upsert({ user_id: customer.id, provider_id: state.providers[7] }),
  );
  if (!state.package) {
    state.package = (
      await need(
        admin
          .from("packages")
          .select("id")
          .eq("service_type", "cleaning")
          .limit(1),
      )
    )[0].id;
    save();
  }
  for (const [name, day] of [
    ["timing", 5],
    ["race", 6],
    ["decline", 7],
    ["previous", -5],
    ["eligibility", 8],
    ["samePerson", 9],
  ]) {
    if (state.bookings[name]) continue;
    const when = new Date(Date.now() + day * 86400000);
    when.setUTCHours(10, 0, 0, 0);
    const row = await need(
      admin
        .from("bookings")
        .insert({
          customer_id:
            name === "samePerson"
              ? state.users.find((x) => x.kind === "cleaner0").id
              : customer.id,
          provider_id: name === "previous" ? state.providers[6] : null,
          package_id: state.package,
          scheduled_at: when.toISOString(),
          duration_minutes: 120,
          status: name === "previous" ? "completed" : "offered",
          address: "[TEST ONLY F1] Fictional Place, ZE1 0AA",
          household_notes: "F1 SYNTHETIC TEST ONLY " + state.run,
          customer_email: null,
          offer_expires_at: new Date(when - 2 * 3600000).toISOString(),
        })
        .select("id,scheduled_at")
        .single(),
    );
    state.bookings[name] = row.id;
    state[name + "Slot"] = row.scheduled_at;
    save();
  }
  // Cache public district centres, never send fixture names or private addresses.
  for (const outcode of ["ZE1", "ZE2", "ZE3"]) {
    const response = await fetch(
      "https://api.postcodes.io/outcodes/" + outcode,
    );
    const { result } = await response.json();
    await need(
      admin.from("offer_geo_outcodes").upsert({
        outcode,
        latitude: result.latitude,
        longitude: result.longitude,
      }),
    );
  }
  const ranks = await need(
    admin.rpc("system_booking_offer_ranking", {
      p_booking_id: state.bookings.timing,
    }),
  );
  check(
    ranks.length === 8,
    "Exactly eight qualified synthetic cleaners; real professionals excluded from fixtures",
  );
  check(
    ranks[0].provider_id === state.providers[7],
    "Favourite ranks first even when farther away",
  );
  check(
    ranks[1].provider_id === state.providers[6],
    "Previous customer relationship ranks ahead of new cleaners",
  );
  check(
    ranks[2].factors.distanceKm < ranks[1].factors.distanceKm,
    "Distance uses cached district coordinates",
  );
  for (const name of ["timing", "race", "decline", "samePerson"]) {
    await need(
      admin.rpc("system_initialize_booking_offer_queue", {
        p_booking_id: state.bookings[name],
        p_provider_ids: [],
      }),
    );
    await need(
      admin.rpc("system_rotate_booking_offer", {
        p_booking_id: state.bookings[name],
      }),
    );
  }
  save();
  console.log("Fixtures ready; timing starts " + new Date().toISOString());
}
async function snapshot(name) {
  return need(
    admin.rpc("staging_f1_offer_state", { p_booking: state.bookings[name] }),
  );
}
async function signed(provider) {
  const index = state.providers.indexOf(provider),
    user = state.users.find((x) => x.kind === "cleaner" + index);
  const client = createClient(
    secrets.NEXT_PUBLIC_SUPABASE_URL,
    secrets.VISIT_PAYMENTS_GATEWAY_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  await need(
    client.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    }),
  );
  return client;
}
async function test() {
  const timing = await snapshot("timing");
  check(
    timing.offers.filter((x) => x.status === "open").length === 5,
    "First wave offers exactly five cleaners immediately",
  );
  check(
    new Date(timing.run.second_wave_due_at) -
      new Date(timing.run.first_wave_at) ===
      600000,
    "Second wave is scheduled exactly ten minutes after first wave",
  );
  if (Date.now() < new Date(timing.run.second_wave_due_at)) {
    const early = await need(
      admin.rpc("system_rotate_booking_offer", {
        p_booking_id: state.bookings.timing,
      }),
    );
    check(
      early.action === "waiting" &&
        (await snapshot("timing")).offers.length === 5,
      "Wave two never starts early",
    );
  }
  if (!state.raceDone) {
    const race = await snapshot("race"),
      clients = await Promise.all(
        race.offers
          .filter((x) => x.status === "open")
          .map((x) => signed(x.provider_id)),
      );
    const results = await Promise.all(
      clients.map((c) =>
        c.rpc("provider_accept_booking_time", {
          p_booking_id: state.bookings.race,
          p_selected_slot: state.raceSlot,
        }),
      ),
    );
    check(
      results.filter((x) => !x.error).length === 1,
      "Five simultaneous acceptances produce exactly one winner",
    );
    const after = await snapshot("race");
    check(
      after.offers.filter((x) => x.status === "accepted").length === 1 &&
        after.offers.filter((x) => x.status === "lost").length === 4,
      "All competing open offers close in the winning transaction",
    );
    const notices = await need(
      admin
        .from("notifications")
        .select("user_id,title")
        .eq("title", "This job has been taken")
        .in(
          "user_id",
          state.users.map((x) => x.id),
        ),
    );
    check(
      notices.length === 4,
      "Each losing cleaner receives one job-taken notice",
    );
    await need(
      admin.rpc("system_rotate_booking_offer", {
        p_booking_id: state.bookings.race,
      }),
    );
    const repeat = await clients[0].rpc("provider_accept_booking_time", {
      p_booking_id: state.bookings.race,
      p_selected_slot: state.raceSlot,
    });
    check(
      !!repeat.error &&
        (await snapshot("race")).deliveries.filter(
          (x) => x.outcome === "accepted",
        ).length === 1,
      "Acceptance retry cannot assign twice or duplicate notices",
    );
    state.raceDone = true;
    save();
  }
  if (!state.declineDone) {
    const before = await snapshot("decline"),
      provider = before.offers.find((x) => x.status === "open").provider_id,
      client = await signed(provider);
    const result = await need(
      client.rpc("provider_decline_booking_offer", {
        p_booking_id: state.bookings.decline,
      }),
    );
    check(result.declined, "Offered cleaner can decline");
    const rotate = await need(
      admin.rpc("system_rotate_booking_offer", {
        p_booking_id: state.bookings.decline,
      }),
    );
    const after = await snapshot("decline");
    check(
      rotate.action === "waiting" &&
        after.offers.filter((x) => x.status === "open").length === 4,
      "Decline keeps other first-wave offers open and does not advance wave two",
    );
    const accept = await client.rpc("provider_accept_booking_time", {
      p_booking_id: state.bookings.decline,
      p_selected_slot: state.declineSlot,
    });
    check(!!accept.error, "Declined cleaner cannot accept their closed offer");
    const direct = await client
      .from("booking_offers")
      .update({ status: "open" })
      .eq("booking_id", state.bookings.decline)
      .eq("provider_id", provider);
    check(
      !!direct.error,
      "Cleaner cannot reopen an offer by direct table update",
    );
    state.declineDone = true;
    save();
  }
  const ownRanks = await need(
    admin.rpc("system_booking_offer_ranking", {
      p_booking_id: state.bookings.samePerson,
    }),
  );
  check(
    !ownRanks.some((x) => x.provider_id === state.providers[0]),
    "Cleaner is never offered their own customer booking",
  );
  const outsider = await signed(
    state.providers.find(
      (id) => !timing.offers.some((x) => x.provider_id === id),
    ),
  );
  const blocked = await outsider.rpc("provider_accept_booking_time", {
    p_booking_id: state.bookings.timing,
    p_selected_slot: state.timingSlot,
  });
  check(
    !!blocked.error,
    "Qualified cleaner without a first-wave offer cannot jump the queue",
  );
  const hidden = await outsider.from("job_offer_settings").select("*");
  check(
    !!hidden.error,
    "Provider cannot read private settings or ranking tables",
  );
  console.log("Second-wave due at " + timing.run.second_wave_due_at);
}
async function wave2() {
  const before = await snapshot("timing");
  if (Date.now() < new Date(before.run.second_wave_due_at))
    throw Error(
      "Real ten-minute timer not due yet: " + before.run.second_wave_due_at,
    );
  // Let the installed database timer perform this release, rather than manually advancing it.
  const after = await snapshot("timing");
  check(
    !!after.run.second_wave_at,
    "Permanent database scheduler releases wave two",
  );
  check(
    new Date(after.run.second_wave_at) >=
      new Date(after.run.second_wave_due_at),
    "Actual second wave started no earlier than ten minutes",
  );
  check(
    after.deliveries.filter((x) => x.wave === 2).length === 3 &&
      after.offers.filter((x) => x.status === "open").length === 8,
    "Wave two offers every remaining qualified cleaner and keeps first wave open",
  );
  const count = after.deliveries.length;
  await need(
    admin.rpc("system_rotate_booking_offer", {
      p_booking_id: state.bookings.timing,
    }),
  );
  check(
    (await snapshot("timing")).deliveries.length === count,
    "Scheduler and request retries cannot duplicate wave deliveries",
  );
  const declined = await snapshot("decline");
  check(
    declined.offers.filter((x) => x.status === "declined").length === 1 &&
      declined.offers.filter((x) => x.status === "open").length === 7,
    "Second wave does not reopen declined offers",
  );
  check(
    after.cron.active &&
      after.cron.schedule === "* * * * *" &&
      Date.now() - new Date(after.runtime.last_scheduler_at) < 90000,
    "Permanent one-minute scheduler heartbeat is current",
  );
  state.schedulerProof = {
    firstWaveAt: after.run.first_wave_at,
    dueAt: after.run.second_wave_due_at,
    secondWaveAt: after.run.second_wave_at,
    heartbeat: after.runtime.last_scheduler_at,
  };
  save();
}
async function guards() {
  if (state.clash)
    await need(
      admin.rpc("system_reschedule_booking", {
        p_booking_id: state.clash,
        p_new_slot: new Date(
          new Date(state.eligibilitySlot).getTime() + 4 * 3600000,
        ).toISOString(),
        p_reason: "F1 synthetic clash isolation",
        p_meta: {},
      }),
    );
  const booking = state.bookings.eligibility,
    provider = state.providers[0];
  const ranked = () =>
    need(admin.rpc("system_booking_offer_ranking", { p_booking_id: booking }));
  const absent = async (label) =>
    check(!(await ranked()).some((row) => row.provider_id === provider), label);
  const approval = {
    vetting_status: "approved",
    dbs_verified: true,
    is_suspended: false,
    service_approvals: { cleaning: "approved" },
  };
  await need(
    admin
      .from("providers")
      .update({ service_approvals: { cleaning: "suspended" } })
      .eq("id", provider),
  );
  await absent("Per-service suspension excludes a cleaner from ranking");
  await need(admin.from("providers").update(approval).eq("id", provider));
  await need(
    admin.from("providers").update({ is_suspended: true }).eq("id", provider),
  );
  await absent("Global suspension excludes a cleaner");
  await need(admin.from("providers").update(approval).eq("id", provider));
  const documents = await need(
    admin
      .from("provider_verification_items")
      .select("document_type,expires_at")
      .eq("provider_id", provider),
  );
  for (const type of ["right_to_work", "public_liability_insurance"]) {
    await need(
      admin
        .from("provider_verification_items")
        .update({ expires_at: "2020-01-01" })
        .eq("provider_id", provider)
        .eq("document_type", type),
    );
    await absent("Expired " + type + " blocks new offers");
    await need(
      admin
        .from("provider_verification_items")
        .update({
          expires_at: documents.find((x) => x.document_type === type)
            .expires_at,
        })
        .eq("provider_id", provider)
        .eq("document_type", type),
    );
    await need(admin.from("providers").update(approval).eq("id", provider));
  }
  const staleDbs = await admin
    .from("provider_dbs_checks")
    .update({ issue_date: "2020-01-01" })
    .eq("provider_id", provider);
  check(
    !!staleDbs.error,
    "Administrator cannot mark an expired DBS certificate current",
  );
  const futureBlock = await need(
    admin.rpc("professional_verification_block", {
      p_provider_id: provider,
      p_today: new Date(Date.now() + 367 * 86400000).toISOString().slice(0, 10),
    }),
  );
  check(
    /DBS/i.test(futureBlock),
    "DBS expiry is evaluated with the passage of time",
  );
  await need(
    admin
      .from("provider_profile_settings")
      .update({ coverage_postcodes: ["ZE3"] })
      .eq("provider_id", provider),
  );
  await absent("Saved coverage narrows the service area");
  await need(
    admin
      .from("provider_profile_settings")
      .update({ coverage_postcodes: ["ZE1"] })
      .eq("provider_id", provider),
  );
  await need(
    admin
      .from("provider_availability")
      .update({ start_time: "16:00", end_time: "20:00" })
      .eq("provider_id", provider),
  );
  await absent("Jobs outside published working hours are excluded");
  await need(
    admin
      .from("provider_availability")
      .update({ start_time: "07:00", end_time: "20:00" })
      .eq("provider_id", provider),
  );
  if (!state.timeOff) {
    state.timeOff = (
      await need(
        admin
          .from("provider_time_off")
          .insert({
            provider_id: provider,
            starts_at: state.eligibilitySlot,
            ends_at: new Date(
              new Date(state.eligibilitySlot).getTime() + 3 * 3600000,
            ).toISOString(),
            note: "F1 SYNTHETIC TEST ONLY",
          })
          .select("id")
          .single(),
      )
    ).id;
    save();
  }
  await need(
    admin
      .from("provider_time_off")
      .update({
        starts_at: state.eligibilitySlot,
        ends_at: new Date(
          new Date(state.eligibilitySlot).getTime() + 3 * 3600000,
        ).toISOString(),
      })
      .eq("id", state.timeOff),
  );
  await absent("Time off excludes overlapping visits");
  // Keep the test record, but move its synthetic absence beyond the visit.
  await need(
    admin
      .from("provider_time_off")
      .update({
        starts_at: new Date(
          new Date(state.eligibilitySlot).getTime() + 86400000,
        ).toISOString(),
        ends_at: new Date(
          new Date(state.eligibilitySlot).getTime() + 90000000,
        ).toISOString(),
      })
      .eq("id", state.timeOff),
  );
  check(
    (await ranked()).some((x) => x.provider_id === provider),
    "Restoring eligible checks, coverage and hours restores matching",
  );
  if (!state.clash) {
    state.clash = (
      await need(
        admin
          .from("bookings")
          .insert({
            customer_id: state.users.find((x) => x.kind === "customer").id,
            provider_id: provider,
            package_id: state.package,
            scheduled_at: state.eligibilitySlot,
            duration_minutes: 120,
            status: "scheduled",
            address: "[TEST ONLY F1] Fictional Place, ZE1 0AA",
            household_notes: "F1 SYNTHETIC TEST ONLY calendar clash",
            customer_email: null,
          })
          .select("id")
          .single(),
      )
    ).id;
    save();
  }
  await need(
    admin.rpc("system_reschedule_booking", {
      p_booking_id: state.clash,
      p_new_slot: state.eligibilitySlot,
      p_reason: "F1 synthetic overlap test",
      p_meta: {},
    }),
  );
  await absent("Shared calendar prevents an overlapping cleaning assignment");
  const noStripe = await need(
    admin
      .from("payments")
      .select("id")
      .in("booking_id", Object.values(state.bookings)),
  );
  check(
    noStripe.length === 0,
    "F1 integration tests create no payments or financial operations",
  );
}

if (process.argv.includes("--seed")) await seed();
if (process.argv.includes("--test")) await test();
if (process.argv.includes("--wave2")) await wave2();
if (process.argv.includes("--guards")) await guards();
