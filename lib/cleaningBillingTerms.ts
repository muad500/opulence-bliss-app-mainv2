export const CLEANING_ADDON_IDS = [
  "oven",
  "fridge",
  "cupboards",
  "windows",
  "ironing",
] as const;

export type CleaningBillingTerms = {
  version: string;
  cleanerHourlyPence: number;
  addonPrices: Record<(typeof CLEANING_ADDON_IDS)[number], number>;
  productsFeePence: number;
  tipMinimumPence: number;
  cancellationRefundPercent: {
    full: number;
    three_quarter: number;
    half: number;
    none: number;
  };
};

/** Old bookings keep these prices unless they already carry their own snapshot. */
export const DEFAULT_CLEANING_BILLING_TERMS: CleaningBillingTerms = {
  version: "legacy-default",
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
  cancellationRefundPercent: {
    full: 100,
    three_quarter: 75,
    half: 50,
    none: 0,
  },
};

export function parseCleaningBillingTerms(
  value: unknown,
): CleaningBillingTerms {
  if (!value || typeof value !== "object")
    throw new Error("Billing settings are missing.");
  const source = value as CleaningBillingTerms;
  const money = (amount: unknown, max: number, minimum = 0) => {
    if (
      !Number.isSafeInteger(amount) ||
      Number(amount) < minimum ||
      Number(amount) > max
    )
      throw new Error("Enter a valid amount with at most two decimal places.");
    return Number(amount);
  };
  if (typeof source.version !== "string" || source.version.length > 100)
    throw new Error("Billing settings version is missing.");
  const refunds = source.cancellationRefundPercent;
  if (
    !refunds ||
    !CLEANING_ADDON_IDS.every((id) => source.addonPrices?.[id] !== undefined)
  )
    throw new Error("Complete every price and cancellation band.");
  const percentages = [
    refunds.full,
    refunds.three_quarter,
    refunds.half,
    refunds.none,
  ];
  percentages.forEach((percent) => money(percent, 100));
  if (
    percentages.some(
      (percent, index) => index > 0 && percent > percentages[index - 1],
    )
  )
    throw new Error(
      "Refund percentages must not increase closer to the visit.",
    );
  return {
    version: source.version,
    cleanerHourlyPence: money(source.cleanerHourlyPence, 10000, 1),
    addonPrices: Object.fromEntries(
      CLEANING_ADDON_IDS.map((id) => [
        id,
        money(source.addonPrices[id], 50000),
      ]),
    ) as CleaningBillingTerms["addonPrices"],
    productsFeePence: money(source.productsFeePence, 10000),
    tipMinimumPence: money(source.tipMinimumPence, 10000, 50),
    cancellationRefundPercent: { ...refunds },
  };
}

export function cleanerPayPence(
  baseMinutes: number,
  terms: CleaningBillingTerms,
) {
  if (
    !Number.isSafeInteger(baseMinutes) ||
    baseMinutes < 120 ||
    baseMinutes > 480 ||
    baseMinutes % 30
  )
    throw new Error("Invalid booked cleaning hours.");
  return Math.round((baseMinutes * terms.cleanerHourlyPence) / 60);
}

/** Customer-facing terms omit the private pay calculation. */
export function customerBillingTerms(terms: CleaningBillingTerms) {
  const { cleanerHourlyPence: _privatePay, ...customer } = terms;
  return customer;
}
