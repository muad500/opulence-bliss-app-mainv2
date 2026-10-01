export function handymanEstimatePence(hourlyRatePence: number, hours: unknown): number | null {
  if (!Number.isInteger(hourlyRatePence) || hourlyRatePence < 100 || hourlyRatePence > 100000 || typeof hours !== "number" || !Number.isFinite(hours) || hours < .5 || hours > 16 || !Number.isInteger(hours * 2)) return null;
  return Math.round(hourlyRatePence * hours);
}
