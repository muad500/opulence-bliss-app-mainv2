import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadPreviousCustomerCleaners,
  loadCustomerFavouriteCards,
} from "./customerCleanerCards";

function fixture(tables: Record<string, unknown[]>, fail?: string) {
  const queries: { table: string; select?: string; filters: unknown[][] }[] =
    [];
  const client = {
    from(table: string) {
      assert.notEqual(
        table,
        "providers",
        "customer display reads must never touch private providers",
      );
      const query = { table, select: "", filters: [] as unknown[][] };
      queries.push(query);
      const chain = {
        select(value: string) {
          query.select = value;
          return chain;
        },
        eq(...values: unknown[]) {
          query.filters.push(values);
          return chain;
        },
        in(...values: unknown[]) {
          query.filters.push(values);
          return chain;
        },
        order() {
          return chain;
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(
            resolve({
              data: tables[table] ?? [],
              error:
                table === fail ? { message: "TEST database failure" } : null,
            }),
          );
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}
const previous = {
  provider_id: "TEST-provider",
  packages: { service_type: "CLEANING" },
  providers: {
    customer_first_name: "Alex",
    vetting_status: "approved",
    is_suspended: false,
    display_name: "Alex TEST_PRIVATE_SURNAME",
  },
};
test("previous-cleaner options use safe booking cards and preserve first-name display", async () => {
  const f = fixture({
    bookings: [
      previous,
      {
        ...previous,
        providers: [previous.providers],
        packages: [previous.packages],
      },
    ],
  });
  assert.deepEqual(
    await loadPreviousCustomerCleaners(f.client, "TEST-customer"),
    [{ provider_id: "TEST-provider", display_name: "Alex" }],
  );
  assert.match(
    f.queries[0].select!,
    /providers:customer_provider_card\(customer_first_name/,
  );
  assert.doesNotMatch(
    f.queries[0].select!,
    /display_name|providers!|profile_id/,
  );
  assert.deepEqual(f.queries[0].filters, [
    ["customer_id", "TEST-customer"],
    ["status", "completed"],
  ]);
});
test("previous-cleaner choices still exclude suspended, unapproved and non-cleaning work", async () => {
  const f = fixture({
    bookings: [
      { ...previous, providers: { ...previous.providers, is_suspended: true } },
      {
        ...previous,
        providers: { ...previous.providers, vetting_status: "pending" },
      },
      { ...previous, packages: { service_type: "handyman" } },
      { ...previous, providers: null },
      { ...previous, provider_id: null },
    ],
  });
  assert.deepEqual(
    await loadPreviousCustomerCleaners(f.client, "TEST-customer"),
    [],
  );
});
test("a missing first name never falls back to the stored full name", async () => {
  const f = fixture({
    bookings: [
      {
        ...previous,
        providers: { ...previous.providers, customer_first_name: null },
      },
    ],
  });
  assert.deepEqual(
    await loadPreviousCustomerCleaners(f.client, "TEST-customer"),
    [{ provider_id: "TEST-provider", display_name: "Previous cleaner" }],
  );
});
test("favourite cards preserve order, photo and rating without private fields", async () => {
  const f = fixture({
    customer_favourite_providers: [
      { provider_id: "TEST-hidden" },
      { provider_id: "TEST-public" },
      { provider_id: "TEST-hidden" },
    ],
    customer_provider_cards: [
      {
        id: "TEST-public",
        customer_first_name: "Sam",
        photo_url: null,
        public_rating_avg: 4,
      },
      {
        id: "TEST-hidden",
        customer_first_name: "Alex",
        photo_url: "/TEST-photo.jpg",
        public_rating_avg: "4.8",
        display_name: "Alex TEST_PRIVATE_SURNAME",
      },
    ],
  });
  assert.deepEqual(
    await loadCustomerFavouriteCards(f.client, "TEST-customer", f.client),
    [
      {
        providerId: "TEST-hidden",
        displayName: "Alex",
        photoUrl: "/TEST-photo.jpg",
        ratingAvg: 4.8,
      },
      {
        providerId: "TEST-public",
        displayName: "Sam",
        photoUrl: null,
        ratingAvg: 4,
      },
    ],
  );
  assert.deepEqual(f.queries[0].filters, [["user_id", "TEST-customer"]]);
  assert.equal(f.queries[1].table, "customer_provider_cards");
  assert.doesNotMatch(f.queries[1].select!, /display_name|profile_id|stripe/);
});
test("unavailable favourites keep a neutral card, not a private-table fallback", async () => {
  const f = fixture({
    customer_favourite_providers: [{ provider_id: "TEST-unavailable" }],
    customer_provider_cards: [],
  });
  assert.deepEqual(
    await loadCustomerFavouriteCards(f.client, "TEST-customer", f.client),
    [
      {
        providerId: "TEST-unavailable",
        displayName: "Professional",
        photoUrl: null,
        ratingAvg: null,
      },
    ],
  );
});
test("no favourites means no unnecessary card lookup", async () => {
  const f = fixture({ customer_favourite_providers: [] });
  assert.deepEqual(
    await loadCustomerFavouriteCards(f.client, "TEST-customer", f.client),
    [],
  );
  assert.equal(f.queries.length, 1);
});
test("safe-query errors fail closed instead of fetching private data", async () => {
  for (const table of ["bookings", "customer_provider_cards"]) {
    const f = fixture(
      { customer_favourite_providers: [{ provider_id: "TEST-provider" }] },
      table,
    );
    await assert.rejects(
      table === "bookings"
        ? loadPreviousCustomerCleaners(f.client, "TEST-customer")
        : loadCustomerFavouriteCards(f.client, "TEST-customer", f.client),
    );
  }
});
test("private favourite ids are read by the server, never the browser session", async () => {
  const account = fixture({
    customer_favourite_providers: [{ provider_id: "TEST-provider" }],
  });
  const customer = fixture({
    customer_provider_cards: [
      {
        id: "TEST-provider",
        customer_first_name: "Alex",
        photo_url: null,
        public_rating_avg: 5,
      },
    ],
  });
  const authenticated = {
    from(table: string) {
      assert.equal(
        table,
        "customer_provider_cards",
        "authenticated users must not query private account tables",
      );
      return customer.client.from(table);
    },
  } as unknown as SupabaseClient;
  assert.deepEqual(
    await loadCustomerFavouriteCards(
      authenticated,
      "TEST-customer",
      account.client,
    ),
    [
      {
        providerId: "TEST-provider",
        displayName: "Alex",
        photoUrl: null,
        ratingAvg: 5,
      },
    ],
  );
  assert.deepEqual(
    account.queries.map((q) => q.table),
    ["customer_favourite_providers"],
  );
  assert.equal(account.queries[0].select, "provider_id");
  assert.deepEqual(account.queries[0].filters, [["user_id", "TEST-customer"]]);
});
