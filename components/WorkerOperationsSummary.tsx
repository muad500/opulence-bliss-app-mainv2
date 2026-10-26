import type { SupabaseClient } from "@supabase/supabase-js";
import { currentCleaningBillingTerms } from "@/lib/cleaningBillingSettings";
import { graceCancellationsLeft, londonMonth } from "@/lib/workerOperations";

export default async function WorkerOperationsSummary({
  admin,
  providerId,
}: {
  admin: SupabaseClient;
  providerId: string;
}) {
  const [clock, cancellations, terms] = await Promise.all([
    admin
      .from("cleaner_experience_clocks")
      .select("started_at,last_completed_at")
      .eq("provider_id", providerId)
      .maybeSingle(),
    admin
      .from("cleaner_reliability_events")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId)
      .eq("kind", "cancellation")
      .eq("month_start", londonMonth()),
    currentCleaningBillingTerms(admin),
  ]);
  const rate = await admin.rpc("standard_cleaner_experience_rate", {
    p_base: terms.cleanerHourlyPence,
    p_start: clock.data?.started_at ?? null,
    p_last: clock.data?.last_completed_at ?? null,
    p_at: new Date().toISOString(),
  });
  if (clock.error || cancellations.error || rate.error)
    return <p>Your current pay and reliability summary could not be loaded.</p>;
  const money = (pence: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(pence / 100);
  return (
    <section
      aria-labelledby="professional-pay-heading"
      style={{
        background: "#faf7ff",
        border: "1px solid #e7ddf7",
        borderRadius: 16,
        padding: 20,
        marginBottom: 24,
      }}
    >
      <h2
        id="professional-pay-heading"
        style={{ fontSize: 18, margin: "0 0 10px" }}
      >
        Your cleaning pay
      </h2>
      <p>
        Standard cleaning: <strong>{money(rate.data)} per booked hour</strong>.
        Deep and end-of-tenancy:{" "}
        <strong>
          {money(terms.deepCleanerHourlyPence ?? 1750)} per booked hour
        </strong>
        .
      </p>
      <p>
        The standard £15 rate rises to £15.25 in month 6 and £15.50 in month 13,
        counted from your first completed visit. After 90 days without a
        completed visit, the standard rate returns to £15 and your next
        completion starts a new period. The rate agreed when you accept a visit
        is saved for that visit.
      </p>
      <p>
        This month: <strong>{cancellations.count ?? 0} cancellations</strong> of
        accepted visits, with{" "}
        <strong>
          {graceCancellationsLeft(cancellations.count ?? 0)} grace cancellations
          left
        </strong>
        . The third alerts our team. Declining a job offer does not count.
      </p>
    </section>
  );
}
