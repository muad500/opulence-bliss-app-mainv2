import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/adminSession";
import { loadAdminReviews } from "@/lib/adminReviews";
import {
  ADMIN_PAGE_SIZE,
  adminPageNumber,
  adminListHref,
} from "@/lib/adminDashboard";
import ReviewList from "../../ReviewList";
import Pagination from "../../Pagination";
import styles from "../../admin.module.css";
export default async function ReviewActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const { supabase, user } = await requireAdminPage();
  const params = await searchParams,
    page = adminPageNumber(params.page);
  const reviewer =
    params.type === "client" || params.type === "provider"
      ? params.type
      : undefined;
  const { reviews, error, count } = await loadAdminReviews(
    supabase,
    ADMIN_PAGE_SIZE,
    { offset: (page - 1) * ADMIN_PAGE_SIZE, reviewer },
  );
  const lastPage = Math.max(1, Math.ceil((count ?? 0) / ADMIN_PAGE_SIZE));
  if (!error && count !== null && page > lastPage)
    redirect(
      adminListHref("/admin/reviews/activity", lastPage, { type: reviewer }),
    );
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/admin" className={styles.backLink}>
          ← Back to overview
        </Link>
        <header className={styles.pageHeader}>
          <div>
            <h1>Reviews</h1>
            <p>Full reviews from completed bookings, newest first.</p>
          </div>
          <Link className={styles.button} href="/admin/reviews">
            Manage website reviews →
          </Link>
        </header>
        <nav className={styles.filters} aria-label="Review type">
          {[
            [undefined, "All reviews"],
            ["client", "About professionals"],
            ["provider", "About customers"],
          ].map(([type, label]) => (
            <Link
              key={label}
              className={styles.filter}
              aria-current={reviewer === type ? "page" : undefined}
              href={adminListHref("/admin/reviews/activity", 1, { type })}
            >
              {label}
            </Link>
          ))}
        </nav>
        <section className={styles.panel} aria-label="Booking reviews">
          {error ? (
            <p role="alert" className={styles.error}>
              Reviews could not be loaded. Please try again.
            </p>
          ) : (
            <div className={styles.reviewDetails}>
              <ReviewList reviews={reviews} />
            </div>
          )}
        </section>
        {!error && (
          <Pagination
            path="/admin/reviews/activity"
            page={page}
            total={count}
            filters={{ type: reviewer }}
          />
        )}
      </div>
    </main>
  );
}
