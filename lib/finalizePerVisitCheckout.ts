import "server-only";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { cleaningSeriesQuote } from "./cleaningExtras";
import { visitLineItems } from "./visitLineItems";
import {
  regularVisitSlots,
  isRegularVisitCount,
  type RegularFrequency,
} from "./regularBooking";
import { appointmentFitsWindow } from "./appointmentWindow";
import { bookingPolicyError, isBookingFrequency } from "./bookingPolicy";
import { normaliseOptionalBookingTimes } from "./bookingTimeChoices";
import { matchCleaningBookings } from "./cleaningBookingMatching";
import type { VisitLine } from "./visitBillingPolicy";

export type StagedVisitScope = {
  baseMinutes: number;
  basePricePence: number;
  durationMinutes: number;
  addons: string[];
  bringsProducts: boolean;
  petsAtHome: boolean;
  grossPence: number;
  netPence: number;
  discountPence: number;
  lineItems: VisitLine[];
  notes: string;
};

export async function finalizePerVisitCheckout(
  session: Stripe.Checkout.Session,
  pi: Stripe.PaymentIntent,
) {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const userId = session.client_reference_id;
  const customer =
    typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  const method =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id;
  const sessionCustomer =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  const sessionIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (
    !userId ||
    sessionIntent !== pi.id ||
    pi.metadata.customer_id !== userId ||
    pi.metadata.kind !== "booking" ||
    pi.metadata.billing_model !== "per_visit" ||
    pi.status !== "succeeded" ||
    pi.amount_received !== pi.amount ||
    pi.currency !== "gbp" ||
    pi.capture_method !== "automatic" ||
    !customer ||
    sessionCustomer !== customer ||
    !method
  )
    throw new Error("Invalid visit payment.");
  const { data: mapping, error: mappingError } = await admin
    .from("account_billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (mappingError || mapping?.stripe_customer_id !== customer)
    throw new Error("The saved card belongs to another billing account.");
  const { data: existing } = await admin
    .from("bookings")
    .select("id")
    .eq("checkout_session_id", session.id)
    .eq("customer_id", userId)
    .maybeSingle();
  if (existing) {
    const { data: charge } = await admin
      .from("booking_visit_charges")
      .select("amount_pence")
      .eq("booking_id", existing.id)
      .eq("stripe_payment_intent", pi.id)
      .maybeSingle();
    if (charge?.amount_pence !== pi.amount)
      throw new Error("Saved checkout does not match this payment.");
    return existing.id as string;
  }
  const card = await stripe.paymentMethods.retrieve(method);
  const cardCustomer =
    typeof card.customer === "string" ? card.customer : card.customer?.id;
  // A customer may remove the saved card before a delayed checkout webhook.
  // Preserve the paid booking; the scheduler will ask for a new card later.
  if (card.type !== "card" || (cardCustomer && cardCustomer !== customer))
    throw new Error("A customer card is required.");
  const { data: stage, error: stageError } = await admin
    .from("booking_checkout_time_choices")
    .select(
      "preferred_scheduled_at, optional_scheduled_at, regular_scheduled_at, household_notes, cleaning_extras",
    )
    .eq("checkout_session_id", session.id)
    .eq("customer_id", userId)
    .maybeSingle();
  if (stageError || !stage)
    throw new Error("This checkout's visit details are missing.");
  const plan = stage.cleaning_extras as StagedVisitScope[];
  const frequency = pi.metadata.booking_frequency;
  const { data: pkg, error: packageError } = await admin
    .from("packages")
    .select("id, name, service_type")
    .eq("id", pi.metadata.package_id)
    .maybeSingle();
  const count =
    frequency === "one_time" ? 1 : Number(pi.metadata.regular_visit_count);
  if (
    packageError ||
    !pkg ||
    !isBookingFrequency(frequency) ||
    bookingPolicyError(pkg.name, frequency) ||
    (count !== 1 && !isRegularVisitCount(count)) ||
    !Array.isArray(plan) ||
    plan.length !== count
  )
    throw new Error("The visit plan does not match this service.");
  const baseMinutes = Number(pi.metadata.base_duration_minutes);
  const verified = cleaningSeriesQuote(
    {
      price: plan[0].basePricePence / 100,
      duration_minutes: baseMinutes,
      service_type: pkg.service_type,
    },
    baseMinutes,
    [],
    false,
    count,
    plan,
  );
  for (const [index, scope] of plan.entries()) {
    const lines = visitLineItems(verified.quotes[index], scope.discountPence);
    if (
      typeof scope.petsAtHome !== "boolean" ||
      scope.grossPence !== verified.quotes[index].totalPence ||
      scope.durationMinutes !== verified.quotes[index].durationMinutes ||
      scope.netPence !==
        lines.reduce((sum, line) => sum + line.amountPence, 0) ||
      scope.lineItems.length !== lines.length ||
      lines.some(
        (line, i) =>
          line.id !== scope.lineItems[i].id ||
          line.amountPence !== scope.lineItems[i].amountPence ||
          line.reservedMinutes !== scope.lineItems[i].reservedMinutes,
      )
    )
      throw new Error("The saved line items do not match this checkout.");
  }
  if (plan[0].netPence !== pi.amount)
    throw new Error("First visit amount does not match the captured payment.");
  const slots =
    count === 1
      ? [stage.preferred_scheduled_at]
      : regularVisitSlots(
          stage.preferred_scheduled_at,
          frequency as RegularFrequency,
          baseMinutes,
          session.created * 1000,
          count,
        );
  if (
    slots.some(
      (slot, index) =>
        !appointmentFitsWindow(slot, plan[index].durationMinutes),
    ) ||
    (count > 1 &&
      (stage.regular_scheduled_at?.length !== count ||
        stage.regular_scheduled_at.some(
          (slot: string, index: number) =>
            new Date(slot).getTime() !== new Date(slots[index]).getTime(),
        )))
  )
    throw new Error("Visit dates do not match the saved schedule.");
  const optional = normaliseOptionalBookingTimes(
    stage.optional_scheduled_at ?? [],
    slots[0],
    plan[0].durationMinutes,
    null,
  );
  if (count > 1 && optional.length)
    throw new Error("Regular visits cannot use optional times.");
  const { data: saved, error } = await admin.rpc(
    "finalize_per_visit_checkout",
    {
      p_customer: userId,
      p_session: session.id,
      p_intent: pi.id,
      p_package: pkg.id,
      p_address: pi.metadata.service_address,
      p_notes: stage.household_notes,
      p_frequency: frequency,
      p_slots: slots,
      p_optional: optional,
      p_preferred_provider: pi.metadata.preferred_provider_id || null,
      p_stripe_customer: customer,
      p_method: method,
      p_first_amount: pi.amount,
      p_email: session.customer_details?.email ?? session.customer_email,
    },
  );
  if (error || !saved?.length)
    throw error ?? new Error("Could not save the visit plan.");
  if (pi.metadata.early_start_requested_at)
    await admin
      .from("bookings")
      .update({
        early_start_requested_at: pi.metadata.early_start_requested_at,
      })
      .in("id", saved);
  try {
    await matchCleaningBookings(
      admin,
      saved,
      userId,
      pi.metadata.postcode ?? "",
      pkg.service_type,
      pi.metadata.preferred_provider_id,
    );
  } catch {
    console.error(
      "Paid visits are saved; professional matching needs a retry.",
    );
  }
  return saved[0] as string;
}
