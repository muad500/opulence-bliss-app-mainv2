const MONEY =
  /(?:[£$€]\s*\d[\d,.]*(?:\s*\/\s*(?:hr|hour))?|\b\d[\d,.]*\s*(?:GBP|pounds?|pence)\b)/gi;

export function serviceTextWithoutPrices(text: string) {
  return text.replace(MONEY, "the price shown when booking");
}

/** Keep prices/calculations in checkout, never in the model's tool context. */
export function assistantWithoutPrices(value: unknown): unknown {
  if (typeof value === "string") return serviceTextWithoutPrices(value);
  if (Array.isArray(value)) return value.map(assistantWithoutPrices);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/(?:price|amount|pence|total_gbp|due_now|hourly_rate|products_fee|split_breakdown|payout|earnings)/i.test(
              key,
            ),
        )
        .map(([key, entry]) => [key, assistantWithoutPrices(entry)]),
    );
  }
  return value;
}

export function priceFreeAssistantReply(text: string) {
  MONEY.lastIndex = 0;
  return MONEY.test(text)
    ? "You can see the full price on the booking page before confirming. [Book a service](/book)."
    : text;
}
