import PortalLiveSync from "@/components/PortalLiveSync";
import { requireAdminPage } from "@/lib/adminSession";
import AdminNav from "./AdminNav";
import styles from "./AdminNav.module.css";

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireAdminPage();

  return (
    <div className={styles.shell}>
      <PortalLiveSync userId={user.id} />
      <AdminNav email={user.email ?? ""} />
      {children}
    </div>
  );
}
