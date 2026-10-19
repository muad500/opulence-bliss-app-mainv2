import { requireAdminPage } from "@/lib/adminSession";
import HandymanQuoteAdmin from "@/components/admin/HandymanQuoteAdmin";
import Link from "next/link";
import styles from "../marketplace.module.css";
export default async function HandymanResolutionDesk() {
  await requireAdminPage();
  return (
    <main className={styles.page}>
      <Link href="/admin/review">← Resolution desk</Link>
      <HandymanQuoteAdmin />
    </main>
  );
}
