import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import { loadAdminOverview } from "@/lib/adminOverview";
import { ADMIN_PREVIEW_LIMIT, professionalStatus } from "@/lib/adminDashboard";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { visibleProfessionalServices } from "@/lib/professionalServices";
import { developmentToolsEnabled } from "@/lib/developmentTools";
import AdminNav from "./AdminNav";
import AdminButtons from "./AdminButtons";
import styles from "./admin.module.css";
type Professional = {
  id: string;
  display_name: string | null;
  services: string[];
  vetting_status: string;
  is_suspended: boolean;
  profile: unknown;
};
function nameOf(person: Professional) {
  const profile = (
    Array.isArray(person.profile) ? person.profile[0] : person.profile
  ) as { email?: string } | null;
  return {
    name: person.display_name || profile?.email || "Unnamed professional",
    email: profile?.email,
  };
}
function SectionHeading({
  title,
  id,
  description,
  href,
  total,
}: {
  title: string;
  id: string;
  description: string;
  href: string;
  total?: number | null;
}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <h2 id={id}>
          {title}
          {total != null && (
            <span className={styles.count}>
              {total.toLocaleString("en-GB")}
            </span>
          )}
        </h2>
        <p>{description}</p>
      </div>
      <Link className={styles.textLink} href={href}>
        View all <span aria-hidden="true">→</span>
        <span className={styles.srOnly}> {title.toLowerCase()}</span>
      </Link>
    </div>
  );
}
function ProfessionalRow({
  person,
  approval,
  handyman,
}: {
  person: Professional;
  approval?: boolean;
  handyman: boolean;
}) {
  const { name, email } = nameOf(person);
  const status = professionalStatus(person.vetting_status, person.is_suspended);
  return (
    <li className={styles.personRow}>
      <span className={styles.avatar} aria-hidden="true">
        {name.charAt(0).toUpperCase()}
      </span>
      <div className={styles.rowContent}>
        <Link className={styles.rowTitle} href={`/admin/cleaners/${person.id}`}>
          {name}
        </Link>
        {email && name !== email && (
          <span className={styles.meta}>{email}</span>
        )}
        <span className={styles.meta}>
          {visibleProfessionalServices(person.services ?? [], handyman)
            .map((service) =>
              service === "handyman" ? "Property maintenance" : "Cleaning",
            )
            .join(" · ") || "Services not set"}
        </span>
      </div>
      {approval ? (
        <Link
          href={`/admin/cleaners/${person.id}`}
          className={styles.smallButton}
        >
          Review
          <span className={styles.srOnly}> {name}&apos;s application</span>
        </Link>
      ) : (
        <span className={`${styles.badge} ${styles[status.tone]}`}>
          {status.label}
        </span>
      )}
    </li>
  );
}
export default async function AdminPage() {
  const { supabase, user } = await requireAdminPage();
  const handyman = handymanEnabled();
  const { bookings, customers, professionals, approvals, reviews } =
    await loadAdminOverview(supabase, handyman);
  const stats = [
    {
      label: "Bookings",
      value: bookings.error ? null : bookings.count,
      href: "/admin/bookings",
      note: "Bookings & schedule",
    },
    {
      label: "Customers",
      value: customers.error ? null : customers.count,
      href: "/admin/customers",
      note: "Profiles & booking history",
    },
    {
      label: "Professionals",
      value: professionals.error ? null : professionals.count,
      href: "/admin/cleaners",
      note: "Your service professionals",
    },
    {
      label: "Awaiting approval",
      value: approvals.error ? null : approvals.count,
      href: "/admin/cleaners?status=pending",
      note: "Applications to review",
    },
  ];
  return (
    <main className={styles.page}>
      <AdminNav email={user.email ?? "Admin"} />
      <div className={styles.container}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Your workspace</p>
            <h1>Overview</h1>
            <p>A quick look at what needs your attention.</p>
          </div>
          <Link href="/admin/bookings" className={styles.button}>
            Manage bookings <span aria-hidden="true">→</span>
          </Link>
        </header>
        <div className={styles.stats}>
          {stats.map((stat) => (
            <Link href={stat.href} key={stat.label} className={styles.stat}>
              <span>{stat.label}</span>
              <strong>
                {stat.value == null ? "—" : stat.value.toLocaleString("en-GB")}
              </strong>
              <small>
                {stat.value == null ? "Could not load this total" : stat.note}
              </small>
            </Link>
          ))}
        </div>
        <div className={styles.columns}>
          <section className={styles.panel} aria-labelledby="awaiting-approval">
            <SectionHeading
              title="Awaiting approval"
              id="awaiting-approval"
              description="Oldest applications first. Open a record to check the details."
              href="/admin/cleaners?status=pending"
              total={approvals.error ? null : approvals.count}
            />
            {approvals.error ? (
              <p className={styles.error} role="alert">
                Applications could not be loaded. Please try again.
              </p>
            ) : !approvals.data?.length ? (
              <p className={styles.empty}>
                You&apos;re up to date. No applications are waiting.
              </p>
            ) : (
              <ul className={styles.list}>
                {approvals.data.slice(0, ADMIN_PREVIEW_LIMIT).map((person) => (
                  <ProfessionalRow
                    person={person}
                    key={person.id}
                    approval
                    handyman={handyman}
                  />
                ))}
              </ul>
            )}
          </section>
          <section
            className={styles.panel}
            aria-labelledby="recent-professionals"
          >
            <SectionHeading
              title="Professionals"
              id="recent-professionals"
              description="The five most recently joined professionals."
              href="/admin/cleaners"
              total={professionals.error ? null : professionals.count}
            />
            {professionals.error ? (
              <p className={styles.error} role="alert">
                Professionals could not be loaded. Please try again.
              </p>
            ) : !professionals.data?.length ? (
              <p className={styles.empty}>No professionals have joined yet.</p>
            ) : (
              <ul className={styles.list}>
                {professionals.data
                  .slice(0, ADMIN_PREVIEW_LIMIT)
                  .map((person) => (
                    <ProfessionalRow
                      person={person}
                      key={person.id}
                      handyman={handyman}
                    />
                  ))}
              </ul>
            )}
          </section>
        </div>
        <section className={styles.panel} aria-labelledby="recent-reviews">
          <SectionHeading
            title="Recent reviews"
            id="recent-reviews"
            description="Latest booking feedback from customers and professionals."
            href="/admin/reviews/activity"
            total={reviews.count}
          />
          {reviews.error ? (
            <p role="alert" className={styles.error}>
              Reviews could not be loaded. Please try again.
            </p>
          ) : !reviews.reviews.length ? (
            <p className={styles.empty}>
              Booking reviews will appear here after completed visits.
            </p>
          ) : (
            <ul className={styles.list}>
              {reviews.reviews.slice(0, ADMIN_PREVIEW_LIMIT).map((review) => (
                <li className={styles.reviewRow} key={review.id}>
                  <div className={styles.reviewHeading}>
                    <span className={styles.rowTitle}>
                      {review.reviewerName}
                    </span>
                    <span
                      className={styles.rating}
                      aria-label={`${review.rating} out of 5 stars`}
                    >
                      {"★".repeat(review.rating)}
                      <span className={styles.mutedStars}>
                        {"★".repeat(5 - review.rating)}
                      </span>
                    </span>
                    <span className={styles.meta}>
                      {new Date(review.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <p className={styles.reviewComment}>
                    {review.comment?.trim() ||
                      "Rating shared without a written comment."}
                  </p>
                  <div className={styles.reviewFooter}>
                    <span className={styles.meta}>
                      {review.category} · About {review.recipientName} ·{" "}
                      {review.visibility === "private" ? "Private" : "Public"}
                    </span>
                    <Link
                      className={styles.textLink}
                      href={`/admin/reviews/activity#review-${review.id}`}
                    >
                      View details
                      <span className={styles.srOnly}>
                        {" "}
                        for review by {review.reviewerName}
                      </span>{" "}
                      <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={styles.tools} aria-labelledby="more-tools">
          <div>
            <h2 id="more-tools">Other tools</h2>
            <p>Keep detailed work in its own place.</p>
          </div>
          <div className={styles.toolLinks}>
            {[
              ["/admin/review", "Resolution desk"],
              ["/admin/quotes", "Property maintenance quotes"],
              ["/admin/reviews", "Website reviews"],
              ["/admin/legal", "Legal content"],
              ["/admin/deletion-requests", "Account requests"],
              ["/admin/settings", "Settings"],
            ].map(([href, label]) => (
              <Link href={href} key={href}>
                {label} <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
        </section>
        {developmentToolsEnabled(process.env) && (
          <details className={styles.development}>
            <summary>
              Development tools <span>Test activity only</span>
            </summary>
            <AdminButtons />
          </details>
        )}
        <Link href="/" className={styles.backLink}>
          ← Back to website
        </Link>
      </div>
    </main>
  );
}
