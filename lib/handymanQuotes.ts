import { HANDYMAN_TASKS } from "./handymanMarketplace";

export const HIDDEN_HANDYMAN_TASKS = [
  "Plumbing",
  "Bathroom installations",
  "Kitchen installations",
  "Emergency repairs",
] as const;
export const ALL_HANDYMAN_TASKS = [...HANDYMAN_TASKS, ...HIDDEN_HANDYMAN_TASKS];
export const HANDYMAN_MAX_QUOTE_PENCE = 1_000_000;
export const handymanMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
export function handymanQuoteSplit(total: number, commissionBps = 2000) {
  if (
    !Number.isSafeInteger(total) ||
    total < 50 ||
    total > HANDYMAN_MAX_QUOTE_PENCE ||
    !Number.isSafeInteger(commissionBps) ||
    commissionBps < 0 ||
    commissionBps > 5000
  )
    throw new Error("Enter a valid fixed quote and commission.");
  const platform = Math.round((total * commissionBps) / 10000);
  return { gross: total, platform, provider: total - platform };
}
export function handymanPence(value: string) {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a total price with at most two decimal places.");
  const [pounds, fraction = ""] = value.split(".");
  const amount = Number(pounds) * 100 + Number(fraction.padEnd(2, "0"));
  handymanQuoteSplit(amount);
  return amount;
}
export function handymanPostcode(value: unknown) {
  const compact =
    typeof value === "string" ? value.replace(/\s/g, "").toUpperCase() : "";
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact))
    throw new Error("Enter a valid UK postcode.");
  return compact.slice(0, -3) + " " + compact.slice(-3);
}
export function handymanPreferredDates(value: unknown, now = Date.now()) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10)
    throw new Error("Choose one to ten preferred dates.");
  const dates = value.map((v: unknown) => {
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      new Date(v + "T12:00:00Z").toISOString().slice(0, 10) !== v
    )
      throw new Error("Choose valid dates.");
    const days = (Date.parse(v + "T23:59:59Z") - now) / 86400000;
    if (days < 0 || days > 366)
      throw new Error("Choose dates within the next year.");
    return v;
  });
  return [...new Set(dates)].sort();
}
export type HandymanQuote = {
  id: string;
  job_id: string;
  provider_id: string;
  kind: "quote" | "site_visit" | "revision";
  total_pence: number;
  scope: string;
  duration_minutes: number;
  earliest_at: string;
  status: string;
  created_at: string;
  display_name?: string;
};
export type HandymanQuoteJob = {
  id: string;
  customer_id: string;
  provider_id: string | null;
  quote_mode: boolean;
  task_name: string;
  description: string;
  postcode: string;
  address: string;
  preferred_dates: string[];
  scheduled_at: string | null;
  status: string;
  selected_quote_id: string | null;
  pending_quote_id: string | null;
  commission_bps: number | null;
  total_pence: number;
  paid_pence: number;
  refunded_pence: number;
  refund_bands?: {
    full: number;
    three_quarter: number;
    half: number;
    none: number;
  };
  payout_account_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  confirm_after: string | null;
  bill: { gross: number; provider: number; platform: number } | null;
  created_at: string;
};
