import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { providerPaymentLabel } from "@/lib/providerPaymentStatus";
import type { ProviderInvoicePdfData } from "@/lib/invoicePdf";

export type WorkerJobWorkspaceData = {
  id: string;
  status: string;
  service: string;
  durationMinutes: number | null;
  propertySizeSqm?: number | null;
  contactEnd: string | null;
  scheduledAt: string;
  preferredScheduledAt: string | null;
  optionalScheduledAt: string[];
  createdAt: string | null;
  confirmedAt: string | null;
  delayMinutes: number | null;
  delayReportedAt: string | null;
  address: string | null;
  notes: string | null;
  isMembership: boolean;
  client: {
    name: string;
    email: string | null;
    /** Only returned while the job is scheduled or in progress. */
    phone: string | null;
    rating: number | null;
    ratingCount: number;
    completedWithYou: number;
  };
  money: {
    earns: number | null;
    gross: number | null;
    platformFee: number | null;
    tips: number;
    label: string;
    explanation: string;
  };
  checkIn: {
    arrivedAt: string | null;
    leftAt: string | null;
    geofencePass: boolean | null;
    distanceMetres: number | null;
  };
  invoice: (ProviderInvoicePdfData & { id: string }) | null;
  existingClientRating: {
    rating: number;
    comment: string | null;
  } | null;
  hasRatedClient: boolean;
};

type BookingPackage = {
  name: string;
  duration_minutes: number | null;
};

type BookingProvider = {
  display_name: string | null;
};

type CheckIn = {
  arrived_at: string | null;
  left_at: string | null;
  geofence_pass: boolean | null;
  distance_metres: number | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function payoutExplanation({
  bookingStatus,
  paymentStatus,
  payoutStatus,
  membership,
}: {
  bookingStatus: string;
  paymentStatus: string | null;
  payoutStatus: string | null;
  membership: boolean;
}) {
  switch (payoutStatus) {
    case "paid":
      return "Sent to your connected Stripe account.";
    case "processing":
      return "Stripe is processing your payout.";
    case "pending":
      return "Ready for the next payout run.";
    case "held":
      return "Held while the resolution team reviews this visit.";
    case "failed":
      return "The payout needs attention from the resolution team.";
    case "reversed":
      return "The payout was reversed and is under review.";
    case "not_ready":
      return membership
        ? "Released only after the covering membership invoice is paid and the visit is complete."
        : "Released only after the customer payment is captured and the visit is complete.";
  }

  if (bookingStatus === "completed") {
    return "The visit is complete and the payout status will update here.";
  }
  if (paymentStatus === "authorised") {
    return "The customer payment is secured. Your payout becomes ready after check-out.";
  }
  return membership
    ? "This visit is covered by the client's membership."
    : "Your quoted earnings are secured for this booking.";
}

export async function loadWorkerJob(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<WorkerJobWorkspaceData | null> {
  const { data: row } = await supabase
    .rpc("worker_visible_bookings")
    .select(
      "id, created_at, scheduled_at, preferred_scheduled_at, optional_scheduled_at, status, address, household_notes, rooms_to_clean, access_instructions, customer_id, customer_email, provider_id, provider_payout, subscription_id, provider_delay_minutes, provider_delay_reported_at, duration_minutes, property_size_sqm, packages(name, duration_minutes), providers!bookings_provider_id_fkey(display_name), check_ins(arrived_at, left_at, geofence_pass, distance_metres)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (!row) return null;

  const [
    customerResult,
    paymentResult,
    payoutResult,
    eventResult,
    ratingResult,
    invoiceResult,
    submissionResult,
  ] = await Promise.all([
    supabase.rpc("booking_customer_summary", { p_booking_id: row.id }),
    supabase
      .rpc("worker_visible_payments")
      .select("gross_amount, split_breakdown, status, kind, created_at")
      .eq("booking_id", row.id)
      .returns<
        {
          gross_amount: number | null;
          split_breakdown: { provider?: number; platform?: number } | null;
          status: string;
          kind: string;
          created_at: string;
        }[]
      >(),
    supabase
      .rpc("worker_visible_payouts")
      .select("status")
      .eq("booking_id", row.id)
      .maybeSingle(),
    supabase
      .from("booking_events")
      .select("to_status, created_at")
      .eq("booking_id", row.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("reviews")
      .select("rating, comment")
      .eq("booking_id", row.id)
      .eq("reviewer", "provider")
      .maybeSingle(),
    supabase
      .rpc("worker_visible_invoices")
      .select(
        "id, invoice_number, issued_at, status, customer_name, service_name, address, property_size_sqm, duration_minutes, gross_amount, platform_fee, payout_amount, payout_schedule, payout_due_on",
      )
      .eq("booking_id", row.id)
      .maybeSingle(),
    supabase.rpc("my_review_submission_states"),
  ]);

  const customer = one(customerResult.data as never) as {
    full_name: string | null;
    client_rating_avg: number | null;
    client_rating_count: number | null;
    phone?: string | null;
  } | null;
  const payments = (
    Array.isArray(paymentResult.data) ? paymentResult.data : []
  ) as {
    gross_amount: number | null;
    split_breakdown: { provider?: number; platform?: number } | null;
    status: string;
    kind: string;
    created_at: string;
  }[];
  const jobPayment = payments.find((payment) => payment.kind !== "tip");
  const tips = payments
    .filter((payment) => payment.kind === "tip")
    .reduce((total, payment) => total + Number(payment.gross_amount ?? 0), 0);
  const payoutStatus = payoutResult.data?.status ?? null;
  const packageRow = one(row.packages as never) as BookingPackage | null;
  const provider = one(row.providers as never) as BookingProvider | null;
  const checkIn = one(row.check_ins as never) as CheckIn | null;
  const split = jobPayment?.split_breakdown as {
    provider?: number;
    platform_margin?: number;
  } | null;
  const gross =
    jobPayment?.gross_amount === null || jobPayment?.gross_amount === undefined
      ? null
      : Number(jobPayment.gross_amount);
  const payablePayments = payments.filter(
    (payment) =>
      payment.kind !== "tip" &&
      !["refunded", "cancelled"].includes(payment.status),
  );
  let earnsValue =
    row.provider_payout ??
    (payablePayments.length
      ? payablePayments.reduce(
          (sum, payment) =>
            sum + Number(payment.split_breakdown?.provider ?? 0),
          0,
        )
      : split?.provider);
  if (row.status === "cancelled") {
    const { data: compensation } = await supabase
      .from("cleaning_cancellation_settlements")
      .select("cleaner_pay_pence")
      .eq("booking_id", row.id)
      .maybeSingle();
    if (compensation) earnsValue = Number(compensation.cleaner_pay_pence) / 100;
  }
  const earns =
    earnsValue === null || earnsValue === undefined ? null : Number(earnsValue);
  const explicitFee = split?.platform_margin;
  const platformFee =
    explicitFee !== null && explicitFee !== undefined
      ? Number(explicitFee)
      : !row.subscription_id && gross !== null && earns !== null
        ? Math.max(0, gross - earns)
        : null;

  let completedWithYou = 0;
  if (row.customer_id && row.provider_id) {
    const { count } = await supabase
      .rpc("worker_visible_bookings", {}, { count: "exact", head: true })
      .select("*")
      .eq("customer_id", row.customer_id)
      .eq("provider_id", row.provider_id)
      .eq("status", "completed");
    completedWithYou = count ?? 0;
  }

  const paymentStatus = jobPayment?.status ?? null;
  const isMembership = Boolean(row.subscription_id);
  const events = eventResult.data ?? [];

  return {
    id: row.id,
    status: row.status,
    service: packageRow?.name ?? "Service",
    propertySizeSqm: row.property_size_sqm ?? null,
    durationMinutes:
      row.duration_minutes ?? packageRow?.duration_minutes ?? null,
    contactEnd:
      (await supabase.rpc("booking_contact_state", { p_booking_id: row.id }))
        .data?.visitEnd ?? null,
    scheduledAt: row.scheduled_at,
    preferredScheduledAt: row.preferred_scheduled_at ?? row.scheduled_at,
    optionalScheduledAt: row.optional_scheduled_at ?? [],
    createdAt:
      row.created_at ?? jobPayment?.created_at ?? events[0]?.created_at ?? null,
    confirmedAt:
      events.find((event) => event.to_status === "scheduled")?.created_at ??
      null,
    delayMinutes: row.provider_delay_minutes ?? null,
    delayReportedAt: row.provider_delay_reported_at ?? null,
    address: row.address,
    notes:
      [
        row.household_notes,
        row.rooms_to_clean ? `Rooms to clean: ${row.rooms_to_clean}` : null,
        row.access_instructions ? `Access: ${row.access_instructions}` : null,
      ]
        .filter(Boolean)
        .join("\n") || null,
    isMembership,
    client: {
      name: customer?.full_name ?? row.customer_email ?? "Client",
      email: null,
      phone: null,
      rating:
        customer?.client_rating_avg === null ||
        customer?.client_rating_avg === undefined
          ? null
          : Number(customer.client_rating_avg),
      ratingCount: customer?.client_rating_count ?? 0,
      completedWithYou,
    },
    money: {
      earns,
      gross,
      platformFee,
      tips,
      label: providerPaymentLabel({
        bookingStatus: row.status,
        paymentStatus,
        payoutStatus,
        amount: earns,
      }),
      explanation: payoutExplanation({
        bookingStatus: row.status,
        paymentStatus,
        payoutStatus,
        membership: isMembership,
      }),
    },
    checkIn: {
      arrivedAt: checkIn?.arrived_at ?? null,
      leftAt: checkIn?.left_at ?? null,
      geofencePass: checkIn?.geofence_pass ?? null,
      distanceMetres: checkIn?.distance_metres ?? null,
    },
    invoice: invoiceResult.data
      ? {
          id: invoiceResult.data.id,
          invoiceNumber: invoiceResult.data.invoice_number,
          issuedAt: invoiceResult.data.issued_at,
          status: invoiceResult.data.status,
          professionalName: provider?.display_name ?? "Professional",
          customerName: invoiceResult.data.customer_name,
          serviceName: invoiceResult.data.service_name,
          address: invoiceResult.data.address,
          propertySizeSqm:
            invoiceResult.data.property_size_sqm === null
              ? null
              : Number(invoiceResult.data.property_size_sqm),
          bookedAt: row.scheduled_at,
          durationMinutes: Number(invoiceResult.data.duration_minutes),
          checkedInAt: checkIn?.arrived_at ?? null,
          checkedOutAt: checkIn?.left_at ?? null,
          grossAmount:
            invoiceResult.data.gross_amount === null
              ? null
              : Number(invoiceResult.data.gross_amount),
          platformFee:
            invoiceResult.data.platform_fee === null
              ? null
              : Number(invoiceResult.data.platform_fee),
          payoutAmount: Number(invoiceResult.data.payout_amount),
          payoutSchedule: invoiceResult.data.payout_schedule,
          payoutDueOn: invoiceResult.data.payout_due_on,
        }
      : null,
    existingClientRating: ratingResult.data
      ? {
          rating: Number(ratingResult.data.rating),
          comment: ratingResult.data.comment,
        }
      : null,
    hasRatedClient: (
      (submissionResult.data ?? []) as Array<{
        booking_id: string;
        reviewer: string;
      }>
    ).some(
      (review) =>
        review.booking_id === row.id && review.reviewer === "provider",
    ),
  };
}
