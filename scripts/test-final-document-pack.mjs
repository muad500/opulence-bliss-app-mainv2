import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const temp = mkdtempSync(join(tmpdir(), "opulence-final-pack-"));
const require = createRequire(import.meta.url);
function load(entry) {
  const output = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
  }).outputFiles[0].text;
  const file = join(temp, entry.replaceAll(/[^a-zA-Z0-9]/g, "_") + ".cjs");
  writeFileSync(file, output);
  return require(file);
}
const copy = load("lib/finalCheckoutCopy.ts");
const checkout = load("lib/checkoutLegal.ts");
const consent = load("lib/professionalLegalCopy.ts");
const adjustments = load("lib/visitAdjustments.ts");
const pack = JSON.parse(readFileSync("lib/finalLegalPack.json", "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");

test("all twelve published documents preserve their original PDF fingerprints, version and effective date", () => {
  assert.equal(Object.keys(pack).length, 12);
  assert.equal(
    Object.values(pack).filter((doc) => doc.audience === "professionals")
      .length,
    4,
  );
  for (const document of Object.values(pack)) {
    assert.equal(document.version, "1.0");
    assert.equal(document.effectiveDate, "2026-10-01");
    assert.equal(
      sha(readFileSync(`legal-packs/2026-10-01/${document.pdfFile}`)),
      document.pdfSha256,
    );
    assert.ok(document.contentHtml.length > 500);
    assert.ok(document.contentHtml.includes('data-final-pack="2026-10-01"'));
  }
  assert.match(pack.cookies.contentHtml, /<table>/);
  assert.match(
    pack.cookies.contentHtml,
    /sb-uiqcsihgqaktpjumyeap-auth-token-code-verifier/,
  );
  assert.match(pack.privacy.contentHtml, /<table>/);
});

test("checkout records and linked checkbox use exactly the client-approved wording", () => {
  const documents = ["terms", "cancellation-refund", "privacy"].map((slug) => ({
    slug,
    version: "1.0",
    updatedAt: "2026-10-01T00:00:00Z",
  }));
  assert.equal(
    checkout.checkoutLegalConsentText(documents),
    copy.FINAL_CHECKOUT_COPY.terms,
  );
  assert.equal(
    checkout.SAVED_CARD_CONSENT_TEXT,
    copy.FINAL_CHECKOUT_COPY.regular,
  );
  assert.equal(
    load("lib/cancellationPeriod.ts").EARLY_START_REQUEST_TEXT,
    copy.FINAL_CHECKOUT_COPY.earlyStart,
  );
  assert.equal(
    copy.FINAL_CHECKOUT_COPY.marketing,
    "Send me offers and news by email. I can unsubscribe at any time.",
  );
  assert.equal(copy.MASSAGE_BENEFIT_ENABLED, false);
});

test("professional registration needs each relevant box, without recording an unchecked box as accepted", () => {
  for (const [cleaning, handyman] of [
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const boxes = consent.professionalConsentBoxes(cleaning, handyman);
    assert.equal(
      consent.validProfessionalConsent({}, cleaning, handyman),
      false,
    );
    const values = Object.fromEntries(boxes.map((box) => [box.key, true]));
    assert.equal(
      consent.validProfessionalConsent(values, cleaning, handyman),
      true,
    );
    for (const box of boxes)
      assert.equal(
        consent.validProfessionalConsent(
          { ...values, [box.key]: false },
          cleaning,
          handyman,
        ),
        false,
      );
  }
  assert.match(copy.FINAL_PROFESSIONAL_COPY.cleanerInsurance, /£1,000,000/);
  assert.match(copy.FINAL_PROFESSIONAL_COPY.handymanInsurance, /£2,000,000/);
});

const terms = {
  version: "final-test",
  cleanerHourlyPence: 1500,
  addonPrices: {
    oven: 2000,
    fridge: 1000,
    cupboards: 1000,
    windows: 1500,
    ironing: 1500,
  },
  productsFeePence: 500,
  tipMinimumPence: 300,
  cancellationBasis: "booking_total",
  cancellationRefundPercent: {
    full: 100,
    three_quarter: 75,
    half: 50,
    none: 30,
  },
};
const now = "2026-11-01T23:00:00Z";
const charges = [
  {
    id: "charge",
    stripe_payment_intent: "pi_test",
    amount_pence: 7698,
    refunded_pence: 0,
    refunded_lines: {},
    line_items: [
      { id: "cleaning", amountPence: 5198, reservedMinutes: 120 },
      { id: "oven", amountPence: 2000 },
      { id: "products", amountPence: 500 },
    ],
  },
];

test("final cancellation bands use the booking total, retain the 14-day right, and leave older bookings unchanged", () => {
  for (const [hours, percent] of [
    [49, 100],
    [48, 100],
    [47, 75],
    [24, 75],
    [23, 50],
    [12, 50],
    [11, 30],
    [1, 30],
  ]) {
    const start = new Date(Date.parse(now) + hours * 3600000).toISOString();
    const policy = adjustments.visitCancellationPolicy(
      start,
      charges,
      terms,
      now,
    );
    assert.equal(policy.refundPercent, percent, `${hours}h band`);
    assert.equal(
      policy.refundPence,
      7698 - Math.round((7698 * (100 - percent)) / 100),
    );
  }
  const statutory = adjustments.visitCancellationPolicy(
    "2026-11-02T10:00:00Z",
    charges,
    terms,
    now,
    "2026-11-01T10:00:00Z",
  );
  assert.equal(statutory.refundPercent, 100);
  const legacy = adjustments.visitCancellationPolicy(
    "2026-11-02T10:00:00Z",
    charges,
    {
      ...terms,
      cancellationBasis: undefined,
      cancellationRefundPercent: {
        full: 100,
        three_quarter: 75,
        half: 50,
        none: 0,
      },
    },
    now,
  );
  assert.equal(legacy.refundPercent, 50);
});

test("proportional line refunds conserve pennies, include products/add-ons, and never take tips", () => {
  for (let price = 1001; price < 7000; price += 53) {
    const source = [
      {
        ...charges[0],
        amount_pence: price + 2500,
        line_items: [
          { id: "cleaning", amountPence: price },
          { id: "oven", amountPence: 2000 },
          { id: "products", amountPence: 500 },
        ],
      },
    ];
    for (const percent of [0, 30, 50, 75, 100]) {
      const refunds = adjustments.cancellationRefunds(
        source,
        percent,
        false,
        true,
      );
      assert.equal(
        refunds.reduce((sum, row) => sum + row.amountPence, 0),
        price + 2500 - Math.round(((price + 2500) * (100 - percent)) / 100),
      );
      for (const row of refunds)
        assert.equal(
          Object.values(row.refundedLines).reduce(
            (sum, value) => sum + value,
            0,
          ),
          row.amountPence,
        );
    }
  }
  assert.throws(
    () =>
      adjustments.cancellationRefunds(
        [
          {
            ...charges[0],
            line_items: [
              ...charges[0].line_items,
              { id: "tip", amountPence: 300 },
            ],
          },
        ],
        30,
        false,
        true,
      ),
    /reconciliation/,
  );
});
