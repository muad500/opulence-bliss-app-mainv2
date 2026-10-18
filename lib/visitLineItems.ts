import type { cleaningQuote } from "./cleaningExtras";
import { assertVisitLines, type VisitLine } from "./visitBillingPolicy";

export function visitLineItems(
  quote: ReturnType<typeof cleaningQuote>,
  discountPence = 0,
): VisitLine[] {
  if (
    !Number.isSafeInteger(discountPence) ||
    discountPence < 0 ||
    discountPence >= quote.basePence
  )
    throw new Error("Invalid visit discount.");
  const lines: VisitLine[] = [
    {
      id: "cleaning",
      label: "Cleaning",
      amountPence: quote.basePence - discountPence,
      reservedMinutes: quote.baseMinutes,
    },
  ];
  for (const addon of quote.addons)
    lines.push({
      id: addon.id,
      label: addon.label,
      amountPence: addon.pricePence,
      reservedMinutes: 60,
    });
  if (quote.bringsProducts)
    lines.push({
      id: "products",
      label: "Cleaner brings products",
      amountPence: quote.productsPence,
      reservedMinutes: 0,
    });
  assertVisitLines(lines);
  return lines;
}

/** Allocate a plan discount without assigning any cleaner/platform earnings. */
export function visitDiscounts(amounts: number[], discountPence: number) {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (
    !Number.isSafeInteger(discountPence) ||
    discountPence < 0 ||
    discountPence >= total ||
    amounts.some((amount) => !Number.isSafeInteger(amount) || amount <= 0)
  )
    throw new Error("Invalid plan discount.");
  let remaining = discountPence;
  return amounts.map((amount, index) => {
    const allocated =
      index === amounts.length - 1
        ? remaining
        : Math.floor((discountPence * amount) / total);
    remaining -= allocated;
    return allocated;
  });
}
