import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminHostRedirect,
  deploymentOrigins,
  notificationLink,
} from "./adminHosts";

const production = { VERCEL_ENV: "production" };
const preview = {
  VERCEL_ENV: "preview",
  VERCEL_BRANCH_URL: "app-git-codex-staging.vercel.app",
  VERCEL_URL: "app-unique.vercel.app",
};

test("every public and Vercel host sends staff paths to the sole live admin host", () => {
  for (const host of [
    "www.opulencebliss.com",
    "opulencebliss.com",
    "app.vercel.app",
    "app-unique.vercel.app",
  ])
    for (const path of [
      "/admin",
      "/admin/settings",
      "/staff/login",
      "/staff/mfa",
      "/staff/callback",
      "/api/admin/billing-settings",
      "/admin/customers/example.png",
      "/%61dmin/settings",
      "/staff%2Flogin",
    ])
      assert.equal(
        adminHostRedirect(new URL(`https://${host}${path}?page=2`), production)
          ?.href,
        `https://admin.opulencebliss.com${path}?page=2`,
      );
});

test("staff host keeps staff pages and required APIs, sending public routes to www without loops", () => {
  for (const path of [
    "/",
    "/book",
    "/account",
    "/provider/login",
    "/login",
    "/auth/login",
    "/auth/callback",
    "/admin-other",
    "/api/checkout",
  ])
    assert.equal(
      adminHostRedirect(
        new URL(`https://admin.opulencebliss.com${path}?a=b`),
        production,
      )?.href,
      `https://www.opulencebliss.com${path}?a=b`,
    );
  for (const path of [
    "/admin",
    "/staff/login",
    "/staff/update-password",
    "/api/admin/billing-settings",
    "/api/slots",
    "/_next/static/app.js",
  ])
    assert.equal(
      adminHostRedirect(
        new URL(`https://admin.opulencebliss.com${path}`),
        production,
      ),
      null,
    );
  for (const path of [
    "/login",
    "/provider/login",
    "/book",
    "/account",
    "/administrator",
  ])
    assert.equal(
      adminHostRedirect(
        new URL(`https://www.opulencebliss.com${path}`),
        production,
      ),
      null,
    );
});

test("Preview host separation never sends staging sessions or recovery codes to Production", () => {
  const { admin, website } = deploymentOrigins(preview);
  assert.equal(
    adminHostRedirect(
      new URL(`${website}/staff/callback?code=fixture`),
      preview,
    )?.href,
    `${admin}/staff/callback?code=fixture`,
  );
  assert.equal(
    adminHostRedirect(new URL(`${admin}/book`), preview)?.href,
    `${website}/book`,
  );
  assert.throws(() => deploymentOrigins({ VERCEL_ENV: "preview" }));
  assert.throws(() =>
    deploymentOrigins({ ...preview, VERCEL_BRANCH_URL: "attacker.example" }),
  );
});

test("staff notification links use admin while customer and cleaner links retain their original website", () => {
  assert.equal(
    notificationLink(
      "/admin/bookings?id=x",
      "https://www.opulencebliss.com",
      production,
    ),
    "https://admin.opulencebliss.com/admin/bookings?id=x",
  );
  assert.equal(
    notificationLink("/admin/bookings", "https://test.vercel.app", preview),
    "https://app-unique.vercel.app/admin/bookings",
  );
  assert.equal(
    notificationLink("/admin/bookings", "https://isolated.vercel.app", {
      VISIT_PAYMENTS_MODE: "staging",
    }),
    "https://isolated.vercel.app/admin/bookings",
  );
  for (const path of ["/account/visit/abc", "/worker/job/abc"])
    assert.equal(
      notificationLink(path, "https://www.opulencebliss.com", production),
      `https://www.opulencebliss.com${path}`,
    );
  for (const path of [
    "//attacker.example",
    "/\\attacker.example",
    "https://attacker.example",
    "/admin\n",
  ])
    assert.throws(() =>
      notificationLink(path, "https://www.opulencebliss.com", production),
    );
});
