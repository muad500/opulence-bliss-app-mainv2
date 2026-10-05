"use server";

// Admin data tools. Save at: app/admin/actions.ts
// Every action checks the caller is an admin first.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { rescheduleBookingState } from "@/lib/bookingState";
import { rotateBookingOffer } from "@/lib/offerRotation";
import {dbsRecheckDate} from '@/lib/verificationRenewal';
import { assertDevelopmentToolsEnabled } from "@/lib/developmentTools";

const admin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: p } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (p?.role !== "admin") throw new Error("Admins only");
  return supabase;
}

const ALL = "00000000-0000-0000-0000-000000000000"; // sentinel for "match everything"

/**
 * Destructive tools are for demo data only.
 *
 * Deleting local financial records while Stripe keeps the charges and
 * transfers permanently destroys our ability to reconcile real money.
 */
function assertTestMode(tool: string) {
  assertDevelopmentToolsEnabled(process.env, tool);
}

async function approvalRequirements(id: string): Promise<string[]> {
  const [dbsResult, checksResult, providerResult] = await Promise.all([
    admin
    .from("provider_dbs_checks")
    .select("status, uploaded_at,issue_date")
    .eq("provider_id", id)
    .maybeSingle(),
    admin
    .from("provider_verification_items")
    .select("document_type,status,uploaded_at,document_storage_path,expires_at,next_check_at,gov_uk_checked_on,reference")
    .eq("provider_id", id)
    .in("document_type", ["right_to_work", "photo_id", "public_liability_insurance"]),
    admin.from("providers").select("services").eq("id",id).single(),
  ]);
  if (dbsResult.error || checksResult.error || providerResult.error) throw new Error("Private verification records could not be loaded.");
  const missing: string[] = [];
  if (dbsResult.data?.status !== "verified" || !dbsResult.data.uploaded_at) missing.push("DBS certificate");
  const today = new Date().toISOString().slice(0, 10);
  if(dbsResult.data&&(dbsRecheckDate(dbsResult.data.issue_date)??'')<today)missing.push('annual DBS re-check');
  for (const [type, label] of [["right_to_work", "right to work"], ["photo_id", "photo ID"]] as const) {
    const check = checksResult.data?.find((item) => item.document_type === type);
    if (!check || check.status !== "verified" || !check.uploaded_at || (!check.document_storage_path&&!(type==='right_to_work'&&check.reference&&/^[A-Z0-9]{9}$/.test(check.reference))) ||
        (type==='right_to_work'&&!check.gov_uk_checked_on) || (check.expires_at && check.expires_at < today) || (check.next_check_at && check.next_check_at < today)) {
      missing.push(label);
    }
  }
  if(providerResult.data?.services?.includes("handyman")){const insurance=checksResult.data?.find(x=>x.document_type==="public_liability_insurance");if(!insurance||insurance.status!=="verified"||!insurance.document_storage_path||!insurance.uploaded_at||!insurance.expires_at||insurance.expires_at<today)missing.push("current public liability insurance");}
  return missing;
}

export async function getProviderApprovalRequirements(id: string): Promise<string[]> {
  await requireAdmin();
  return approvalRequirements(id);
}

export async function approveProvider(id: string) {
  const s = await requireAdmin();
  const missing = await approvalRequirements(id);
  if (missing.length) {
    throw new Error(`Verify ${missing.join(", ")} before approving this professional.`);
  }
  const { data: p, error } = await s
    .from("providers")
    .update({ vetting_status: "approved" })
    .eq("id", id)
    .eq("vetting_status", "pending")
    .select("profile_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return;

  // Let them know only when a pending application was actually approved.
  if (p?.profile_id) {
    await s.from("notifications").insert({
      user_id: p.profile_id,
      title: "You're approved",
      body: "Your provider account has been approved. Jobs will start coming through.",
      href: "/worker",
    });
  }
  revalidatePath("/admin");
  revalidatePath("/admin/cleaners");
  revalidatePath(`/admin/cleaners/${id}`);
  revalidatePath("/worker");
}

export async function setProviderDbsStatus(
  id: string,
  status: "verified" | "failed",
  note?: string,
) {
  const s = await requireAdmin();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: check, error: checkError } = await admin
    .from("provider_dbs_checks")
    .select("certificate_storage_path, uploaded_at")
    .eq("provider_id", id)
    .maybeSingle();
  if (checkError) throw new Error(checkError.message);
  if (!check?.uploaded_at) {
    throw new Error("The DBS certificate has not been uploaded yet.");
  }

  if (status === "verified") {
    // The copy is deleted once verified, so it can only be verified again
    // from a fresh upload.
    if (!check.certificate_storage_path) {
      throw new Error("The certificate copy was deleted after an earlier review. Ask the professional to upload it again.");
    }
    const parts = check.certificate_storage_path.split("/");
    const fileName = parts.pop();
    const folder = parts.join("/");
    const { data: files, error: storageError } = await admin.storage
      .from("provider-dbs")
      .list(folder, { search: fileName, limit: 10 });
    if (storageError) throw new Error(storageError.message);
    if (!fileName || !files?.some((file) => file.name === fileName)) {
      throw new Error("The uploaded DBS certificate could not be found.");
    }
  }

  const reviewNote = String(note ?? "").trim().slice(0, 500) || null;
  if (status === "failed" && !reviewNote) {
    throw new Error("Record a reason when a DBS check fails.");
  }

  const { error } = await admin
    .from("provider_dbs_checks")
    .update({
      status,
      review_note: reviewNote,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("provider_id", id);
  if (error) throw new Error(error.message);

  // Keep only the outcome, number and issue date. Criminal record information
  // gets extra protection under UK GDPR, and the client agreed the uploaded copy
  // is deleted once verified. A failed deletion must not undo the verification,
  // so it is logged and the copy is left for a later retry.
  if (status === "verified" && check.certificate_storage_path) {
    const { error: removeError } = await admin.storage
      .from("provider-dbs")
      .remove([check.certificate_storage_path]);
    if (removeError) {
      console.error(`Could not delete the DBS certificate copy for ${id}:`, removeError);
    } else {
      const { error: clearError } = await admin
        .from("provider_dbs_checks")
        .update({ certificate_storage_path: null, certificate_deleted_at: new Date().toISOString() })
        .eq("provider_id", id);
      if (clearError) console.error(`Deleted the DBS copy for ${id} but could not record it:`, clearError);
    }
  }

  const { data: provider } = await admin
    .from("providers")
    .select("profile_id")
    .eq("id", id)
    .maybeSingle();
  if (provider?.profile_id) {
    await admin.from("notifications").insert({
      user_id: provider.profile_id,
      title: status === "verified" ? "DBS certificate verified" : "DBS certificate needs attention",
      body:
        status === "verified"
          ? "Your DBS certificate has been verified. Your application can now be approved."
          : `Your DBS certificate was not verified.${reviewNote ? ` ${reviewNote}` : ""}`,
      href: "/worker/profile",
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/cleaners");
  revalidatePath(`/admin/cleaners/${id}`);
  revalidatePath("/providers");
}

export async function rejectProvider(id: string) {
  const s = await requireAdmin();
  const { data, error } = await s
    .from("providers")
    .update({ vetting_status: "rejected" })
    .eq("id", id)
    .eq("vetting_status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  revalidatePath("/admin");
  revalidatePath("/admin/cleaners");
  revalidatePath(`/admin/cleaners/${id}`);
  revalidatePath("/worker");
}

export async function setProviderSuspension(
  id: string,
  suspended: boolean,
  formData: FormData,
) {
  const s = await requireAdmin();
  const reason = String(formData.get("reason") ?? "").trim();
  const { data, error } = await s.rpc("admin_set_provider_suspension", {
    p_provider_id: id,
    p_suspended: suspended,
    p_reason: reason || null,
  });
  if (error) throw new Error(error.message);

  const affected =
    (data as { affected_booking_ids?: string[] } | null)?.affected_booking_ids ?? [];
  if (suspended) {
    await Promise.allSettled(
      affected.map((bookingId) => rotateBookingOffer(admin, bookingId)),
    );
  }

  revalidatePath(`/admin/cleaners/${id}`);
  revalidatePath("/admin/cleaners");
  revalidatePath("/worker");
}

export async function setProviderDirectoryVisibility(
  id: string,
  visible: boolean,
) {
  const s = await requireAdmin();
  if (visible) {
    const { data: provider, error: providerError } = await s
      .from("providers")
      .select("dbs_verified")
      .eq("id", id)
      .maybeSingle();
    if (providerError) throw new Error(providerError.message);
    if (!provider?.dbs_verified) {
      throw new Error("Verify the DBS certificate before showing this professional publicly.");
    }
  }
  const { error } = await s.rpc("admin_set_provider_directory_visibility", {
    p_provider_id: id,
    p_visible: visible,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/providers");
  revalidatePath("/admin/cleaners");
  revalidatePath(`/admin/cleaners/${id}`);
}

export async function deleteReview(id: string) {
  const s = await requireAdmin();
  await s.from("reviews").delete().eq("id", id);
  revalidatePath("/admin");
}

export async function wipeReviews() {
  const s = await requireAdmin();
  assertTestMode("Clear all reviews");
  await s.from("reviews").delete().neq("id", ALL);
  revalidatePath("/admin");
}

export async function bringBookingToNow() {
  const s = await requireAdmin();
  assertTestMode("Move next booking to now");
  const { data: next } = await s
    .from("bookings")
    .select("id, status, scheduled_at")
    .in("status", ["offered", "declined", "scheduled"])
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1);
  const booking = next?.[0];
  if (!booking) {
    revalidatePath("/admin");
    return { moved: false, message: "No upcoming bookings to move." };
  }
  const when = new Date(Date.now() + 2 * 60 * 1000);
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await rescheduleBookingState(s, booking.id, when.toISOString(), {
    reason: "Admin test tool moved the next booking to now",
    meta: {
      source: "admin_test_tool",
      offer_expires_at: expires.toISOString(),
    },
  });
  revalidatePath("/admin");
  revalidatePath("/worker");
  revalidatePath("/account");
  return {
    moved: true,
    message: `Moved a booking to ${when.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })} today.`,
  };
}

export async function wipeAvailability() {
  const s = await requireAdmin();
  assertTestMode("Clear all availability");
  await s.from("provider_availability").delete().neq("id", ALL);
  revalidatePath("/admin");
}

export async function resetPrototypeData() {
  const s = await requireAdmin();
  assertTestMode("Reset all prototype activity");
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await admin.rpc("admin_reset_prototype_data", {
    p_actor_id: user.id,
    p_confirmation: "RESET PROTOTYPE DATA",
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/admin/review");
  revalidatePath("/account");
  revalidatePath("/worker");
  revalidatePath("/notifications");

  const removed = (data as { removed?: { bookings?: number } } | null)?.removed;
  return {
    message: `Prototype activity cleared${removed?.bookings !== undefined ? ` — ${removed.bookings} booking${removed.bookings === 1 ? "" : "s"} removed` : ""}.`,
  };
}
