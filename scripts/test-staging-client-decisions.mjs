import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
const secrets = JSON.parse(
  readFileSync(".local-secrets/staging-api.json", "utf8"),
);
const url = secrets.NEXT_PUBLIC_SUPABASE_URL,
  anon = secrets.VISIT_PAYMENTS_GATEWAY_ANON_KEY;
if (
  url !== "https://comwdjprdedmsnxtvuuk.supabase.co" ||
  !secrets.STRIPE_SECRET_KEY.startsWith("sk_test_")
)
  throw new Error("Staging isolation required");
const admin = createClient(url, secrets.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const statePath = ".local-secrets/client-decisions-fixtures.json";
const resultsPath = "artifacts/client-decisions-live-results.json";
let state;
try {
  state = JSON.parse(readFileSync(statePath, "utf8"));
} catch {
  state = {
    run: Date.now().toString(36),
    users: {},
    bookings: {},
    results: [],
  };
}
const save = () => {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  writeFileSync(
    resultsPath,
    JSON.stringify({ run: state.run, checks: state.results }, null, 2),
  );
};
const ok = (condition, label) => {
  if (!condition) throw new Error(label);
  state.results.push({ check: label, passed: true });
  save();
  console.log("PASS " + label);
};
async function checked(query, label) {
  const r = await query;
  if (r.error) throw new Error(label + ": " + r.error.message);
  return r.data;
}
async function person(kind, role = "customer") {
  if (state.users[kind]) return state.users[kind];
  const password = randomBytes(24).toString("base64url") + "aA9!",
    email = `qa-decisions-${state.run}-${kind}@example.invalid`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `[TEST ONLY] Decisions ${kind}` },
  });
  if (created.error)
    throw new Error("Create new fixture: " + created.error.message);
  const user = { id: created.data.user.id, email, password };
  state.users[kind] = user;
  save();
  await checked(
    admin
      .from("profiles")
      .upsert({
        id: user.id,
        email,
        full_name: `[TEST ONLY] Decisions ${kind}`,
        phone: "+442079460958",
        role,
      }),
    "Create fixture profile",
  );
  return user;
}
async function signed(user) {
  const jar = new Map();
  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const item of items) jar.set(item.name, item.value);
      },
    },
  });
  const r = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (r.error) throw new Error("Fixture sign-in failed");
  return {
    client,
    session: r.data.session,
    cookie: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
  };
}
async function seed() {
  await person("staff", "admin");
  await person("customer");
  await person("other");
  await person("worker", "provider");
  const user = state.users.worker;
  if (!state.provider) {
    state.provider = (
      await checked(
        admin
          .from("providers")
          .insert({
            profile_id: user.id,
            display_name: "[TEST ONLY] Contact privacy fixture",
            services: ["cleaning"],
            vetting_status: "pending",
            show_on_our_pros: false,
          })
          .select("id")
          .single(),
        "Create fixture professional",
      )
    ).id;
    save();
  }
  const provider = state.provider,
    today = new Date().toISOString().slice(0, 10),
    expiry = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const pdf = Buffer.from(
    "%PDF-1.4\n% FICTIONAL STAGING TEST ONLY - NOT EVIDENCE\n%%EOF",
  );
  async function file(bucket, path) {
    const r = await admin.storage
      .from(bucket)
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (r.error) throw new Error("Fixture upload failed");
  }
  if (!state.dbs) {
    const path = `${provider}/fictional-dbs.pdf`;
    await file("provider-dbs", path);
    await checked(
      admin
        .from("provider_dbs_checks")
        .upsert({
          provider_id: provider,
          certificate_number: String(Date.now()).slice(-12),
          issue_date: today,
          status: "verified",
          certificate_storage_path: path,
          certificate_original_name: "FICTIONAL-TEST-ONLY.pdf",
          certificate_mime_type: "application/pdf",
          uploaded_at: new Date().toISOString(),
        }),
      "Create fictional DBS fixture",
    );
    state.dbs = true;
    save();
  }
  for (const type of ["right_to_work", "photo_id"]) {
    if (state[type]) continue;
    const path = `${provider}/${type}/FICTIONAL-TEST-ONLY.pdf`;
    await file("provider-verification", path);
    await checked(
      admin
        .from("provider_verification_items")
        .upsert(
          {
            provider_id: provider,
            document_type: type,
            label: type,
            status: "verified",
            reference:
              type === "right_to_work"
                ? "TST" + state.run.slice(-6).toUpperCase()
                : null,
            issued_at: today,
            expires_at: expiry,
            gov_uk_checked_on: type === "right_to_work" ? today : null,
            uploaded_at: new Date().toISOString(),
            document_storage_path: path,
            document_original_name: "FICTIONAL-TEST-ONLY.pdf",
            document_mime_type: "application/pdf",
          },
          { onConflict: "provider_id,document_type" },
        ),
      "Create fictional " + type,
    );
    state[type] = true;
    save();
  }
  const staff = await signed(state.users.staff);
  if (!state.approved) {
    let reason = await admin.rpc("professional_verification_block", {
      p_provider_id: provider,
    });
    ok(
      !reason.error && /insurance/.test(reason.data),
      "Cleaner without insurance is blocked",
    );
    let approve = await staff.client.rpc("review_professional_service", {
      p_provider: provider,
      p_service: "cleaning",
      p_status: "approved",
    });
    ok(!!approve.error, "Admin cannot approve uninsured cleaner");
    for (const type of ["public_liability_insurance", "proof_of_address"]) {
      const path = `${provider}/${type}/FICTIONAL-TEST-ONLY.pdf`;
      await file("provider-verification", path);
      await checked(
        admin
          .from("provider_verification_items")
          .upsert(
            {
              provider_id: provider,
              document_type: type,
              label: type,
              status: "verified",
              issued_at: today,
              expires_at: type === "public_liability_insurance" ? expiry : null,
              uploaded_at: new Date().toISOString(),
              document_storage_path: path,
              document_original_name: "FICTIONAL-TEST-ONLY.pdf",
              document_mime_type: "application/pdf",
            },
            { onConflict: "provider_id,document_type" },
          ),
        "Create fictional " + type,
      );
    }
    reason = await admin.rpc("professional_verification_block", {
      p_provider_id: provider,
    });
    ok(
      !reason.error && reason.data === null,
      "Verified insurance and proof of address clear the document block",
    );
    await checked(
      staff.client.rpc("review_professional_service", {
        p_provider: provider,
        p_service: "cleaning",
        p_status: "approved",
      }),
      "Approve fictional fixture",
    );
    state.approved = true;
    save();
  }
  if (!state.hours) {
    await checked(
      admin
        .from("provider_availability")
        .insert(
          Array.from({ length: 7 }, (_, weekday) => ({
            provider_id: provider,
            weekday,
            start_time: "07:00",
            end_time: "20:00",
          })),
        ),
      "Create fictional hours",
    );
    state.hours = true;
    save();
  }
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hourCycle: "h23",
  });
  let recentTime = Math.floor((Date.now() - 3 * 3600000) / 1800000) * 1800000;
  while (
    Number(clock.format(new Date(recentTime))) < 7 ||
    Number(clock.format(new Date(recentTime))) > 17
  )
    recentTime -= 1800000;
  const future = new Date(Date.now() + 72 * 3600000);
  future.setUTCHours(10, 0, 0, 0);
  const fixtureTime = {
    active: future.toISOString(),
    unaccepted: future.toISOString(),
    recent: new Date(recentTime).toISOString(),
    closed: new Date(recentTime - 48 * 3600000).toISOString(),
  };
  const pkg = (
    await checked(
      admin
        .from("packages")
        .select("id")
        .ilike("service_type", "%clean%")
        .limit(1),
      "Load test package",
    )
  )[0];
  if (!pkg) throw new Error("No staging cleaning package");
  for (const [name, hours, status, assigned] of [
    ["active", 72, "scheduled", true],
    ["recent", -5, "completed", true],
    ["closed", -28, "completed", true],
    ["unaccepted", 72, "offered", false],
  ]) {
    if (state.bookings[name]) continue;
    const row = await checked(
      admin
        .from("bookings")
        .insert({
          customer_id: state.users.customer.id,
          provider_id: assigned ? provider : null,
          package_id: pkg.id,
          scheduled_at: fixtureTime[name],
          duration_minutes: 120,
          status,
          address: "FICTIONAL TEST ADDRESS, EC1V 2NX",
          household_notes: "FICTIONAL TEST NOTES",
          customer_email: state.users.customer.email,
        })
        .select("id")
        .single(),
      "Create " + name + " fixture booking",
    );
    state.bookings[name] = row.id;
    save();
  }
  console.log("Fictional staging fixtures ready");
}
async function database() {
  const worker = await signed(state.users.worker),
    customer = await signed(state.users.customer),
    outsider = await signed(state.users.other),
    staff = await signed(state.users.staff),
    b = state.bookings;
  const active = await worker.client.rpc("booking_customer_summary", {
    p_booking_id: b.active,
  });
  ok(
    !active.error && active.data?.[0]?.phone === null,
    "Assigned cleaner cannot retrieve customer phone",
  );
  const rows = await worker.client
    .rpc("worker_visible_bookings")
    .select(
      "id,address,household_notes,customer_email,access_instructions,packages(name),check_ins(left_at)",
    )
    .in("id", Object.values(b));
  ok(
    !rows.error && Array.isArray(rows.data),
    "Safe booking history retains package and check-in relationships",
  );
  for (const id of [b.recent, b.closed]) {
    const row = rows.data.find((r) => r.id === id);
    ok(
      row &&
        row.address === null &&
        row.household_notes === null &&
        row.customer_email === null &&
        row.access_instructions === null,
      "Historical address/contact data is masked: " +
        (id === b.recent ? "recent" : "closed"),
    );
    const raw = await worker.client
      .from("bookings")
      .select("address")
      .eq("id", id);
    ok(
      !raw.error && raw.data.length === 0,
      "Direct history request cannot bypass address privacy: " +
        (id === b.recent ? "recent" : "closed"),
    );
  }
  const phones = await worker.client
    .from("profiles")
    .select("phone")
    .eq("id", state.users.customer.id);
  ok(
    !phones.error && phones.data.length === 0,
    "Worker cannot directly read customer profile phone",
  );
  const scores = await customer.client
    .from("profiles")
    .select("client_rating_avg,client_rating_count")
    .eq("id", state.users.customer.id);
  ok(!!scores.error, "Customer cannot retrieve internal customer score");
  for (const [key, expected] of [
    ["active", true],
    ["recent", true],
    ["closed", false],
    ["unaccepted", false],
  ]) {
    const r = await worker.client.rpc("booking_messaging_open", {
      p_booking_id: b[key],
    });
    ok(
      !r.error && r.data === expected,
      "Messaging window " + key + " is " + expected,
    );
  }
  const privateState = await outsider.client.rpc("booking_contact_state", {
    p_booking_id: b.active,
  });
  ok(
    !privateState.error && privateState.data === null,
    "Contact timing is unavailable to an unrelated account",
  );
  const sent = await worker.client.rpc("send_booking_message", {
    p_booking_id: b.recent,
    p_body: "Fictional QA follow-up message",
  });
  ok(
    !sent.error && sent.data?.ok === true,
    "In-app message works within 24h after visit",
  );
  const denied = await worker.client.rpc("send_booking_message", {
    p_booking_id: b.closed,
    p_body: "Fictional late message",
  });
  ok(!!denied.error, "Sending after 24h is denied by the database");
  const phone = await worker.client.rpc("send_booking_message", {
    p_booking_id: b.active,
    p_body: "Call 07700 900111",
  });
  ok(
    !phone.error && phone.data?.blocked === true,
    "In-app phone-number sharing is blocked",
  );
  const rawUpdate = await customer.client
    .from("profiles")
    .update({ full_name: "BYPASS SHOULD FAIL" })
    .eq("id", state.users.customer.id)
    .select("id");
  ok(
    !!rawUpdate.error || rawUpdate.data.length === 0,
    "Direct profile writes cannot bypass account verification",
  );
  const review = await worker.client
    .from("reviews")
    .insert({
      booking_id: b.recent,
      reviewer: "provider",
      rating: 3,
      comment: "FICTIONAL INTERNAL QA FEEDBACK",
      visibility: "public",
    });
  ok(!review.error, "Cleaner can submit internal feedback after completion");
  for (const [name, c] of [
    ["customer", customer.client],
    ["unrelated account", outsider.client],
  ]) {
    const r = await c
      .from("reviews")
      .select("comment")
      .eq("booking_id", b.recent)
      .eq("reviewer", "provider");
    ok(
      !r.error && r.data.length === 0,
      "Provider feedback is hidden from " + name,
    );
  }
  const adminRead = await staff.client
    .from("reviews")
    .select("comment,visibility")
    .eq("booking_id", b.recent)
    .eq("reviewer", "provider");
  ok(
    !adminRead.error && adminRead.data?.[0]?.visibility === "private",
    "Admin can read forced-private customer feedback",
  );
  const strangerRpc = await outsider.client.rpc("admin_customer_profiles");
  ok(
    !strangerRpc.error && strangerRpc.data.length === 0,
    "Customer admin-only profile RPC returns no records",
  );
  console.log("Database contact, feedback and verification guards passed");
}

async function web() {
  const root = process.env.CLIENT_DECISIONS_TEST_URL ?? "http://localhost:3127";
  const host = new URL(root);
  if (
    host.origin !== "http://localhost:3127" &&
    host.origin !==
      "https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app"
  )
    throw new Error(
      "Only local staging or the named staging Preview may be tested",
    );
  const bypass =
    host.protocol === "https:"
      ? JSON.parse(
          readFileSync(".local-secrets/staging-webhook-access.json", "utf8"),
        ).vercelAutomationBypassSecret
      : null;
  const customer = await signed(state.users.customer),
    other = await signed(state.users.other),
    staff = await signed(state.users.staff),
    worker = await signed(state.users.worker);
  async function request(path, who, method = "GET", body, proof) {
    const headers = { Origin: host.origin };
    if (who) headers.Cookie = who.cookie();
    if (bypass) headers["x-vercel-protection-bypass"] = bypass;
    if (proof) headers["x-account-change-proof"] = proof;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(new URL(path, root), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const value = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : await response.text();
    return { status: response.status, value };
  }
  let r = await request("/api/visit-billing-config");
  ok(
    r.status === 200 && r.value.perVisitBilling === true,
    "Staging uses the per-visit configuration",
  );
  r = await request("/api/handyman/config");
  ok(
    r.status === 200 && r.value.enabled === false,
    "Marketplace remains switched off on the tested staging build",
  );
  r = await request("/api/admin/professional-onboarding", customer, "POST", {});
  ok(r.status === 403, "Customers cannot create professional invitations");
  r = await request(
    "/api/admin/previous-customer-reviews",
    customer,
    "POST",
    {},
  );
  ok(r.status === 403, "Customers cannot invite or moderate past reviews");
  r = await request("/api/client-signup", null, "POST", {
    fullName: "FICTIONAL PHONE VALIDATION",
    email: "no-create-phone@example.invalid",
    password: "NotCreated123!",
    phone: "",
    consentAccepted: true,
  });
  ok(
    r.status === 400 && /phone/i.test(r.value.error),
    "Customer sign-up without phone is rejected before account creation",
  );
  const body = {
    profile: {
      firstName: "QA Verified",
      lastName: "Customer",
      phone: "+442079460958",
    },
  };
  r = await request("/api/account/profile", customer, "PATCH", body);
  ok(
    r.status === 428 && r.value.verificationRequired === true,
    "Account details cannot change without a one-time proof",
  );
  const hash = r.value.requestHash;
  const mail = await request("/api/account/change-code", customer, "POST", {
    action: "send",
    requestHash: hash,
  });
  ok(
    mail.status === 503,
    "Unavailable email delivery fails closed without changing details",
  );
  const sid = JSON.parse(
    Buffer.from(
      customer.session.access_token.split(".")[1],
      "base64url",
    ).toString(),
  ).session_id;
  const hmac = (value) =>
    createHmac("sha256", secrets.SUPABASE_SERVICE_ROLE_KEY)
      .update(value)
      .digest("hex");
  await checked(
    admin
      .from("account_change_challenges")
      .update({ created_at: new Date(Date.now() - 7200000).toISOString() })
      .eq("user_id", state.users.customer.id),
    "Age only this run simulated-delivery fixtures",
  );
  const code = "742629";
  const created = await checked(
    admin.rpc("start_account_change", {
      p_user: state.users.customer.id,
      p_session: sid,
      p_hash: hash,
      p_code: hmac(state.users.customer.id + ":" + code),
      p_channel: "email",
    }),
    "Create simulated-delivery challenge",
  );
  await checked(
    admin
      .from("account_change_challenges")
      .update({ sent: true })
      .eq("id", created),
    "Mark simulated delivery",
  );
  r = await request("/api/account/change-code", customer, "POST", {
    action: "verify",
    id: created,
    code: "000000",
  });
  ok(r.status === 400, "Incorrect account-change code is rejected");
  r = await request("/api/account/change-code", other, "POST", {
    action: "verify",
    id: created,
    code,
  });
  ok(r.status === 400, "Verification code cannot be used by another account");
  r = await request("/api/account/change-code", customer, "POST", {
    action: "verify",
    id: created,
    code,
  });
  ok(
    r.status === 200 && typeof r.value.proof === "string",
    "Correct simulated-delivery code produces a single-use proof",
  );
  const proof = r.value.proof;
  r = await request(
    "/api/account/profile",
    customer,
    "PATCH",
    { profile: { firstName: "Tampered" } },
    proof,
  );
  ok(
    r.status === 428,
    "Changing the requested account fields invalidates the proof",
  );
  r = await request("/api/account/profile", customer, "PATCH", body, proof);
  ok(r.status === 200, "Verified account detail update succeeds once");
  r = await request("/api/account/profile", customer, "PATCH", body, proof);
  ok(r.status === 428, "Account change proof cannot be replayed");
  r = await request("/api/account/profile", customer);
  ok(
    r.status === 200 && !("clientRating" in r.value.profile),
    "Account profile does not expose internal customer ratings",
  );
  r = await request("/api/account/reviews", customer);
  ok(
    r.status === 200 && r.value.received.length === 0,
    "Customer account API does not return cleaner feedback",
  );
  const otherSid = JSON.parse(
    Buffer.from(
      other.session.access_token.split(".")[1],
      "base64url",
    ).toString(),
  ).session_id;
  const expired = randomUUID();
  await checked(
    admin
      .from("account_change_challenges")
      .insert({
        id: expired,
        user_id: state.users.other.id,
        session_id: otherSid,
        request_hash: hash,
        code_hash: hmac(state.users.other.id + ":" + code),
        channel: "email",
        sent: true,
        expires_at: new Date(Date.now() - 86400000).toISOString(),
      }),
    "Create expired fictional challenge",
  );
  r = await request("/api/account/change-code", other, "POST", {
    action: "verify",
    id: expired,
    code,
  });
  ok(r.status === 400, "Expired verification code is rejected");
  const brute = randomUUID();
  await checked(
    admin
      .from("account_change_challenges")
      .insert({
        id: brute,
        user_id: state.users.other.id,
        session_id: otherSid,
        request_hash: hash,
        code_hash: hmac(state.users.other.id + ":" + code),
        channel: "email",
        sent: true,
      }),
    "Create attempt-limit fixture",
  );
  for (let i = 0; i < 5; i++)
    await request("/api/account/change-code", other, "POST", {
      action: "verify",
      id: brute,
      code: "000000",
    });
  r = await request("/api/account/change-code", other, "POST", {
    action: "verify",
    id: brute,
    code,
  });
  ok(
    r.status === 400,
    "Five wrong attempts permanently exhaust that challenge",
  );
  r = await request("/api/account/worker-profile", worker);
  ok(
    r.status === 200 &&
      r.value.verification.some((x) => x.type === "proof_of_address") &&
      r.value.verification.some(
        (x) => x.type === "public_liability_insurance",
      ) &&
      !("vatNumber" in r.value.tax),
    "Cleaner profile has insurance/address documents and UTR without VAT",
  );
  // A previous customer's link is the only public submission authority. Email is explicitly unavailable in this run.
  r = await request("/api/admin/previous-customer-reviews", staff, "POST", {
    name: "[TEST ONLY] Previous customer",
    email: "fictional-previous-" + state.run + "@example.invalid",
    service: "Cleaning",
  });
  ok(
    r.status === 200 &&
      r.value.sent === false &&
      typeof r.value.link === "string",
    "Admin creates a private previous-customer review link with honest email status",
  );
  const token = new URL(r.value.link).searchParams.get("token");
  state.previousReview = (
    await checked(
      admin
        .from("previous_customer_reviews")
        .select("id")
        .eq("token_hash", createHash("sha256").update(token).digest("hex"))
        .single(),
      "Find fictional review",
    )
  ).id;
  save();
  r = await request("/api/reviews/previous", null, "POST", {
    token,
    rating: 4,
    comment: "FICTIONAL TEST REVIEW - NOT A CUSTOMER EXPERIENCE",
  });
  ok(r.status === 200, "Past review submits once for moderation");
  r = await request("/api/reviews/previous", null, "POST", {
    token,
    rating: 5,
    comment: "Replay must fail",
  });
  ok(r.status === 409, "Past review submission cannot be replayed or edited");
  const anonymous = createClient(url, anon, {
    auth: { persistSession: false },
  });
  let feed = await anonymous.rpc("previous_customer_review_feed");
  ok(
    !feed.error && !feed.data.some((x) => x.id === state.previousReview),
    "Unapproved previous-customer review is not public",
  );
  const edit = await admin
    .from("previous_customer_reviews")
    .update({ rating: 5, comment: "Must never replace the submitted words" })
    .eq("id", state.previousReview);
  ok(!!edit.error, "Even a privileged edit cannot change a submitted review");
  const aggregateBefore = await checked(
    anonymous.from("reviews").select("id,rating").eq("reviewer", "client"),
    "Read public booking review aggregate",
  );
  r = await request("/api/admin/previous-customer-reviews", staff, "POST", {
    action: "moderate",
    id: state.previousReview,
    status: "approved",
  });
  ok(r.status === 200, "Admin approval publishes a past review");
  feed = await anonymous.rpc("previous_customer_review_feed");
  ok(
    !feed.error &&
      feed.data.some((x) => x.id === state.previousReview && x.rating === 4),
    "Approved past review retains the original rating and words",
  );
  const page = await request("/reviews");
  ok(
    page.status === 200 && page.value.includes("Previous customer"),
    "Public page labels a past review as Previous customer",
  );
  const aggregateAfter = await checked(
    anonymous.from("reviews").select("id,rating").eq("reviewer", "client"),
    "Read unchanged booking review aggregate",
  );
  ok(
    JSON.stringify(aggregateBefore) === JSON.stringify(aggregateAfter),
    "Past reviews do not enter booking star-rating data",
  );
  await checked(
    admin
      .from("previous_customer_reviews")
      .update({ status: "rejected" })
      .eq("id", state.previousReview),
    "Hide fictional published review immediately",
  );
  // Invited professionals remain pending and hidden. No real person is invited.
  r = await request("/api/admin/professional-onboarding", staff, "POST", {
    name: "[TEST ONLY] Invited professional",
    email: "fictional-invite-" + state.run + "@example.invalid",
    phone: "+442079460959",
    services: ["cleaning"],
  });
  ok(
    r.status === 200 && r.value.sent === false && r.value.providerId,
    "Admin can create a pending professional while setup email is unavailable",
  );
  state.invitedProvider = r.value.providerId;
  const invited = await checked(
    admin
      .from("providers")
      .select("profile_id,vetting_status,show_on_our_pros,service_approvals")
      .eq("id", state.invitedProvider)
      .single(),
    "Inspect fictional invite",
  );
  state.users.invited = {
    id: invited.profile_id,
    email: "fictional-invite-" + state.run + "@example.invalid",
  };
  save();
  ok(
    invited.vetting_status === "pending" &&
      !invited.show_on_our_pros &&
      invited.service_approvals.cleaning === "pending",
    "Invitation grants no approval or public listing",
  );
  const approval = await staff.client.rpc("review_professional_service", {
    p_provider: state.invitedProvider,
    p_service: "cleaning",
    p_status: "approved",
  });
  ok(
    !!approval.error,
    "An invited placeholder cannot bypass professional setup and verification",
  );
  const publicPages = ["/", "/services/cleaning", "/services/handyman"];
  for (const path of publicPages) {
    r = await request(path);
    ok(
      r.status === 200 && !r.value.includes("opulencebliss@gmail.com"),
      "Public business contact uses hello address: " + path,
    );
  }
  r = await request("/api/ai/booking");
  const serialized = JSON.stringify(r.value);
  ok(
    r.status === 200 &&
      !/"(?:price|hourly_rate|total_gbp|due_now_gbp)"/.test(serialized),
    "Assistant booking choices contain no price fields",
  );
  r = await request("/services/cleaning");
  ok(
    r.status === 200 &&
      r.value.includes("Cleaning contracts") &&
      r.value.includes("restaurants") &&
      r.value.includes("schools") &&
      r.value.includes("event halls"),
    "Cleaning contracts include all requested premises",
  );
  console.log("HTTP account, onboarding, reviews and content checks passed");
}
async function cleanup() {
  for (const user of Object.values(state.users)) {
    await checked(
      admin
        .from("profiles")
        .update({ account_deleted_at: new Date().toISOString() })
        .eq("id", user.id),
      "Disable fictional profile",
    );
    await admin.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
  }
  if (state.provider)
    await admin
      .from("providers")
      .update({ is_suspended: true, show_on_our_pros: false })
      .eq("id", state.provider);
  if (state.previousReview)
    await admin
      .from("previous_customer_reviews")
      .update({ status: "rejected" })
      .eq("id", state.previousReview);
  state.cleaned = true;
  save();
  console.log(
    "All new fictional fixtures disabled and hidden; existing accounts untouched",
  );
}
try {
  if (process.argv.includes("--seed")) await seed();
  if (process.argv.includes("--database")) await database();
  if (process.argv.includes("--web")) await web();
  if (process.argv.includes("--cleanup")) await cleanup();
} catch (error) {
  save();
  console.error(
    "FAILED: " +
      (error instanceof Error ? error.message : "Unknown test failure"),
  );
  process.exitCode = 1;
}
