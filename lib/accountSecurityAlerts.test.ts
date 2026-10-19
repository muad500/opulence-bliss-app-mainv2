import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_CHANGE_MESSAGE,
  securityMailRecipientAllowed,
  stripePayoutAccountChanged,
} from "./accountSecurityAlerts";
test("security alerts use only the requested generic warning", () => {
  assert.equal(
    ACCOUNT_CHANGE_MESSAGE,
    "Your Opulence Bliss account details were changed. If this wasn't you, contact hello@opulencebliss.com.",
  );
});
test("staging fails closed unless the exact recipient is allowlisted", () => {
  assert.equal(
    securityMailRecipientAllowed("a@example.com", { VERCEL_ENV: "preview" }),
    false,
  );
  assert.equal(
    securityMailRecipientAllowed("a@example.com", {
      NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    }),
    false,
  );
  assert.equal(
    securityMailRecipientAllowed("a@example.com", {
      VERCEL_ENV: "preview",
      STAGING_EMAIL_RECIPIENTS: " A@example.com, b@example.com",
    }),
    true,
  );
  assert.equal(
    securityMailRecipientAllowed("a@example.com", { VERCEL_ENV: "production" }),
    true,
  );
});
test("only verified Stripe payout-change events qualify, not onboarding links or unrelated account updates", () => {
  assert.equal(stripePayoutAccountChanged("account.updated", {}), false);
  assert.equal(
    stripePayoutAccountChanged("account.updated", {
      settings: { branding: {} },
    }),
    false,
  );
  assert.equal(
    stripePayoutAccountChanged("account.updated", {
      settings: { payouts: {} },
    }),
    true,
  );
  assert.equal(
    stripePayoutAccountChanged("account.external_account.updated", undefined),
    true,
  );
  assert.equal(
    stripePayoutAccountChanged("account.external_account.created", undefined),
    true,
  );
  assert.equal(
    stripePayoutAccountChanged("account.external_account.deleted", undefined),
    true,
  );
});
