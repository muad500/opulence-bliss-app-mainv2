import "server-only";

import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type AdminReview = {
  id: string;
  reviewer: "client" | "provider";
  rating: number;
  comment: string | null;
  visibility: "public" | "private";
  created_at: string;
  bookingReference: string;
  category: "Cleaner review" | "Client review";
  reviewerName: string;
  reviewerProfileHref: string | null;
  recipientName: string;
  recipientProfileHref: string | null;
};

type ReviewRow = {
  id: string;
  booking_id: string;
  reviewer: string;
  rating: number;
  comment: string | null;
  visibility: string;
  created_at: string;
};
type BookingRow = {
  id: string;
  customer_id: string | null;
  provider_id: string | null;
};
type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};
type ProviderRow = {
  id: string;
  display_name: string | null;
  profile_id: string | null;
};

export async function loadAdminReviews(
  supabase: SupabaseClient,
  limit: number,
  options?: { offset: number; reviewer?: "client" | "provider" },
): Promise<{
  reviews: AdminReview[];
  error: string | null;
  count: number | null;
}> {
  let query = supabase
    .from("reviews")
    .select(
      "id, booking_id, reviewer, rating, comment, visibility, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (options?.reviewer) query = query.eq("reviewer", options.reviewer);
  const reviewResult = await (options
    ? query.range(options.offset, options.offset + limit - 1)
    : query.limit(limit));

  if (reviewResult.error) {
    return { reviews: [], error: reviewResult.error.message, count: null };
  }

  const rows = (reviewResult.data ?? []) as ReviewRow[];
  const bookingIds = [
    ...new Set(rows.map((review) => review.booking_id).filter(Boolean)),
  ];
  const bookingResult = bookingIds.length
    ? await supabase
        .from("bookings")
        .select("id, customer_id, provider_id")
        .in("id", bookingIds)
    : { data: [], error: null };

  if (bookingResult.error) {
    return { reviews: [], error: bookingResult.error.message, count: null };
  }

  const bookingRows = (bookingResult.data ?? []) as BookingRow[];
  const bookings = new Map<string, BookingRow>(
    bookingRows.map((booking): [string, BookingRow] => [booking.id, booking]),
  );
  const customerIds = [
    ...new Set(
      bookingRows
        .map((booking) => booking.customer_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const providerIds = [
    ...new Set(
      bookingRows
        .map((booking) => booking.provider_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [customerResult, providerResult] = await Promise.all([
    customerIds.length
      ? supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
    providerIds.length
      ? supabase
          .from("providers")
          .select("id, display_name, profile_id")
          .in("id", providerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (customerResult.error || providerResult.error) {
    return {
      reviews: [],
      count: null,
      error:
        customerResult.error?.message ??
        providerResult.error?.message ??
        "Reviews could not be loaded.",
    };
  }

  const customerRows = (customerResult.data ?? []) as CustomerRow[];
  const providerRows = (providerResult.data ?? []) as ProviderRow[];
  const customers = new Map<string, CustomerRow>(
    customerRows.map((profile): [string, CustomerRow] => [profile.id, profile]),
  );
  const providers = new Map<string, ProviderRow>(
    providerRows.map((provider): [string, ProviderRow] => [
      provider.id,
      provider,
    ]),
  );

  return {
    error: null,
    count: reviewResult.count ?? null,
    reviews: rows.map((review) => {
      const booking = bookings.get(review.booking_id);
      const customer = booking?.customer_id
        ? customers.get(booking.customer_id)
        : null;
      const provider = booking?.provider_id
        ? providers.get(booking.provider_id)
        : null;
      const clientName =
        customer?.full_name || customer?.email || "Unknown client";
      const cleanerName = provider?.display_name || "Unknown cleaner";
      const clientHref = booking?.customer_id
        ? `/admin/customers/${booking.customer_id}`
        : null;
      const cleanerHref = booking?.provider_id
        ? `/admin/cleaners/${booking.provider_id}`
        : null;

      return {
        id: review.id,
        reviewer: review.reviewer as "client" | "provider",
        rating: review.rating,
        comment: review.comment,
        visibility: review.visibility as "public" | "private",
        created_at: review.created_at,
        bookingReference: review.booking_id.slice(0, 8).toUpperCase(),
        category:
          review.reviewer === "client" ? "Cleaner review" : "Client review",
        reviewerName: review.reviewer === "client" ? clientName : cleanerName,
        reviewerProfileHref:
          review.reviewer === "client" ? clientHref : cleanerHref,
        recipientName: review.reviewer === "client" ? cleanerName : clientName,
        recipientProfileHref:
          review.reviewer === "client" ? cleanerHref : clientHref,
      };
    }),
  };
}
