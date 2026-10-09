import Link from "next/link";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import AdminNav from "../../AdminNav";
import DbsReviewButtons from "../../DbsReviewButtons";
import VerificationReview, {
  type VerificationRecord,
} from "../../VerificationReview";
import ServiceReview from "../../ServiceReview";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { requireAdminPage } from "@/lib/adminSession";
import {
  PROVIDER_DOCUMENT_LABELS,
  PROVIDER_DOCUMENT_TYPES,
} from "@/lib/providerVerification";
import {
  setProviderDirectoryVisibility,
  setProviderSuspension,
} from "../../actions";

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function money(value: number | null | undefined) {
  return `£${Number(value ?? 0).toFixed(2)}`;
}

function when(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatApplicationAvailability(
  value: Record<string, string> | null | undefined,
) {
  if (!value) return "Not supplied";
  const periodLabels: Record<string, string> = {
    unavailable: "Off",
    all_day: "Day",
    morning: "Morning",
    afternoon: "Afternoon",
    evening: "Evening",
  };
  return [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]
    .map(
      (day) =>
        `${day.slice(0, 3)} ${periodLabels[value[day]] ?? value[day] ?? "Not supplied"}`,
    )
    .join(" · ");
}

export default async function ProfessionalRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await requireAdminPage();
  const serviceAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const [
    providerResult,
    bookingsResult,
    hoursResult,
    suspensionResult,
    dbsResult,
  ] = await Promise.all([
    supabase
      .from("providers")
      .select(
        "id, profile_id, display_name, services, service_approvals, vetting_status, dbs_verified, rating_avg, rating_count, years_experience, created_at, is_suspended, suspended_at, suspension_reason, payout_schedule, show_on_our_pros, profile:profiles!providers_profile_id_fkey(email, full_name, phone, address, postcode), application:provider_onboarding_details(preferred_weekly_hours, resident_status, utr_number, self_employed_confirmed, salutation, date_of_birth, right_to_work, current_self_employment_status, current_self_employment_detail, business_name, cleaning_experience_years, cleaning_experience_types, other_cleaning_experience, max_travel_distance, weekly_availability, created_at)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select(
        "id, status, scheduled_at, created_at, customer_email, address, provider_payout, duration_minutes, packages(name, duration_minutes)",
      )
      .eq("provider_id", id)
      .order("scheduled_at", { ascending: false }),
    supabase
      .from("provider_availability")
      .select("weekday, start_time, end_time")
      .eq("provider_id", id)
      .order("weekday"),
    supabase
      .from("provider_suspension_events")
      .select("id, suspended, reason, created_at")
      .eq("provider_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("provider_dbs_checks")
      .select(
        "provider_id, certificate_number, issue_date, certificate_storage_path, certificate_original_name, certificate_mime_type, status, review_note, submitted_at, uploaded_at, reviewed_at, certificate_deleted_at",
      )
      .eq("provider_id", id)
      .maybeSingle(),
  ]);

  const provider = providerResult.data;
  if (!provider) {
    return (
      <main style={page}>
        <AdminNav email={user.email ?? "Admin"} />
        <div style={inner}>
          <Link href="/admin/cleaners" style={back}>
            ← Professionals
          </Link>
          <div style={empty}>
            {providerResult.error?.message ?? "Professional record not found."}
          </div>
        </div>
      </main>
    );
  }

  const profile = one(provider.profile as never) as {
    email: string | null;
    full_name: string | null;
    phone: string | null;
    address: string | null;
    postcode: string | null;
  } | null;
  const application = one(provider.application as never) as {
    preferred_weekly_hours: number;
    resident_status: string;
    utr_number: string | null;
    self_employed_confirmed: boolean;
    salutation: string | null;
    date_of_birth: string | null;
    right_to_work: boolean | null;
    current_self_employment_status: string | null;
    current_self_employment_detail: string | null;
    business_name: string | null;
    cleaning_experience_years: number | null;
    cleaning_experience_types: string[] | null;
    other_cleaning_experience: string | null;
    max_travel_distance: string | null;
    weekly_availability: Record<string, string> | null;
    created_at: string;
  } | null;
  const { data: duplicates, error: duplicateError } = await supabase.rpc(
    "professional_duplicate_warnings",
    { p_provider: id },
  );
  const dbs = dbsResult.data;
  const { data: verificationItems, error: verificationError } =
    await serviceAdmin
      .from("provider_verification_items")
      .select(
        "document_type,status,document_storage_path,document_original_name,uploaded_at,issued_at,expires_at,next_check_at,reference,review_note,gov_uk_checked_on",
      )
      .eq("provider_id", id);
  const today = new Date().toISOString().slice(0, 10);
  const verificationTypes = PROVIDER_DOCUMENT_TYPES.filter(
    (type) =>
      !["trade_certificate", "public_liability_insurance"].includes(type) ||
      (handymanEnabled() && provider.services?.includes("handyman")),
  );
  const verificationRecords: VerificationRecord[] = await Promise.all(
    verificationTypes.map(async (type) => {
      const item = verificationItems?.find((row) => row.document_type === type);
      const { data: signed } = item?.document_storage_path
        ? await serviceAdmin.storage
            .from("provider-verification")
            .createSignedUrl(item.document_storage_path, 5 * 60)
        : { data: null };
      return {
        type,
        label: PROVIDER_DOCUMENT_LABELS[type],
        status:
          item?.status === "verified" &&
          ((item.expires_at && item.expires_at < today) ||
            (item.next_check_at && item.next_check_at < today))
            ? "expired"
            : (item?.status ?? "not submitted"),
        uploadedAt: item?.uploaded_at ?? null,
        originalName: item?.document_original_name ?? null,
        signedUrl: signed?.signedUrl ?? null,
        issuedAt: item?.issued_at ?? null,
        expiresAt: item?.expires_at ?? null,
        nextCheckAt: item?.next_check_at ?? null,
        reference: item?.reference ?? null,
        reviewNote: item?.review_note ?? null,
        govCheckedOn: item?.gov_uk_checked_on ?? null,
      };
    }),
  );
  let dbsCertificateUrl: string | null = null;
  if (dbs?.uploaded_at && dbs.certificate_storage_path) {
    const { data: signedCertificate } = await supabase.storage
      .from("provider-dbs")
      .createSignedUrl(dbs.certificate_storage_path, 10 * 60);
    dbsCertificateUrl = signedCertificate?.signedUrl ?? null;
  }
  const bookings = bookingsResult.data ?? [];
  const bookingIds = bookings.map((booking) => booking.id);
  const [paymentsResult, payoutsResult, eventsResult] = await Promise.all([
    bookingIds.length
      ? supabase
          .from("payments")
          .select("booking_id, split_breakdown, status, kind, created_at")
          .in("booking_id", bookingIds)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    bookingIds.length
      ? supabase
          .from("payouts")
          .select("booking_id, amount, status, note, created_at")
          .in("booking_id", bookingIds)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    bookingIds.length
      ? supabase
          .from("booking_events")
          .select("booking_id, to_status, created_at")
          .in("booking_id", bookingIds)
          .order("created_at")
      : Promise.resolve({ data: [] }),
  ]);
  const payments = paymentsResult.data ?? [];
  const payouts = payoutsResult.data ?? [];
  const events = eventsResult.data ?? [];
  const completed = bookings.filter(
    (booking) => booking.status === "completed",
  ).length;
  const released = payouts
    .filter((payout) => payout.status === "paid")
    .reduce((sum, payout) => sum + Number(payout.amount ?? 0), 0);

  return (
    <main style={page}>
      <AdminNav email={user.email ?? "Admin"} />
      <div style={inner}>
        <Link href="/admin/cleaners" style={back}>
          ← Professionals
        </Link>
        <section style={hero}>
          <div style={avatar}>
            {(provider.display_name ?? profile?.email ?? "P")
              .charAt(0)
              .toUpperCase()}
          </div>
          <div>
            <p style={eyebrow}>Professional record</p>
            <h1 style={title}>
              {provider.display_name ??
                profile?.full_name ??
                "Unnamed professional"}
            </h1>
            <p style={muted}>
              {profile?.email ?? "No email"} · {profile?.phone ?? "No phone"}
            </p>
            <p style={muted}>
              {(provider.services ?? []).join(", ") || "No services"} ·{" "}
              {provider.years_experience ?? 0}+ years ·{" "}
              {provider.vetting_status}
            </p>
          </div>
        </section>

        <section
          style={applicationCard}
          aria-label="Duplicate account warnings"
        >
          <strong>Possible duplicate accounts</strong>
          {duplicateError ? (
            <p>Duplicate checks could not be loaded.</p>
          ) : duplicates?.length ? (
            <ul>
              {duplicates.map(
                (match: {
                  provider_id: string;
                  display_name: string;
                  matched_fields: string[];
                }) => (
                  <li key={match.provider_id}>
                    <Link href={`/admin/cleaners/${match.provider_id}`}>
                      {match.display_name}
                    </Link>{" "}
                    — matching {match.matched_fields.join(", ")}. Check this
                    before approving.
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p>No matching name, date of birth or phone found.</p>
          )}
        </section>
        <div style={stats}>
          <Stat label="Jobs" value={String(bookings.length)} />
          <Stat label="Completed" value={String(completed)} />
          <Stat label="Released payouts" value={money(released)} />
          <Stat
            label="Professional rating"
            value={
              provider.rating_avg
                ? `${Number(provider.rating_avg).toFixed(1)} ★ (${provider.rating_count ?? 0})`
                : "Not rated"
            }
          />
        </div>

        <section style={applicationCard}>
          <div>
            <p style={eyebrow}>Application review</p>
            <h2 style={{ ...sectionTitle, marginBottom: 5 }}>
              Professional onboarding details
            </h2>
            <p style={muted}>
              {application
                ? `Submitted ${when(application.created_at)}`
                : "This account predates the current onboarding form."}
            </p>
          </div>
          <div style={applicationGrid}>
            <ApplicationField
              label="Title"
              value={
                application?.salutation
                  ? application.salutation.toUpperCase()
                  : "Not supplied"
              }
            />
            <ApplicationField
              label="Date of birth"
              value={
                application?.date_of_birth
                  ? new Date(
                      `${application.date_of_birth}T00:00:00`,
                    ).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : "Not supplied"
              }
            />
            <ApplicationField
              label="Phone"
              value={profile?.phone ?? "Not supplied"}
            />
            <ApplicationField
              label="Home address"
              value={
                [profile?.address, profile?.postcode]
                  .filter(Boolean)
                  .join(", ") || "Not supplied"
              }
            />
            <ApplicationField
              label="Right to work in the UK"
              value={
                application?.right_to_work == null
                  ? "Not supplied"
                  : application.right_to_work
                    ? "Yes"
                    : "No"
              }
            />
            <ApplicationField
              label="UK resident status"
              value={application?.resident_status ?? "Not supplied"}
            />
            <ApplicationField
              label="Preferred availability"
              value={
                application
                  ? `${application.preferred_weekly_hours} hours per week`
                  : "Not supplied"
              }
            />
            <ApplicationField
              label="Self-employed partnership"
              value={
                application?.self_employed_confirmed ? "Agreed" : "Not recorded"
              }
            />
            <ApplicationField
              label="Currently self-employed"
              value={
                application?.current_self_employment_status
                  ? `${application.current_self_employment_status}${application.current_self_employment_detail ? ` — ${application.current_self_employment_detail}` : ""}`
                  : "Not supplied"
              }
            />
            <ApplicationField
              label="Trading / business name"
              value={application?.business_name ?? "Not supplied"}
            />
            <ApplicationField
              label="UTR number"
              value={application?.utr_number ?? "Not supplied (optional)"}
            />
            <ApplicationField
              label="Cleaning experience"
              value={
                application?.cleaning_experience_years == null
                  ? "Not supplied"
                  : `${application.cleaning_experience_years} year${application.cleaning_experience_years === 1 ? "" : "s"}`
              }
            />
            <ApplicationField
              label="Experience types"
              value={
                application?.cleaning_experience_types?.length
                  ? `${application.cleaning_experience_types.join(", ")}${application.other_cleaning_experience ? ` — ${application.other_cleaning_experience}` : ""}`
                  : "Not supplied"
              }
            />
            <ApplicationField
              label="Maximum travel distance"
              value={application?.max_travel_distance ?? "Not supplied"}
            />
            <ApplicationField
              label="Application availability"
              value={formatApplicationAvailability(
                application?.weekly_availability,
              )}
            />
          </div>
        </section>

        <section style={dbsCard}>
          <p style={eyebrow}>Private document review</p>
          <h2 style={{ ...sectionTitle, marginBottom: 5 }}>
            Right to work, identity and cover
          </h2>
          <p style={muted}>
            Only the professional and review team can open these files. Verify
            each item only after checking its contents and dates.
          </p>
          {verificationError ? (
            <p style={uploadMissing}>
              Verification records could not be loaded. Apply the private
              document migration and refresh.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
              {verificationRecords.map((record) => (
                <VerificationReview
                  key={`${record.type}:${record.uploadedAt ?? ""}`}
                  providerId={id}
                  record={record}
                />
              ))}
            </div>
          )}
        </section>

        <section style={dbsCard}>
          <div style={recordTop}>
            <div>
              <p style={eyebrow}>Identity and safety review</p>
              <h2 style={{ ...sectionTitle, marginBottom: 5 }}>
                DBS certificate
              </h2>
              <p style={muted}>
                This evidence is private and must be reviewed before the
                professional can be approved.
              </p>
            </div>
            <span
              style={{
                ...status,
                background:
                  dbs?.status === "verified"
                    ? "#dff5e8"
                    : dbs?.status === "failed"
                      ? "#ffe6ea"
                      : "#fff3d6",
                color:
                  dbs?.status === "verified"
                    ? "#137b4e"
                    : dbs?.status === "failed"
                      ? "#b0384f"
                      : "#8a5a00",
              }}
            >
              {dbs?.status ?? "not submitted"}
            </span>
          </div>

          {dbs ? (
            <>
              <div style={applicationGrid}>
                <ApplicationField
                  label="Certificate number"
                  value={dbs.certificate_number}
                />
                <ApplicationField
                  label="Issue date"
                  value={new Date(
                    `${dbs.issue_date}T00:00:00`,
                  ).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                />
                <ApplicationField
                  label="File"
                  value={
                    dbs.certificate_deleted_at
                      ? "Deleted after verification"
                      : dbs.certificate_original_name
                  }
                />
                <ApplicationField
                  label="Uploaded"
                  value={
                    dbs.uploaded_at
                      ? when(dbs.uploaded_at)
                      : "Upload incomplete"
                  }
                />
              </div>

              {dbs.review_note ? (
                <p style={reviewNote}>
                  <strong>Review note:</strong> {dbs.review_note}
                </p>
              ) : null}

              <div style={dbsActions}>
                {dbsCertificateUrl ? (
                  <a
                    href={dbsCertificateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={certificateLink}
                  >
                    Open DBS certificate ↗
                  </a>
                ) : dbs.certificate_deleted_at ? (
                  <span style={uploadMissing}>
                    Certificate copy deleted after verification on{" "}
                    {when(dbs.certificate_deleted_at)}. The number, issue date
                    and outcome are kept.
                  </span>
                ) : (
                  <span style={uploadMissing}>
                    Certificate upload has not been completed.
                  </span>
                )}
                {dbs.uploaded_at ? (
                  <DbsReviewButtons
                    id={id}
                    status={dbs.status as "pending" | "verified" | "failed"}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <p style={uploadMissing}>
              No DBS details exist for this professional. Approval remains
              unavailable.
            </p>
          )}

          {!provider.is_suspended ? (
            <div style={approvalGate}>
              <strong>Application decision</strong>
              <ServiceReview
                id={provider.id}
                approvals={provider.service_approvals}
                handymanEnabled={handymanEnabled()}
              />
            </div>
          ) : null}
        </section>

        <section
          style={{
            ...availability,
            borderColor: provider.show_on_our_pros ? "#b9dfc7" : "#ddd4ea",
            background: provider.show_on_our_pros ? "#f1fbf4" : "#faf7ff",
          }}
        >
          <strong>Our Pros directory</strong>
          <span>
            {provider.vetting_status !== "approved"
              ? "This professional cannot appear publicly until their application is approved."
              : !provider.dbs_verified
                ? "This professional is hidden from the public directory until their DBS is verified."
                : provider.is_suspended
                  ? "This professional is hidden while their account is suspended. Their saved directory setting is kept."
                  : provider.show_on_our_pros
                    ? "This professional is currently visible on the public Our Pros page."
                    : "This professional is hidden from the public Our Pros page."}
          </span>
          {provider.vetting_status === "approved" && provider.dbs_verified ? (
            <form
              action={setProviderDirectoryVisibility.bind(
                null,
                id,
                !provider.show_on_our_pros,
              )}
            >
              <button
                type="submit"
                style={
                  provider.show_on_our_pros
                    ? hideDirectoryButton
                    : showDirectoryButton
                }
              >
                {provider.show_on_our_pros
                  ? "Hide from Our Pros"
                  : "Show on Our Pros"}
              </button>
            </form>
          ) : null}
        </section>

        <section
          style={{
            ...availability,
            borderColor: provider.is_suspended ? "#efb5c1" : "#d8e8dd",
            background: provider.is_suspended ? "#fff1f3" : "#f1fbf4",
          }}
        >
          <strong>
            {provider.is_suspended ? "Account suspended" : "Account active"}
          </strong>
          {provider.is_suspended && (
            <span>
              {provider.suspension_reason || "No reason recorded"}
              {provider.suspended_at
                ? ` · since ${when(provider.suspended_at)}`
                : ""}
            </span>
          )}
          <span>
            Payment schedule:{" "}
            {String(provider.payout_schedule ?? "weekly").replace(
              "fortnightly",
              "every 2 weeks",
            )}
          </span>
          {provider.is_suspended ? (
            <form action={setProviderSuspension.bind(null, id, false)}>
              <button type="submit" style={restoreButton}>
                Restore account
              </button>
            </form>
          ) : (
            <form
              action={setProviderSuspension.bind(null, id, true)}
              style={{ display: "grid", gap: 9, maxWidth: 620 }}
            >
              <label
                htmlFor="suspension-reason"
                style={{ fontWeight: 900, color: "#8f2d43" }}
              >
                Suspension reason
              </label>
              <textarea
                id="suspension-reason"
                name="reason"
                required
                rows={3}
                placeholder="Record the issue that requires this suspension"
                style={reasonInput}
              />
              <button type="submit" style={suspendButton}>
                Suspend account
              </button>
            </form>
          )}
        </section>

        {(suspensionResult.data ?? []).length > 0 && (
          <section style={{ ...availability, background: "#fff" }}>
            <strong>Suspension history</strong>
            {(suspensionResult.data ?? []).map((event) => (
              <span key={event.id}>
                {event.suspended ? "Suspended" : "Restored"} ·{" "}
                {when(event.created_at)}
                {event.reason ? ` · ${event.reason}` : ""}
              </span>
            ))}
          </section>
        )}

        <section style={availability}>
          <strong>Availability</strong>
          <span>
            {hoursResult.data?.length
              ? hoursResult.data
                  .map(
                    (row) =>
                      `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][row.weekday] ?? row.weekday} ${String(row.start_time).slice(0, 5)}–${String(row.end_time).slice(0, 5)}`,
                  )
                  .join(" · ")
              : "No working hours saved"}
          </span>
        </section>

        <h2 style={sectionTitle}>Work, booking and payout history</h2>
        {bookings.length === 0 ? (
          <div style={empty}>No jobs for this professional.</div>
        ) : (
          <div style={list}>
            {bookings.map((booking) => {
              const pkg = one(booking.packages as never) as {
                name: string;
                duration_minutes: number | null;
              } | null;
              const bookingPayments = payments.filter(
                (payment) => payment.booking_id === booking.id,
              );
              const bookingPayouts = payouts.filter(
                (payout) => payout.booking_id === booking.id,
              );
              const flow = events.filter(
                (event) => event.booking_id === booking.id,
              );
              const providerShare = bookingPayments.reduce(
                (sum, payment) =>
                  sum +
                  Number(
                    (payment.split_breakdown as { provider?: number } | null)
                      ?.provider ?? 0,
                  ),
                0,
              );
              return (
                <article key={booking.id} style={recordCard}>
                  <div style={recordTop}>
                    <div>
                      <strong>
                        {pkg?.name ?? "Service"}
                        {(booking.duration_minutes ?? pkg?.duration_minutes)
                          ? ` · ${booking.duration_minutes ?? pkg?.duration_minutes} min`
                          : ""}
                      </strong>
                      <p style={muted}>
                        {when(booking.scheduled_at)} ·{" "}
                        {booking.customer_email ?? "Unknown customer"}
                      </p>
                      <p style={muted}>{booking.address ?? "No address"}</p>
                    </div>
                    <span style={status}>
                      {booking.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div style={flowRow}>
                    <b>Work flow</b>
                    <span>
                      {flow.length
                        ? flow
                            .map((event) =>
                              event.to_status.replaceAll("_", " "),
                            )
                            .join(" → ")
                        : booking.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div style={flowRow}>
                    <b>Payment</b>
                    <span>
                      {bookingPayments.length
                        ? bookingPayments
                            .map(
                              (payment) =>
                                `${payment.kind ?? "visit"}: ${payment.status}`,
                            )
                            .join(" | ") +
                          ` · provider share ${money(providerShare)}`
                        : "No visit payment record"}
                    </span>
                  </div>
                  <div style={flowRow}>
                    <b>Payout</b>
                    <span>
                      {bookingPayouts.length
                        ? bookingPayouts
                            .map(
                              (payout) =>
                                `${payout.status} · ${money(payout.amount)}`,
                            )
                            .join(" | ")
                        : booking.provider_payout
                          ? `Expected ${money(booking.provider_payout)}`
                          : "No payout record"}
                    </span>
                  </div>
                  <small style={reference}>
                    Booking #{booking.id.slice(0, 8).toUpperCase()} · created{" "}
                    {when(booking.created_at)}
                  </small>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={stat}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function ApplicationField({ label, value }: { label: string; value: string }) {
  return (
    <div style={applicationField}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const page: React.CSSProperties = {
  minHeight: "100vh",
  paddingBottom: 80,
  background: "#f7f8fa",
  color: "#16202a",
  fontFamily: "'Nunito', system-ui, sans-serif",
};
const inner: React.CSSProperties = {
  maxWidth: 1050,
  margin: "0 auto",
  padding: "0 20px",
};
const back: React.CSSProperties = {
  display: "inline-block",
  marginBottom: 15,
  color: "#6d28d9",
  fontSize: 13,
  fontWeight: 900,
  textDecoration: "none",
};
const hero: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: 22,
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  background: "#fff",
};
const avatar: React.CSSProperties = {
  flex: "0 0 auto",
  display: "grid",
  placeItems: "center",
  width: 62,
  height: 62,
  borderRadius: "50%",
  background: "#f4ecfe",
  color: "#6d28d9",
  fontSize: 22,
  fontWeight: 900,
};
const eyebrow: React.CSSProperties = {
  margin: "0 0 3px",
  color: "#6d28d9",
  fontSize: 10.5,
  fontWeight: 900,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};
const title: React.CSSProperties = {
  margin: "0 0 4px",
  fontSize: 28,
  fontWeight: 900,
};
const muted: React.CSSProperties = {
  margin: "3px 0",
  color: "#68717d",
  fontSize: 12.5,
  overflowWrap: "anywhere",
};
const stats: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))",
  gap: 10,
  margin: "18px 0",
};
const stat: React.CSSProperties = {
  display: "grid",
  gap: 3,
  padding: "15px 17px",
  border: "1px solid #e5e7eb",
  borderRadius: 13,
  background: "#fff",
};
const availability: React.CSSProperties = {
  display: "grid",
  gap: 5,
  marginBottom: 28,
  padding: "15px 17px",
  border: "1px solid #e4d8f7",
  borderRadius: 13,
  background: "#faf7ff",
  color: "#5f6874",
  fontSize: 12.5,
};
const applicationCard: React.CSSProperties = {
  display: "grid",
  gap: 18,
  marginBottom: 18,
  padding: 20,
  border: "1px solid #dfd1f8",
  borderRadius: 16,
  background: "linear-gradient(145deg, #fffaf0, #f7f1ff)",
};
const applicationGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 10,
};
const applicationField: React.CSSProperties = {
  display: "grid",
  gap: 4,
  padding: "12px 13px",
  border: "1px solid #e6ddf5",
  borderRadius: 11,
  background: "rgba(255,255,255,0.82)",
  color: "#68717d",
  fontSize: 11.5,
  overflowWrap: "anywhere",
};
const dbsCard: React.CSSProperties = {
  display: "grid",
  gap: 17,
  marginBottom: 18,
  padding: 20,
  border: "1px solid #ead7a1",
  borderRadius: 16,
  background: "linear-gradient(145deg, #fffdf7, #fff8e8)",
};
const dbsActions: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};
const certificateLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 40,
  padding: "8px 15px",
  border: "1.5px solid #6d28d9",
  borderRadius: 999,
  color: "#6d28d9",
  background: "#fff",
  fontSize: 12.5,
  fontWeight: 900,
  textDecoration: "none",
};
const uploadMissing: React.CSSProperties = {
  margin: 0,
  color: "#8a5a00",
  fontSize: 12.5,
  fontWeight: 800,
};
const reviewNote: React.CSSProperties = {
  margin: 0,
  padding: "11px 13px",
  borderRadius: 11,
  background: "rgba(255,255,255,0.75)",
  color: "#5f6874",
  fontSize: 12.5,
};
const approvalGate: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  paddingTop: 15,
  borderTop: "1px solid #eadfbd",
};
const sectionTitle: React.CSSProperties = {
  margin: "0 0 13px",
  fontSize: 20,
  fontWeight: 900,
};
const list: React.CSSProperties = { display: "grid", gap: 11 };
const recordCard: React.CSSProperties = {
  padding: "17px 18px",
  border: "1px solid #e5e7eb",
  borderRadius: 15,
  background: "#fff",
};
const recordTop: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  flexWrap: "wrap",
};
const status: React.CSSProperties = {
  height: "fit-content",
  borderRadius: 999,
  padding: "5px 10px",
  background: "#f4ecfe",
  color: "#6d28d9",
  fontSize: 10.5,
  fontWeight: 900,
  textTransform: "capitalize",
};
const flowRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "95px minmax(0,1fr)",
  gap: 9,
  marginTop: 11,
  paddingTop: 10,
  borderTop: "1px solid #eef0f2",
  color: "#5f6874",
  fontSize: 12,
  overflowWrap: "anywhere",
};
const reference: React.CSSProperties = {
  display: "block",
  marginTop: 10,
  color: "#9aa1aa",
  fontSize: 10.5,
};
const empty: React.CSSProperties = {
  padding: 28,
  border: "1px dashed #d8dde3",
  borderRadius: 15,
  background: "#fff",
  color: "#7a828c",
  textAlign: "center",
};
const reasonInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  resize: "vertical",
  border: "1px solid #efb5c1",
  borderRadius: 10,
  background: "#fff",
  color: "#16202a",
  padding: "10px 12px",
  font: "inherit",
};
const suspendButton: React.CSSProperties = {
  width: "fit-content",
  border: 0,
  borderRadius: 999,
  background: "#b0384f",
  color: "#fff",
  padding: "10px 17px",
  fontWeight: 900,
  cursor: "pointer",
};
const restoreButton: React.CSSProperties = {
  width: "fit-content",
  border: 0,
  borderRadius: 999,
  background: "#17653a",
  color: "#fff",
  padding: "10px 17px",
  fontWeight: 900,
  cursor: "pointer",
};
const directoryButton: React.CSSProperties = {
  width: "fit-content",
  borderRadius: 999,
  background: "#fff",
  padding: "10px 17px",
  fontFamily: "inherit",
  fontWeight: 900,
  cursor: "pointer",
};
const hideDirectoryButton: React.CSSProperties = {
  ...directoryButton,
  border: "1.5px solid #efb5c1",
  color: "#a52e47",
};
const showDirectoryButton: React.CSSProperties = {
  ...directoryButton,
  border: "1.5px solid #b9dfc7",
  color: "#137b4e",
};
