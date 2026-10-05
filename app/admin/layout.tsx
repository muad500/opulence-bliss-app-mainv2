import PortalLiveSync from "@/components/PortalLiveSync";
import { requireAdminPage } from "@/lib/adminSession";

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireAdminPage();

  return (
    <>
      <PortalLiveSync userId={user.id} />
      {children}
    </>
  );
}
