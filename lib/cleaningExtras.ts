import { bookingPricePence, validCleaningDuration } from "./cleaningBooking";
import {
  DEFAULT_CLEANING_BILLING_TERMS,
  type CleaningBillingTerms,
} from "./cleaningBillingTerms";

export const CLEANING_ADDONS = [
  { id: "oven", label: "Oven", pricePence: 2000 },
  { id: "fridge", label: "Inside fridge", pricePence: 1000 },
  { id: "cupboards", label: "Inside cupboards", pricePence: 1000 },
  { id: "windows", label: "Interior windows", pricePence: 1500 },
  { id: "ironing", label: "Ironing", pricePence: 1500 },
] as const;
export type CleaningAddonId = (typeof CLEANING_ADDONS)[number]["id"];
export const CLEANING_PRODUCTS_FEE_PENCE = 500;

/** Server and client share the catalogue; the request never supplies prices. */
type ExtraPrices = Pick<
  CleaningBillingTerms,
  "addonPrices" | "productsFeePence"
>;
export function parseCleaningExtras(
  addons: unknown,
  bringsProducts: unknown,
  prices: ExtraPrices = DEFAULT_CLEANING_BILLING_TERMS,
) {
  if (
    !Array.isArray(addons) ||
    addons.some((id) => !CLEANING_ADDONS.some((item) => item.id === id)) ||
    new Set(addons).size !== addons.length
  ) {
    throw new Error("Choose each available add-on only once.");
  }
  if (typeof bringsProducts !== "boolean")
    throw new Error("Choose who brings cleaning products.");
  const selected = CLEANING_ADDONS.filter((item) =>
    addons.includes(item.id),
  ).map((item) => ({ ...item, pricePence: prices.addonPrices[item.id] }));
  return {
    addons: selected,
    bringsProducts,
    addonPence: selected.reduce((sum, item) => sum + item.pricePence, 0),
    extraMinutes: selected.length * 60,
    productsPence: bringsProducts ? prices.productsFeePence : 0,
  };
}

export function cleaningQuote(
  pkg: Parameters<typeof bookingPricePence>[0],
  baseMinutes: number,
  addons: unknown,
  bringsProducts: unknown,
  visits: number,
  prices: ExtraPrices = DEFAULT_CLEANING_BILLING_TERMS,
) {
  if (
    !validCleaningDuration(baseMinutes) ||
    !Number.isInteger(visits) ||
    (visits !== 1 && (visits < 6 || visits > 10))
  )
    throw new Error("Choose valid cleaning hours and visits.");
  const extras = parseCleaningExtras(addons, bringsProducts, prices);
  const durationMinutes = baseMinutes + extras.extraMinutes;
  if (!validCleaningDuration(durationMinutes))
    throw new Error(
      "Cleaning and add-ons together must fit within 8 hours. Reduce cleaning hours or remove an add-on.",
    );
  const basePence = bookingPricePence(pkg, baseMinutes);
  const perVisitPence = basePence + extras.addonPence;
  return {
    ...extras,
    baseMinutes,
    durationMinutes,
    basePence,
    perVisitPence: perVisitPence + extras.productsPence,
    totalPence: (perVisitPence + extras.productsPence) * visits,
  };
}

export type VisitExtras = {
  addons: CleaningAddonId[];
  bringsProducts: boolean;
};
export function cleaningSeriesQuote(
  pkg: Parameters<typeof bookingPricePence>[0],
  baseMinutes: number,
  addons: unknown,
  bringsProducts: unknown,
  visits: number,
  overrides: unknown = [],
  prices: ExtraPrices = DEFAULT_CLEANING_BILLING_TERMS,
) {
  if (
    !Number.isInteger(visits) ||
    (visits !== 1 && (visits < 6 || visits > 10))
  )
    throw new Error("Choose valid booked visits.");
  if (
    !Array.isArray(overrides) ||
    (overrides.length !== 0 && overrides.length !== visits)
  )
    throw new Error("Choose add-ons for every booked visit.");
  const quotes = Array.from({ length: visits }, (_, index) => {
    const choice = overrides[index];
    if (
      choice !== undefined &&
      (!choice || typeof choice !== "object" || Array.isArray(choice))
    )
      throw new Error("Choose valid visit add-ons.");
    return cleaningQuote(
      pkg,
      baseMinutes,
      choice?.addons ?? addons,
      choice?.bringsProducts ?? bringsProducts,
      1,
      prices,
    );
  });
  return {
    quotes,
    totalPence: quotes.reduce((sum, item) => sum + item.totalPence, 0),
    maxDurationMinutes: Math.max(...quotes.map((item) => item.durationMinutes)),
  };
}

/** Promotions use the platform's margin, preserving each professional's pay. */
export function allocateCleaningPayments(amounts: number[], discount: number) {
  const margins = amounts.map((amount) => Math.round(amount * 0.2));
  const cap = margins.reduce((sum, margin) => sum + margin, 0);
  if (
    !Number.isInteger(discount) ||
    discount < 0 ||
    discount > cap ||
    amounts.some((amount) => !Number.isInteger(amount) || amount <= 0)
  )
    throw new Error("Invalid cleaning payment allocation.");
  let remaining = discount;
  return amounts.map((amount, index) => {
    const used =
      discount === 0
        ? 0
        : index === amounts.length - 1
          ? remaining
          : Math.min(remaining, Math.floor((discount * margins[index]) / cap));
    remaining -= used;
    return {
      grossPence: amount - used,
      platformPence: margins[index] - used,
      providerPence: amount - margins[index],
    };
  });
}

export function cleaningExtrasNotes(
  addons: unknown,
  bringsProducts: boolean,
  petsAtHome: boolean,
  prices: ExtraPrices = DEFAULT_CLEANING_BILLING_TERMS,
) {
  const extras = parseCleaningExtras(addons, bringsProducts, prices);
  return [
    `Pets at home: ${petsAtHome ? "Yes" : "No"}`,
    `Cleaning products: ${bringsProducts ? `cleaner brings products (£${(prices.productsFeePence / 100).toFixed(2)} per visit)` : "supplied by customer"}`,
    ...(extras.addons.length
      ? [
          `Add-ons: ${extras.addons.map((item) => `${item.label} (up to 1 hour)`).join(", ")}`,
        ]
      : []),
  ].join("\n");
}
