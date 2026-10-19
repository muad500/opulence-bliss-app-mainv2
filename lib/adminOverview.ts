import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  ADMIN_PREVIEW_LIMIT,
  pendingProfessionalFilter,
} from "./adminDashboard";
import { loadAdminReviews } from "./adminReviews";
export async function loadAdminOverview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  handyman: boolean,
) {
  const fields =
    "id,display_name,services,service_approvals,vetting_status,is_suspended,created_at,profile:profiles!providers_profile_id_fkey(email)";
  const [bookings, customers, professionals, approvals, reviews] =
    await Promise.all([
      supabase.from("bookings").select("id", { count: "exact", head: true }),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .neq("role", "admin")
        .is("account_deleted_at", null),
      supabase
        .from("providers")
        .select(fields, { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(ADMIN_PREVIEW_LIMIT),
      supabase
        .from("providers")
        .select(fields, { count: "exact" })
        .or(pendingProfessionalFilter(handyman))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(ADMIN_PREVIEW_LIMIT),
      loadAdminReviews(supabase, ADMIN_PREVIEW_LIMIT),
    ]);
  return { bookings, customers, professionals, approvals, reviews };
}
