import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { PDFDocument } from "pdf-lib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const native = createRequire(import.meta.url);
const { NextResponse } = native("next/server");
function loader(mocks = {}, env = {}, transport = fetch) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const loaded = { exports: {} };
    cache.set(file, loaded.exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    // Use the same realm as pdf-lib (its runtime checks use instanceof Array).
    const run = vm.runInThisContext(
      `(function(module,exports,require,process,fetch){${code}\n})`,
    );
    run(
      loaded,
      loaded.exports,
      (id) => {
        if (id in mocks) return mocks[id];
        if (id === "server-only") return {};
        if (id.startsWith("@/lib/")) return load(`lib/${id.slice(6)}.ts`);
        if (id.endsWith(".json"))
          return JSON.parse(readFileSync(`lib/${id.slice(2)}`, "utf8"));
        if (id.startsWith("./")) return load(`lib/${id.slice(2)}.ts`);
        return native(id);
      },
      { env, cwd: () => process.cwd() },
      transport,
    );
    return loaded.exports;
  }
  return load;
}
const load = loader();
const evidence = load("lib/bookingLegalEvidence.ts");
const pdf = load("lib/bookingLegalPdf.ts");
const policy = load("lib/checkoutLegal.ts");
const documents = ["terms", "cancellation-refund", "privacy"].map((slug) => ({
  slug,
  version: "1.0",
  updatedAt: "2026-10-01T00:00:00Z",
  isFallback: false,
}));
const snapshots = documents.map((document) => {
  const contentHtml = `<h2>${document.slug} fixture</h2><p>Accepted wording &amp; price £22.99. No VAT is charged.</p><p>${"All policy text must remain readable, with no clipped paragraphs. ".repeat(500)}</p><p>END OF ACCEPTED POLICY</p>`;
  return {
    ...document,
    title: document.slug,
    contentHtml,
    sourceContentHtml: contentHtml,
    contentHash: evidence.legalContentHash(contentHtml),
    displayContentHash: evidence.legalContentHash(contentHtml),
  };
});
const contract = {
  id: "11111111-1111-4111-8111-111111111111",
  acceptedAt: "2026-10-23T10:00:00Z",
  documents: snapshots,
  evidence: {
    ...evidence.bookingLegalEvidence(
      documents,
      new Headers({ "user-agent": "Synthetic test browser" }),
      { earlyStart: true, savedCard: true, vercel: false },
    ),
    account: {
      userId: "11111111-1111-4111-8111-111111111112",
      name: "Test Customer",
      email: "tester@example.invalid",
    },
  },
  bookings: [
    {
      id: "11111111-1111-4111-8111-111111111113",
      service: "Essential Clean",
      scheduledAt: "2026-11-01T10:00:00Z",
    },
  ],
};

test("final-pack confirmation uses the exact subject/body and the two accepted original PDFs plus the model form", async () => {
  const approved = JSON.parse(readFileSync("lib/finalLegalPack.json", "utf8"));
  const finalContract = {
    ...contract,
    documents: documents.map((doc) => {
      const original = approved[doc.slug];
      return {
        ...doc,
        title: original.title,
        sourceContentHtml: original.contentHtml,
        contentHtml: original.contentHtml,
        contentHash: evidence.legalContentHash(original.contentHtml),
        displayContentHash: evidence.legalContentHash(original.contentHtml),
        pdfSha256: original.pdfSha256,
        effectiveDate: original.effectiveDate,
      };
    }),
    bookings: contract.bookings.map((booking) => ({
      ...booking,
      hours: 2,
      totalPaidPence: 7698,
    })),
  };
  const { bookingLegalEmailPayload } = load("lib/bookingLegalEmailPayload.ts");
  const payload = await bookingLegalEmailPayload(
    finalContract,
    "tester@example.invalid",
    {
      from: "Opulence Bliss Staging <staging@opulencebliss.com>",
      origin: "https://staging.example.invalid",
    },
  );
  assert.equal(
    payload.subject,
    "Your booking with Opulence Bliss is confirmed",
  );
  assert.match(payload.text, /Hello Test,/);
  assert.match(payload.text, /Total paid: £76\.98\. No VAT is charged\./);
  assert.match(
    payload.text,
    /We encourage you to reschedule rather than cancel\./,
  );
  assert.match(payload.text, /You asked us to start within 14 days/);
  assert.equal(payload.attachments.length, 3);
  for (const slug of ["terms", "cancellation-refund"])
    assert.deepEqual(
      Buffer.from(
        payload.attachments.find((item) => item.filename === `${slug}-v1.0.pdf`)
          .content,
        "base64",
      ),
      readFileSync(`legal-packs/2026-10-01/${slug}.pdf`),
    );
  const form = payload.attachments.find(
    (item) => item.filename === "model-cancellation-form.pdf",
  );
  assert.ok(
    (
      await PDFDocument.load(Buffer.from(form.content, "base64"))
    ).getPageCount() >= 1,
  );
});

test("request evidence uses the trusted host header and shared checkbox wording", () => {
  const result = evidence.bookingLegalEvidence(
    documents,
    new Headers({
      "x-forwarded-for": "203.0.113.1",
      "x-vercel-forwarded-for": "2001:db8::1",
      "user-agent": "Test browser",
    }),
    { earlyStart: true, savedCard: true, vercel: true },
  );
  assert.equal(result.request.ip, "2001:db8::1");
  assert.equal(result.request.userAgent, "Test browser");
  assert.equal(
    result.checkboxes[0].text,
    policy.checkoutLegalConsentText(documents),
  );
  assert.equal(result.checkboxes[2].text, policy.SAVED_CARD_CONSENT_TEXT);
  assert.equal(result.checkboxes.length, 3);
  const local = evidence.bookingLegalEvidence(
    documents,
    new Headers({ "x-vercel-forwarded-for": "203.0.113.1" }),
    { earlyStart: false, savedCard: false, vercel: false },
  );
  assert.equal(local.request.ip, null);
  assert.equal(local.checkboxes.length, 1);
  const invalid = evidence.bookingLegalEvidence(
    documents,
    new Headers({ "x-vercel-forwarded-for": "not-an-ip" }),
    { earlyStart: false, savedCard: false, vercel: true },
  );
  assert.equal(invalid.request.ip, null);
});

test("policy PDFs paginate all accepted text and have stable bytes for retries", async () => {
  const first = await pdf.generateAcceptedPolicyPdf(
    snapshots[0],
    contract.acceptedAt,
  );
  const second = await pdf.generateAcceptedPolicyPdf(
    snapshots[0],
    contract.acceptedAt,
  );
  assert.deepEqual(first, second);
  assert.ok((await PDFDocument.load(first)).getPageCount() > 3);
  assert.ok(
    pdf
      .legalHtmlParagraphs(snapshots[0].contentHtml)
      .at(-1)
      .includes("END OF ACCEPTED POLICY"),
  );
  assert.ok(
    pdf
      .legalHtmlParagraphs(
        "<p>Terms &amp; privacy</p><script>hidden()</script><ul><li>£5</li></ul>",
      )
      .includes("Terms & privacy"),
  );
  assert.ok(
    !pdf
      .legalHtmlParagraphs("<script>hidden()</script><p>Visible</p>")
      .join("")
      .includes("hidden"),
  );
  const combined = await pdf.generateBookingLegalPdf(contract);
  assert.ok((await PDFDocument.load(combined)).getPageCount() > 10);
  const form = await pdf.generateCancellationFormPdf(contract.acceptedAt);
  assert.equal((await PDFDocument.load(form)).getPageCount(), 1);
  if (process.env.LEGAL_PDF_QA_DIR) {
    const { defaultLegalDocument } = load("lib/legalDocuments.ts");
    const actual = documents.map(({ slug }) => {
      const d = defaultLegalDocument(slug);
      return {
        ...d,
        slug,
        isFallback: true,
        sourceContentHtml: d.contentHtml,
        contentHash: evidence.legalContentHash(d.contentHtml),
        displayContentHash: evidence.legalContentHash(d.contentHtml),
      };
    });
    writeFileSync(
      `${process.env.LEGAL_PDF_QA_DIR}/accepted-policies.pdf`,
      await pdf.generateBookingLegalPdf({
        ...contract,
        documents: actual,
        evidence: {
          ...contract.evidence,
          ...evidence.bookingLegalEvidence(actual, new Headers(), {
            earlyStart: true,
            savedCard: true,
            vercel: false,
          }),
        },
      }),
    );
    writeFileSync(
      `${process.env.LEGAL_PDF_QA_DIR}/cancellation-form.pdf`,
      form,
    );
  }
});

test("changed snapshot content cannot be used to regenerate an accepted policy", async () => {
  await assert.rejects(
    async () =>
      pdf.generateAcceptedPolicyPdf(
        { ...snapshots[0], contentHtml: "<p>Changed</p>" },
        contract.acceptedAt,
      ),
    /snapshot/,
  );
});

function emailHarness({
  cached = null,
  enabled = true,
  allowed = true,
  fail = false,
} = {}) {
  const calls = { rpc: [], requests: [] };
  const row = {
    id: "11111111-1111-4111-8111-111111111114",
    claim_token: "token",
    email: "tester@example.invalid",
    contract,
    payload: cached,
  };
  const admin = {
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (name === "claim_booking_legal_emails")
        return { data: args.p_email_ready ? [row] : [] };
      if (name === "store_booking_legal_email_payload")
        return { data: args.p_payload };
      if (name === "finish_booking_legal_email") return { data: true };
      throw Error(`Unexpected RPC ${name}`);
    },
  };
  const env = {
    RESEND_API_KEY: enabled ? "re_test" : undefined,
    BOOKING_EMAIL_FROM: "Opulence Bliss <no-reply@example.invalid>",
    NEXT_PUBLIC_SITE_URL: "https://staging.example.invalid",
    NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    STAGING_EMAIL_RECIPIENTS: allowed ? row.email : "",
  };
  const transport = async (url, init) => {
    calls.requests.push({ url, init });
    return new Response("{}", { status: fail ? 503 : 200 });
  };
  return { calls, admin, env, transport };
}

test("contract mail contains three accepted policies plus a form and uses a persisted request", async () => {
  const h = emailHarness();
  const { deliverBookingLegalEmails } = load("lib/bookingLegalMail.ts");
  const result = await deliverBookingLegalEmails(h.admin, h.env, h.transport);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  const payload = JSON.parse(h.calls.requests[0].init.body);
  assert.equal(payload.attachments.length, 4);
  assert.equal(payload.reply_to, "hello@opulencebliss.com");
  assert.deepEqual(payload.to, ["tester@example.invalid"]);
  for (const attachment of payload.attachments)
    assert.ok(
      (
        await PDFDocument.load(Buffer.from(attachment.content, "base64"))
      ).getPageCount() >= 1,
    );
  assert.equal(
    h.calls.requests[0].init.headers["Idempotency-Key"],
    "booking-legal/11111111-1111-4111-8111-111111111114",
  );
  assert.ok(
    h.calls.rpc.findIndex(
      (x) => x.name === "store_booking_legal_email_payload",
    ) < h.calls.rpc.findIndex((x) => x.name === "finish_booking_legal_email"),
  );
  assert.ok(
    h.calls.rpc.every(
      (x) => !x.name.includes("preference") && !x.name.includes("sms"),
    ),
  );
});

test("unconfigured email and non-allowlisted staging recipients never reach the provider", async () => {
  const { deliverBookingLegalEmails } = load("lib/bookingLegalMail.ts");
  for (const options of [{ enabled: false }, { allowed: false }]) {
    const h = emailHarness(options);
    await deliverBookingLegalEmails(h.admin, h.env, h.transport);
    assert.equal(h.calls.requests.length, 0);
  }
});

test("uncertain retries reuse the saved email bytes and the same idempotency key", async () => {
  const cached = {
    from: "no-reply@example.invalid",
    to: ["tester@example.invalid"],
    subject: "Saved contract",
    text: "Saved exact wording",
    attachments: [],
  };
  const h = emailHarness({ cached, fail: true });
  const { deliverBookingLegalEmails } = load("lib/bookingLegalMail.ts");
  const result = await deliverBookingLegalEmails(h.admin, h.env, h.transport);
  assert.equal(result.failed, 1);
  assert.deepEqual(JSON.parse(h.calls.requests[0].init.body), cached);
  assert.equal(
    h.calls.rpc.some((x) => x.name === "store_booking_legal_email_payload"),
    false,
  );
  assert.equal(h.calls.rpc.at(-1).args.p_ok, false);
});

function notificationCronHarness({
  allowed = false,
  production = false,
  optional = true,
  envOverrides = {},
} = {}) {
  const calls = { requests: [], rpc: [], contracts: 0, sms: 0 };
  const env = {
    CRON_SECRET: "fixture-cron",
    RESEND_API_KEY: "re_fixture",
    BOOKING_EMAIL_FROM: "Opulence Bliss <no-reply@example.invalid>",
    NEXT_PUBLIC_SITE_URL: "https://staging.example.invalid",
    NEXT_PUBLIC_SUPABASE_URL: production
      ? "https://production.example.invalid"
      : "https://comwdjprdedmsnxtvuuk.supabase.co",
    VERCEL_ENV: production ? "production" : "preview",
    STAGING_EMAIL_RECIPIENTS: allowed ? "tester@example.invalid" : "",
    ...envOverrides,
  };
  const admin = {
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (name === "claim_booking_emails")
        return {
          data: [
            {
              id: "notice",
              claim_token: "lease",
              email: "tester@example.invalid",
              title: "Fixture booking",
              body: "Test only",
              href: "/account",
            },
          ],
        };
      if (name === "preferred_confirmation_sms_sent") return { data: false };
      if (name === "booking_email_preference_allowed")
        return { data: optional };
      if (["finish_booking_email", "skip_booking_email"].includes(name))
        return { data: true };
      throw Error(`Unexpected RPC ${name}`);
    },
  };
  const route = loader(
    {
      "next/server": {
        NextResponse: { json: (body, init) => Response.json(body, init) },
      },
      "@supabase/supabase-js": { createClient: () => admin },
      "@/lib/processBookingSms": {
        processBookingSms: async () => {
          calls.sms++;
          return { enabled: false, submitted: 0, failed: 0 };
        },
      },
      "@/lib/bookingLegalMail": {
        deliverBookingLegalEmails: async () => {
          calls.contracts++;
          return { configured: true, sent: 1, failed: 0 };
        },
      },
    },
    env,
    async (url, init) => {
      calls.requests.push({ url, init });
      return new Response("{}");
    },
  )("app/api/cron/booking-notifications/route.ts");
  return { route, calls };
}

test("booking cron cannot send old staging emails outside the test allowlist", async () => {
  for (const [options, expectedRequests] of [
    [{}, 0],
    [{ allowed: true }, 1],
    [{ production: true }, 1],
  ]) {
    const h = notificationCronHarness(options);
    const response = await h.route.GET(
      new Request(
        "https://staging.example.invalid/api/cron/booking-notifications",
        { headers: { authorization: "Bearer fixture-cron" } },
      ),
    );
    assert.equal(h.calls.requests.length, expectedRequests);
    assert.equal(response.status, expectedRequests ? 200 : 503);
    assert.equal(h.calls.contracts, 1);
  }
});

test("booking cron requires its secret and keeps essential contracts independent of optional notices", async () => {
  const unauthorized = notificationCronHarness();
  assert.equal(
    (
      await unauthorized.route.GET(
        new Request("https://staging.example.invalid"),
      )
    ).status,
    401,
  );
  assert.equal(unauthorized.calls.rpc.length, 0);
  assert.equal(unauthorized.calls.contracts, 0);
  const optedOut = notificationCronHarness({ allowed: true, optional: false });
  const response = await optedOut.route.GET(
    new Request("https://staging.example.invalid", {
      headers: { authorization: "Bearer fixture-cron" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(optedOut.calls.requests.length, 0);
  assert.equal(optedOut.calls.contracts, 1);
  assert.ok(
    optedOut.calls.rpc.some((call) => call.name === "skip_booking_email"),
  );
});

test("policy-only smoke delivery is authenticated, staging-only and never touches reminder or SMS queues", async () => {
  const url =
    "https://staging.example.invalid/api/cron/booking-notifications?legal_only=1";
  for (const [options, status] of [
    [{ allowed: true }, 200],
    [{ production: true }, 404],
    [{ envOverrides: { VERCEL_ENV: "development" } }, 404],
    [
      {
        envOverrides: {
          NEXT_PUBLIC_SUPABASE_URL: "https://other.example.invalid",
        },
      },
      404,
    ],
  ]) {
    const h = notificationCronHarness(options);
    const response = await h.route.GET(
      new Request(url, {
        headers: { authorization: "Bearer fixture-cron" },
      }),
    );
    assert.equal(response.status, status);
    assert.equal(h.calls.contracts, status === 200 ? 1 : 0);
    assert.equal(h.calls.rpc.length, 0);
    assert.equal(h.calls.sms, 0);
    assert.equal(h.calls.requests.length, 0);
  }
  const unauthorized = notificationCronHarness({ allowed: true });
  assert.equal((await unauthorized.route.GET(new Request(url))).status, 401);
  assert.equal(unauthorized.calls.contracts, 0);
});

test("download route requires sign-in and delegates ownership/MFA to the database", async () => {
  const id = contract.bookings[0].id;
  for (const option of [
    { user: null, data: null, status: 401 },
    { user: { id: "other" }, data: null, status: 404 },
    { user: { id: "owner" }, data: contract, status: 200 },
  ]) {
    const client = {
      auth: { getUser: async () => ({ data: { user: option.user } }) },
      rpc: async (name, args) => {
        assert.equal(name, "booking_legal_contract");
        assert.equal(args.p_booking, id);
        return { data: option.data };
      },
    };
    const route = loader({
      "@/lib/supabase/server": { createClient: async () => client },
    })("app/api/bookings/[id]/legal-documents/route.ts");
    const response = await route.GET(
      new Request(`https://example.invalid/api/bookings/${id}/legal-documents`),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(response.status, option.status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    if (response.status === 200)
      assert.equal(response.headers.get("content-type"), "application/pdf");
  }
});

test("staff downloads stay on the staff API and require its authenticator gate", async () => {
  for (const permitted of [false, true]) {
    let downloads = 0;
    const route = loader({
      "@/lib/supabase/server": {
        createClient: async () => ({ rpc: async () => ({ data: permitted }) }),
      },
      "@/app/api/bookings/[id]/legal-documents/route": {
        GET: async () => {
          downloads++;
          return new Response("PDF");
        },
      },
    })("app/api/admin/bookings/[id]/legal-documents/route.ts");
    const response = await route.GET(
      new Request(
        "https://admin.example.invalid/api/admin/bookings/fixture/legal-documents",
      ),
      { params: Promise.resolve({ id: "fixture" }) },
    );
    assert.equal(response.status, permitted ? 200 : 403);
    assert.equal(downloads, permitted ? 1 : 0);
  }
});

test("staff evidence page gates access and renders sent, failed and review-required email states", async () => {
  const id = contract.bookings[0].id;
  const file = "app/admin/bookings/[id]/legal/page.tsx";
  const blocked = loader({
    "@/lib/adminSession": {
      requireAdminPage: async () => {
        throw new Error("Authenticator sign-in required");
      },
    },
    "next/link": ({ children, ...props }) =>
      createElement("a", props, children),
  })(file);
  await assert.rejects(
    blocked.default({ params: Promise.resolve({ id }) }),
    /Authenticator sign-in required/,
  );

  for (const status of ["sent", "failed", "needs_review"]) {
    const calls = [];
    const page = loader({
      "@/lib/adminSession": {
        requireAdminPage: async () => ({
          supabase: {
            rpc: async (name, args) => {
              calls.push(name);
              assert.equal(args.p_booking, id);
              if (name === "booking_legal_contract") return { data: contract };
              assert.equal(name, "admin_booking_legal_email_status");
              return {
                data: {
                  status,
                  attempts: status === "sent" ? 1 : 8,
                  sentAt: status === "sent" ? "2026-10-24T07:02:20Z" : null,
                  lastError:
                    status === "sent" ? null : "Synthetic delivery failure",
                },
              };
            },
          },
        }),
      },
      "next/link": ({ children, ...props }) =>
        createElement("a", props, children),
    })(file);
    const html = renderToStaticMarkup(
      await page.default({ params: Promise.resolve({ id }) }),
    );
    assert.deepEqual(calls, [
      "booking_legal_contract",
      "admin_booking_legal_email_status",
    ]);
    assert.ok(html.includes(`Status: ${status.replaceAll("_", " ")}`));
    assert.ok(html.includes(`Attempts: ${status === "sent" ? 1 : 8}`));
    assert.equal(
      html.includes("Synthetic delivery failure"),
      status !== "sent",
    );
    assert.equal(
      html.includes("Check the email provider delivery log before retrying."),
      status === "needs_review",
    );
    assert.equal(
      html.includes("Submitted 2026-10-24T07:02:20.000Z"),
      status === "sent",
    );
    assert.ok(html.includes(`/api/admin/bookings/${id}/legal-documents`));
    assert.ok(!html.includes(`/api/bookings/${id}/legal-documents`));
    assert.ok(!html.includes("Retry now"));
  }
});

test("payment-free test uses the normal template and identical four PDF bytes, clearly marked TEST", async () => {
  const { bookingLegalEmailPayload } = load("lib/bookingLegalEmailPayload.ts");
  const options = {
    from: "Opulence Bliss <no-reply@example.invalid>",
    origin: "https://example.invalid",
  };
  const normal = await bookingLegalEmailPayload(
    contract,
    "tester@example.invalid",
    options,
  );
  const sample = await bookingLegalEmailPayload(
    { ...contract, bookings: [] },
    "tester@example.invalid",
    { ...options, test: true },
  );
  assert.deepEqual(sample.attachments, normal.attachments);
  assert.equal(sample.attachments.length, 4);
  assert.equal(sample.from, normal.from);
  assert.equal(sample.reply_to, normal.reply_to);
  assert.match(sample.subject, /^TEST ONLY/);
  assert.match(
    sample.text,
    /No booking, charge or new policy acceptance has been created/,
  );
  assert.ok(
    sample.text.includes(`/api/account/checkout-policies/${contract.id}`),
  );
  assert.ok(!sample.text.includes("Thank you for booking"));
  assert.ok(!sample.text.includes("/account/visit/"));
  assert.equal(normal.subject, "Your Opulence Bliss booking policies");
  assert.ok(
    normal.text.startsWith("Thank you for booking with Opulence Bliss."),
  );
  for (const attachment of sample.attachments)
    assert.ok(
      (
        await PDFDocument.load(Buffer.from(attachment.content, "base64"))
      ).getPageCount() > 0,
    );
});

function checkoutCopyDatabase({
  missing = false,
  invalidOwner = false,
  linked = 0,
  verified = true,
} = {}) {
  const calls = [];
  const row = {
    id: contract.id,
    user_id: contract.evidence.account.userId,
    accepted_at: contract.acceptedAt,
    documents: contract.documents,
    evidence: contract.evidence,
  };
  if (invalidOwner)
    row.evidence = {
      ...row.evidence,
      account: { ...row.evidence.account, userId: "different-owner" },
    };
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      assert.ok(
        [
          "booking_checkout_legal_consents",
          "account_legal_acceptances",
        ].includes(table),
      );
      const filters = [];
      const query = {
        select(...args) {
          calls.push(["select", ...args]);
          return query;
        },
        eq(...args) {
          filters.push(args);
          calls.push(["eq", ...args]);
          return query;
        },
        not(...args) {
          calls.push(["not", ...args]);
          return query;
        },
        async maybeSingle() {
          const owner = filters.find(([key]) => key === "user_id")?.[1];
          return {
            data: missing || (owner && owner !== row.user_id) ? null : row,
          };
        },
        then(resolve) {
          return Promise.resolve({ count: linked, error: null }).then(resolve);
        },
      };
      return query;
    },
    auth: {
      admin: {
        async getUserById(id) {
          assert.equal(id, row.user_id);
          return {
            data: {
              user: {
                email: contract.evidence.account.email,
                email_confirmed_at: verified ? contract.acceptedAt : null,
              },
            },
          };
        },
      },
    },
  };
}

test("checkout-copy reader filters the customer owner, validates evidence, and does not fabricate bookings", async () => {
  const { loadCheckoutPolicyCopy } = load("lib/checkoutPolicyCopy.ts");
  const database = checkoutCopyDatabase();
  const copy = await loadCheckoutPolicyCopy(
    database,
    contract.id,
    contract.evidence.account.userId,
  );
  assert.deepEqual(copy.bookings, []);
  assert.deepEqual(copy.documents, contract.documents);
  assert.ok(
    database.calls.some(
      ([operation, column, value]) =>
        operation === "eq" &&
        column === "user_id" &&
        value === contract.evidence.account.userId,
    ),
  );
  assert.equal(
    await loadCheckoutPolicyCopy(database, contract.id, "other-customer"),
    null,
  );
  assert.equal(
    await loadCheckoutPolicyCopy(
      checkoutCopyDatabase({ invalidOwner: true }),
      contract.id,
    ),
    null,
  );
});

test("customer payment-free downloads require sign-in and return the owner's real PDF and cancellation form", async () => {
  const path = "app/api/account/checkout-policies/[id]/route.ts";
  const context = { params: Promise.resolve({ id: contract.id }) };
  const blocked = loader({
    "@/lib/accountApi": {
      accountContext: async () => new NextResponse(null, { status: 401 }),
      isAccountError: (value) => value instanceof NextResponse,
    },
  })(path);
  assert.equal(
    (
      await blocked.GET(
        new Request(
          "https://example.invalid/api/account/checkout-policies/" +
            contract.id,
        ),
        context,
      )
    ).status,
    401,
  );
  for (const owner of [
    contract.evidence.account.userId,
    "different-customer",
  ]) {
    const database = checkoutCopyDatabase();
    const route = loader({
      "@/lib/accountApi": {
        accountContext: async () => ({ admin: database, user: { id: owner } }),
        isAccountError: (value) => value instanceof NextResponse,
      },
    })(path);
    for (const suffix of ["", "?form=cancellation"]) {
      const result = await route.GET(
        new Request(
          "https://example.invalid/api/account/checkout-policies/" +
            contract.id +
            suffix,
        ),
        context,
      );
      assert.equal(
        result.status,
        owner === contract.evidence.account.userId ? 200 : 404,
      );
      assert.equal(result.headers.get("cache-control"), "private, no-store");
      if (result.status === 200) {
        assert.equal(result.headers.get("content-type"), "application/pdf");
        assert.ok(
          (await PDFDocument.load(await result.arrayBuffer())).getPageCount() >
            0,
        );
      }
    }
  }
});

test("admin payment-free downloads preserve the staff authenticator gate", async () => {
  for (const status of [401, 403, 200]) {
    const database = checkoutCopyDatabase();
    const route = loader({
      "@/lib/adminApi": {
        adminApi: async () =>
          status === 200
            ? { admin: database }
            : new NextResponse(null, { status }),
      },
    })("app/api/admin/checkout-policies/[id]/route.ts");
    const response = await route.GET(
      new Request(
        "https://admin.example.invalid/api/admin/checkout-policies/" +
          contract.id,
      ),
      { params: Promise.resolve({ id: contract.id }) },
    );
    assert.equal(response.status, status);
    if (status === 200)
      assert.equal(response.headers.get("content-type"), "application/pdf");
    else assert.equal(database.calls.length, 0);
  }
});
