import Link from "next/link";
import { ADMIN_PAGE_SIZE, adminListHref } from "@/lib/adminDashboard";
import styles from "./admin.module.css";
export default function Pagination({
  path,
  page,
  total,
  filters = {},
}: {
  path: string;
  page: number;
  total: number | null;
  filters?: Record<string, string | undefined>;
}) {
  if (total === null) return null;
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  return (
    <nav className={styles.pagination} aria-label="Results pages">
      <span>
        {total === 0
          ? "No results"
          : `${((page - 1) * ADMIN_PAGE_SIZE + 1).toLocaleString("en-GB")} to ${Math.min(page * ADMIN_PAGE_SIZE, total).toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}`}
      </span>
      <div>
        {page > 1 && (
          <Link href={adminListHref(path, page - 1, filters)}>← Previous</Link>
        )}
        <span>
          Page {page} of {pages}
        </span>
        {page < pages && (
          <Link href={adminListHref(path, page + 1, filters)}>Next →</Link>
        )}
      </div>
    </nav>
  );
}
