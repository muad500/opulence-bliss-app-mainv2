import { handymanBill } from "./handymanMarketplace";

export type HandymanEarning = {
  id: string;
  task_name: string;
  scheduled_at: string;
  status: string;
  hourly_rate_pence: number;
  estimated_minutes: number;
  vat_bps: number;
  transfer_ref: string | null;
  bill: { provider: number; gross: number } | null;
};

export function handymanEarnings(jobs: HandymanEarning[]) {
  const paid = jobs.filter(
    (job) => job.status === "completed" && !!job.transfer_ref && !!job.bill,
  );
  const pending = jobs.filter((job) =>
    [
      "scheduled",
      "in_progress",
      "awaiting_customer",
      "awaiting_authorization",
      "payment_pending",
    ].includes(job.status),
  );
  const share = (job: HandymanEarning) =>
    (job.bill?.provider ??
      handymanBill(job.hourly_rate_pence, job.estimated_minutes, job.vat_bps, 0)
        .provider) / 100;
  return {
    paid,
    pending,
    settled: paid.reduce((total, job) => total + share(job), 0),
    awaitingSettlement: pending.reduce((total, job) => total + share(job), 0),
    periods: paid.map((job) => ({
      date: job.scheduled_at,
      amount: share(job),
    })),
    rows: [...paid, ...pending].map((job) => ({
      key: `handyman-${job.id}`,
      service: `Handyman · ${job.task_name}`,
      when: job.scheduled_at,
      label: job.bill
        ? "professional payout, including approved materials and VAT"
        : "estimated labour payout",
      amount: share(job),
      state: paid.includes(job) ? "Paid" : "Pending",
      note: job.transfer_ref ? `Stripe transfer ${job.transfer_ref}` : null,
    })),
  };
}
