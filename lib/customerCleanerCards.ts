import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerCleanerOption = {
  provider_id: string;
  display_name: string;
};
export type CustomerFavouriteCard = {
  providerId: string;
  displayName: string;
  photoUrl: string | null;
  ratingAvg: number | null;
};
type PreviousRow = {
  provider_id: string | null;
  packages:
    | { service_type: string | null }
    | { service_type: string | null }[]
    | null;
  providers:
    | {
        customer_first_name: string | null;
        vetting_status: string | null;
        is_suspended: boolean | null;
      }
    | {
        customer_first_name: string | null;
        vetting_status: string | null;
        is_suspended: boolean | null;
      }[]
    | null;
};
function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Use the customer's authenticated client, not a service client. Historic
 * assigned cleaners remain visible through the safe computed relationship. */
export async function loadPreviousCustomerCleaners(
  client: SupabaseClient,
  userId: string,
): Promise<CustomerCleanerOption[]> {
  const { data, error } = await client
    .from("bookings")
    .select(
      "provider_id,packages(service_type),providers:customer_provider_card(customer_first_name,vetting_status,is_suspended)",
    )
    .eq("customer_id", userId)
    .eq("status", "completed");
  if (error) throw Error("Previous cleaners could not be loaded.");
  const options = new Map<string, CustomerCleanerOption>();
  for (const row of (data ?? []) as unknown as PreviousRow[]) {
    const provider = one(row.providers);
    const service = one(row.packages);
    if (
      !row.provider_id ||
      !service?.service_type?.toLowerCase().includes("clean") ||
      !provider ||
      provider.vetting_status !== "approved" ||
      provider.is_suspended
    )
      continue;
    options.set(row.provider_id, {
      provider_id: row.provider_id,
      display_name: provider.customer_first_name?.trim() || "Previous cleaner",
    });
  }
  return [...options.values()];
}

/** Profile and checkout share this whitelist. Never join the private providers
 * table or fall back to its stored name when a card is unavailable. */
export async function loadCustomerFavouriteCards(
  client: SupabaseClient,
  userId: string,
  accountStore: SupabaseClient,
): Promise<CustomerFavouriteCard[]> {
  // Favourite ids are server-only account data; no browser table grant.
  // The caller supplies the authenticated user's id, not request-body input.
  const favourites = await accountStore
    .from("customer_favourite_providers")
    .select("provider_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (favourites.error)
    throw Error("Favourite professionals could not be loaded.");
  const ids = [
    ...new Set<string>((favourites.data ?? []).map((row) => row.provider_id)),
  ];
  if (!ids.length) return [];
  const cards = await client
    .from("customer_provider_cards")
    .select("id,customer_first_name,photo_url,public_rating_avg")
    .in("id", ids);
  if (cards.error) throw Error("Favourite professionals could not be loaded.");
  const byId = new Map((cards.data ?? []).map((card) => [card.id, card]));
  return ids.map((providerId) => {
    const card = byId.get(providerId);
    const rating =
      card?.public_rating_avg == null ? null : Number(card.public_rating_avg);
    return {
      providerId,
      displayName: card?.customer_first_name?.trim() || "Professional",
      photoUrl: card?.photo_url ?? null,
      ratingAvg: rating !== null && Number.isFinite(rating) ? rating : null,
    };
  });
}
