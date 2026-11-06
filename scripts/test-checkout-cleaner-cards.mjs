// Execute the shared customer responses with scoped, fictional sessions/data.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
const require = createRequire(import.meta.url);
function fixture(options = {}) {
  const calls = [];
  function client(scope) {
    return {
      from(table) {
        calls.push({ scope, table });
        assert.notEqual(
          table,
          "providers",
          "customer card responses must not access private providers",
        );
        const values =
          scope === "customer"
            ? {
                customer_provider_cards: [
                  {
                    id: "TEST-provider",
                    customer_first_name: "Alex",
                    photo_url: "/TEST-photo.jpg",
                    public_rating_avg: 4.9,
                    display_name: "Alex TEST_PRIVATE_SURNAME",
                  },
                ],
              }
            : {
                customer_favourite_providers: [
                  { provider_id: "TEST-provider" },
                ],
                profiles: {
                  id: "TEST-customer",
                  full_name: "TEST Customer",
                  email: "test@example.invalid",
                },
                account_profile_details: null,
                customer_addresses: [],
                account_legal_acceptances: [],
                signup_consents: null,
                bookings: [
                  {
                    id: "TEST-booking",
                    customer_id: "TEST-customer",
                    provider_id: "TEST-provider",
                    packages: { name: "TEST Cleaning" },
                    providers: { display_name: "Alex TEST_PRIVATE_SURNAME" },
                  },
                ],
                reviews: [
                  {
                    id: "TEST-review",
                    booking_id: "TEST-booking",
                    reviewer: "client",
                    rating: 3,
                    comment: "TEST ONLY private fixture",
                    visibility: "private",
                    created_at: "2026-11-05T08:00:00Z",
                  },
                ],
              };
        assert.ok(table in values, `Unexpected ${scope} table: ${table}`);
        const row = {
          data: values[table],
          error:
            options.fail && table === "customer_provider_cards"
              ? { message: "TEST query failed" }
              : null,
        };
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          order() {
            return chain;
          },
          in() {
            return chain;
          },
          limit() {
            return chain;
          },
          single: async () => row,
          maybeSingle: async () => row,
          then(resolve) {
            return Promise.resolve(resolve(row));
          },
        };
        return chain;
      },
    };
  }
  const customer = client("customer"),
    admin = client("service");
  function load(file) {
    const m = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: file,
      }).outputText,
      {
        module: m,
        exports: m.exports,
        require: (name) => {
          if (name === "next/server") return { NextRequest, NextResponse };
          if (name === "@/lib/supabase/server")
            return { createClient: async () => customer };
          if (name === "@/lib/customerCleanerCards")
            return load("lib/customerCleanerCards.ts");
          if (name === "@/lib/accountApi")
            return {
              accountContext: async () =>
                options.signedOut
                  ? NextResponse.json({ error: "Sign in" }, { status: 401 })
                  : { user: { id: "TEST-customer", user_metadata: {} }, admin },
              isAccountError: (x) => x instanceof NextResponse,
              accountError: (error, status) =>
                NextResponse.json({ error }, { status }),
            };
          return require(name);
        },
      },
    );
    return m.exports;
  }
  return { calls, load };
}
const expected = [
  {
    providerId: "TEST-provider",
    displayName: "Alex",
    photoUrl: "/TEST-photo.jpg",
    ratingAvg: 4.9,
  },
];
const request = () =>
  new NextRequest("https://staging.example.invalid/api/account/profile");
test("checkout profile response sources favourites through the customer's safe projection", async () => {
  const f = fixture();
  const response = await f
    .load("app/api/account/profile/route.ts")
    .GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).favourites, expected);
  assert.ok(
    f.calls.some(
      (c) => c.scope === "customer" && c.table === "customer_provider_cards",
    ),
  );
  assert.ok(
    f.calls.some(
      (c) =>
        c.scope === "service" && c.table === "customer_favourite_providers",
    ),
  );
});
test("favourites endpoint returns only the safe first-name card", async () => {
  const f = fixture();
  const response = await f
    .load("app/api/account/favourites/route.ts")
    .GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { favourites: expected });
  assert.deepEqual(
    f.calls.map((c) => [c.scope, c.table]),
    [
      ["service", "customer_favourite_providers"],
      ["customer", "customer_provider_cards"],
    ],
  );
});
test("signed-out requests cannot load any customer or cleaner records", async () => {
  for (const path of ["profile", "favourites"]) {
    const f = fixture({ signedOut: true });
    assert.equal(
      (await f.load(`app/api/account/${path}/route.ts`).GET(request())).status,
      401,
    );
    assert.equal(f.calls.length, 0);
  }
});
test("a safe-card lookup failure never falls back to the private table", async () => {
  for (const path of ["profile", "favourites"]) {
    const f = fixture({ fail: true });
    assert.equal(
      (await f.load(`app/api/account/${path}/route.ts`).GET(request())).status,
      503,
    );
  }
});
test("booking page no longer calls the legacy previous-cleaner RPC", () => {
  const source = readFileSync("app/book/page.tsx", "utf8");
  assert.doesNotMatch(source, /rpc\(["']my_previous_cleaners/);
  assert.match(source, /loadPreviousCustomerCleaners\(supabase, user.id\)/);
});
test("profile review recipients use first-name cards without a stored-name fallback", async () => {
  const f = fixture();
  const response = await f
    .load("app/api/account/reviews/route.ts")
    .GET(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.left[0].recipientName, "Alex");
  assert.doesNotMatch(JSON.stringify(result), /TEST_PRIVATE_SURNAME/);
});
test("review card lookup failure cannot disclose a private stored name", async () => {
  const f = fixture({ fail: true });
  const response = await f
    .load("app/api/account/reviews/route.ts")
    .GET(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /TEST_PRIVATE_SURNAME/);
});
