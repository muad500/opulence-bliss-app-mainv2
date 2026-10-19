export type JobOfferSettings = {
  firstWaveSize: number;
  secondWaveAfterMinutes: number;
  version: number;
};

export function parseJobOfferSettings(value: unknown): JobOfferSettings {
  if (!value || typeof value !== "object")
    throw new Error("Invalid job-offer settings.");
  const row = value as Record<string, unknown>;
  const integer = (name: string, maximum: number) => {
    const result = row[name];
    if (
      typeof result !== "number" ||
      !Number.isInteger(result) ||
      result < 1 ||
      result > maximum
    )
      throw new Error(`${name} must be a whole number from 1 to ${maximum}.`);
    return result;
  };
  return {
    firstWaveSize: integer("firstWaveSize", 100),
    secondWaveAfterMinutes: integer("secondWaveAfterMinutes", 1440),
    version: integer("version", Number.MAX_SAFE_INTEGER),
  };
}

/** Only outward districts may leave the server for distance lookup. */
export function offerOutcode(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toUpperCase();
  return (
    text.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/)?.[1] ??
    (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(text) ? text : null)
  );
}
