import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, relative } from "node:path";
import { createServer } from "node:http";
import vm from "node:vm";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const root = resolve(import.meta.dirname, ".."),
  require = createRequire(import.meta.url);
const providers = Array.from({ length: 85 }, (_, i) => ({
  id: `pro-${i}`,
  display_name:
    [
      "Amelia Johnson",
      "James Patel",
      "Olivia Williams",
      "Daniel Ahmed",
      "Sophie Brown",
    ][i % 5] + ` ${i + 1}`,
  profile_id: `person-${i}`,
  profile: { email: `professional-${i}@example.invalid` },
  services: ["cleaning"],
  vetting_status: i % 3 ? "approved" : "pending",
  service_approvals: { cleaning: i % 3 ? "approved" : "pending" },
  is_suspended: i === 4,
  created_at: new Date(Date.UTC(2026, 9, 19, 0, -i)).toISOString(),
  show_on_our_pros: false,
  dbs_verified: false,
}));
const reviews = Array.from({ length: 65 }, (_, i) => ({
  id: `review-${i}`,
  booking_id: `booking-${i}`,
  reviewer: i % 2 ? "provider" : "client",
  rating: 5 - (i % 3),
  comment:
    i === 0
      ? "The cleaner was punctual, careful and left the kitchen looking lovely. Booking was straightforward and everything was clearly explained."
      : i === 1
        ? "Clear instructions and a welcoming customer. The visit went smoothly."
        : "Thoughtful service and helpful communication throughout the visit.",
  visibility: i === 2 ? "private" : "public",
  created_at: new Date(Date.UTC(2026, 9, 19, 0, -i)).toISOString(),
}));
const bookings = reviews.map((review, i) => ({
  id: review.booking_id,
  customer_id: `customer-${i}`,
  provider_id: `pro-${i}`,
}));
const profiles = reviews.map((_, i) => ({
  id: `customer-${i}`,
  full_name: ["Rachel", "Oliver", "Charlotte", "William", "Isabelle"][i % 5],
  email: `customer-${i}@example.invalid`,
  role: "customer",
  account_deleted_at: null,
}));
function database({ fail, empty = false } = {}) {
  const calls = [];
  const tables = {
    providers,
    reviews,
    bookings,
    profiles,
    provider_availability: [],
    provider_dbs_checks: [],
  };
  return {
    calls,
    from(table) {
      const call = { table, orders: [], filters: [], head: false };
      calls.push(call);
      const q = {
        select(fields, opts) {
          call.fields = fields;
          call.head = !!opts?.head;
          return q;
        },
        order(key, opts) {
          call.orders.push([key, opts?.ascending !== false]);
          return q;
        },
        limit(n) {
          call.limit = n;
          return q;
        },
        range(from, to) {
          call.range = [from, to];
          return q;
        },
        or(filter) {
          call.pending = filter;
          return q;
        },
        eq(k, v) {
          call.filters.push((row) => row[k] === v);
          return q;
        },
        neq(k, v) {
          call.filters.push((row) => row[k] !== v);
          return q;
        },
        is(k, v) {
          call.filters.push((row) => row[k] === v);
          return q;
        },
        in(k, ids) {
          call.filters.push((row) => ids.includes(row[k]));
          return q;
        },
        then(onFulfilled, onRejected) {
          let rows = empty ? [] : [...(tables[table] ?? [])];
          for (const predicate of call.filters) rows = rows.filter(predicate);
          if (call.pending)
            rows = rows.filter(
              (row) =>
                row.service_approvals?.cleaning === "pending" ||
                (call.pending.includes("handyman") &&
                  row.service_approvals?.handyman === "pending"),
            );
          const count = rows.length;
          rows.sort((a, b) => {
            for (const [key, asc] of call.orders) {
              const d = String(a[key] ?? "").localeCompare(
                String(b[key] ?? ""),
              );
              if (d) return asc ? d : -d;
            }
            return 0;
          });
          if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
          if (call.limit != null) rows = rows.slice(0, call.limit);
          call.returned = call.head ? 0 : rows.length;
          return Promise.resolve({
            data: call.head ? null : rows,
            count,
            error: table === fail ? { message: "Fixture lookup failed" } : null,
          }).then(onFulfilled, onRejected);
        },
      };
      return q;
    },
  };
}
function cssModule(file) {
  const prefix = cssPrefix(file);
  return new Proxy({}, { get: (_, key) => `${prefix}-${String(key)}` });
}
function cssPrefix(file) {
  if (file.endsWith("AdminNav.module.css")) return "nav";
  if (file.endsWith("AdminSkeleton.module.css")) return "skeleton";
  if (file.endsWith("AdminProfessionalOnboarding.module.css"))
    return "onboarding";
  return "dashboard";
}
function runtime(db, { path = "/admin", guard, overview } = {}) {
  const cache = new Map();
  function load(file) {
    file = resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const mocks = {
      "server-only": {},
      "next/link": {
        __esModule: true,
        default: ({ children, prefetch, ...props }) =>
          React.createElement("a", props, children),
      },
      "next/navigation": {
        usePathname: () => path,
        redirect: (where) => {
          throw Error("redirect:" + where);
        },
      },
      "@/lib/adminSession": {
        requireAdminPage:
          guard ??
          (async () => ({
            supabase: db,
            user: { id: "sample-staff", email: "admin@example.invalid" },
          })),
      },
      "@/lib/supabase/client": {
        createClient: () => ({ auth: { signOut: async () => ({}) } }),
      },
      "@/components/PortalLiveSync": {
        __esModule: true,
        default: () => null,
      },
    };
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(
      output,
      {
        module,
        exports: module.exports,
        URLSearchParams,
        process: {
          env: {
            VERCEL_ENV: "production",
            HANDYMAN_MARKETPLACE_ENABLED: "true",
          },
        },
        console,
        require(id) {
          if (id in mocks) return mocks[id];
          if (id.endsWith(".module.css"))
            return { __esModule: true, default: cssModule(id) };
          if (id === "@/lib/adminOverview" && overview)
            return { loadAdminOverview: async () => overview };
          const candidate = id.startsWith("@/")
            ? resolve(root, id.slice(2))
            : id.startsWith(".")
              ? resolve(dirname(file), id)
              : null;
          if (candidate) {
            const name = relative(root, candidate).replaceAll("\\", "/");
            if (name === "app/admin/actions" || name === "app/admin/actions.ts")
              return {
                deleteReview: () => {},
                setProviderDirectoryVisibility: () => {},
              };
            if (name.endsWith("/ServiceReview"))
              return {
                __esModule: true,
                default: () =>
                  React.createElement(
                    "p",
                    null,
                    "Review service approval requirements",
                  ),
              };
            if (name.endsWith("/AdminButtons"))
              return {
                __esModule: true,
                default: () => {
                  throw Error(
                    "Development tools must not render in production",
                  );
                },
              };
            try {
              return load(candidate + ".ts");
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
              return load(candidate + ".tsx");
            }
          }
          return require(id);
        },
      },
      { filename: file },
    );
    return module.exports;
  }
  return { load };
}

test("overview queries never fetch unbounded professionals or reviews", async () => {
  const db = database();
  const { loadAdminOverview } = runtime(db).load("lib/adminOverview.ts");
  const result = await loadAdminOverview(db, true);
  assert.equal(result.professionals.count, 85);
  assert.equal(result.professionals.data.length, 5);
  assert.equal(result.approvals.data.length, 5);
  assert.equal(result.reviews.reviews.length, 5);
  for (const call of db.calls.filter(
    (c) =>
      c.table === "reviews" ||
      (c.table === "providers" && c.fields.includes("service_approvals")),
  ))
    assert.equal(call.limit, 5);
});
test("overview shows five rows per section, full totals and dedicated View all links", async () => {
  const db = database();
  const Page = runtime(db).load("app/admin/page.tsx").default;
  const html = renderToStaticMarkup(await Page());
  assert.equal((html.match(/class="dashboard-personRow"/g) ?? []).length, 10);
  assert.equal((html.match(/class="dashboard-reviewRow"/g) ?? []).length, 5);
  assert.match(html, /href="\/admin\/cleaners\?status=pending"/);
  assert.match(html, /href="\/admin\/reviews\/activity"/);
  assert.match(html, /85/);
  assert.doesNotMatch(html, /Decision reason|>Delete<|Development tools/);
});
test("an over-returning data source cannot expand overview lists beyond five", async () => {
  const db = database();
  const data = await runtime(db)
    .load("lib/adminOverview.ts")
    .loadAdminOverview(db, true);
  data.professionals.data = providers;
  data.approvals.data = providers;
  data.reviews.reviews = Array.from({ length: 80 }, (_, i) => ({
    ...data.reviews.reviews[0],
    id: String(i),
  }));
  const html = renderToStaticMarkup(
    await runtime(db, { overview: data }).load("app/admin/page.tsx").default(),
  );
  assert.equal((html.match(/class="dashboard-personRow"/g) ?? []).length, 10);
  assert.equal((html.match(/class="dashboard-reviewRow"/g) ?? []).length, 5);
});
test("lookup failures display errors rather than a false all-clear", async () => {
  const html = renderToStaticMarkup(
    await runtime(database({ fail: "providers" }))
      .load("app/admin/page.tsx")
      .default(),
  );
  assert.match(html, /Applications could not be loaded/);
  assert.doesNotMatch(html, /No applications are waiting/);
  const empty = renderToStaticMarkup(
    await runtime(database({ empty: true }))
      .load("app/admin/page.tsx")
      .default(),
  );
  assert.match(empty, /No applications are waiting/);
  assert.match(empty, /Booking reviews will appear here/);
});
test("reviews page filters and paginates real hydration, including page-two feedback", async () => {
  const db = database();
  const Page = runtime(db, { path: "/admin/reviews/activity" }).load(
    "app/admin/reviews/activity/page.tsx",
  ).default;
  const html = renderToStaticMarkup(
    await Page({
      searchParams: Promise.resolve({ page: "2", type: "provider" }),
    }),
  );
  const query = db.calls.find((c) => c.table === "reviews");
  assert.deepEqual(query.range, [20, 39]);
  assert.equal(query.returned, 12);
  assert.match(html, /type=provider/);
  assert.doesNotMatch(html, /Add customer review|Homepage reviews/);
  assert.match(html, /Back to overview/);
});
test("pending professionals open only their filtered page; detail hydration is limited to that page", async () => {
  const db = database();
  const Page = runtime(db, { path: "/admin/cleaners" }).load(
    "app/admin/cleaners/page.tsx",
  ).default;
  const html = renderToStaticMarkup(
    await Page({
      searchParams: Promise.resolve({ status: "pending", page: "2" }),
    }),
  );
  const query = db.calls.find((c) => c.table === "providers");
  assert.deepEqual(query.range, [20, 39]);
  assert.equal(query.returned, 9);
  assert.match(html, /Awaiting approval/);
  assert.doesNotMatch(html, />Add a professional</);
  assert.match(html, /status=pending/);
  for (const c of db.calls.filter((c) =>
    ["bookings", "provider_availability", "provider_dbs_checks"].includes(
      c.table,
    ),
  ))
    assert.ok(
      c.filters.length > 0,
      "secondary lookups must filter to current IDs",
    );
});
test("out-of-range pages preserve filters and redirect to the last available page", async () => {
  await assert.rejects(
    runtime(database())
      .load("app/admin/reviews/activity/page.tsx")
      .default({
        searchParams: Promise.resolve({ page: "999", type: "provider" }),
      }),
    /redirect:\/admin\/reviews\/activity\?type=provider&page=2/,
  );
});
test("the admin guard runs before any dashboard or review data access", async () => {
  let reads = 0;
  const db = {
    from: () => {
      reads++;
      throw Error("Data must remain private");
    },
  };
  const rt = runtime(db, {
    guard: async () => {
      throw Error("MFA required");
    },
  });
  for (const path of [
    "app/admin/page.tsx",
    "app/admin/reviews/activity/page.tsx",
    "app/admin/cleaners/page.tsx",
  ])
    await assert.rejects(
      rt.load(path).default({ searchParams: Promise.resolve({}) }),
      /MFA required/,
    );
  assert.equal(reads, 0);
});
test("review navigation does not also mark the resolution desk as active", () => {
  const Nav = runtime(database(), { path: "/admin/reviews/activity" }).load(
    "app/admin/AdminNav.tsx",
  ).default;
  const html = renderToStaticMarkup(
    React.createElement(Nav, { email: "admin@example.invalid" }),
  );
  assert.match(html, /href="\/admin\/reviews\/activity" aria-current="page"/);
  assert.doesNotMatch(html, /href="\/admin\/review" aria-current="page"/);
});

test("the shared admin shell keeps one navigation around both page and loading content", async () => {
  const rt = runtime(database());
  const Layout = rt.load("app/admin/layout.tsx").default;
  const Loading = rt.load("app/admin/loading.tsx").default;
  for (const children of [
    await rt.load("app/admin/page.tsx").default(),
    React.createElement(Loading),
  ]) {
    const html = renderToStaticMarkup(await Layout({ children }));
    assert.equal(
      (html.match(/aria-label="Admin navigation"/g) ?? []).length,
      1,
    );
    assert.match(html, />Admin page<.*admin@example.invalid/);
    assert.doesNotMatch(html, /Your workspace|Workforce/);
  }
  const loading = renderToStaticMarkup(React.createElement(Loading));
  assert.match(loading, /role="status".*aria-busy="true"/);
  assert.match(loading, /skeleton-row/);
});

test("professional invitation has one disclosure, required contact fields and service visibility", () => {
  const Form = runtime(database()).load(
    "components/AdminProfessionalOnboarding.tsx",
  ).default;
  const html = renderToStaticMarkup(
    React.createElement(Form, { handymanEnabled: false }),
  );
  assert.equal((html.match(/<details/g) ?? []).length, 1);
  assert.match(html, /Add a professional/);
  assert.match(html, /type="email".*name="email"/);
  assert.match(html, /type="tel".*name="phone"/);
  assert.match(html, /account stays pending/);
  assert.match(html, /Send setup link/);
  assert.doesNotMatch(html, /Property maintenance/);
  assert.match(
    renderToStaticMarkup(React.createElement(Form, { handymanEnabled: true })),
    /Property maintenance/,
  );
});

// Optional local, read-only visual fixture. No app route/auth bypass, credentials
// or real customer data is created. Used to inspect desktop/mobile/dark layouts.
if (process.argv.includes("--preview-ui")) {
  const cssFiles = [
    "app/admin/admin.module.css",
    "app/admin/AdminNav.module.css",
    "app/admin/AdminSkeleton.module.css",
    "components/AdminProfessionalOnboarding.module.css",
  ];
  const globals = readFileSync(resolve(root, "app/globals.css"), "utf8")
    .split("@layer base")[0]
    .replace(/@tailwind[^;]+;/g, "");
  const css = cssFiles
    .map((file) => {
      const source = readFileSync(resolve(root, file), "utf8");
      const prefix = cssPrefix(file);
      return source.replace(
        /\.([a-zA-Z_][\w-]*)/g,
        (_, name) => `.${prefix}-${name}`,
      );
    })
    .join("\n");
  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost:3129");
      const path = url.pathname;
      const file =
        path === "/admin/reviews/activity"
          ? "app/admin/reviews/activity/page.tsx"
          : path === "/admin/cleaners"
            ? "app/admin/cleaners/page.tsx"
            : "app/admin/page.tsx";
      const rt = runtime(database(), { path });
      const Page = rt.load(file).default;
      const Layout = rt.load("app/admin/layout.tsx").default;
      const Loading = rt.load("app/admin/loading.tsx").default;
      const body = renderToStaticMarkup(
        await Layout({
          children: url.searchParams.has("loading")
            ? React.createElement(Loading)
            : await Page({
                searchParams: Promise.resolve(
                  Object.fromEntries(url.searchParams),
                ),
              }),
        }),
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html lang="en"${url.searchParams.get("theme") === "dark" ? ' class="dark"' : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin layout — sample data</title><style>${globals}\n*{box-sizing:border-box}body{margin:0;font-family:Arial,system-ui,sans-serif}button,input,select{font:inherit}${css}</style></head><body><div style="text-align:center;font-size:11px;padding:7px;background:#f4ecfe;color:#5b21b6">Local layout check · Sample data only</div>${body}</body></html>`,
      );
    } catch {
      res.statusCode = 500;
      res.end("Layout fixture could not render");
    }
  }).listen(3129, "127.0.0.1", () =>
    console.log("Read-only admin layout fixture: http://127.0.0.1:3129/admin"),
  );
}
