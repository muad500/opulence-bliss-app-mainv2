import { requireAdminPage } from "@/lib/adminSession";
import DocumentChangeForm from "./DocumentChangeForm";
export default async function DocumentChangesPage() {
  const { supabase } = await requireAdminPage();
  const [plans, recipients] = await Promise.all([
    supabase
      .from("document_change_plans")
      .select(
        "id,document_slug,version,title,summary,effective_at,announced_at",
      )
      .order("announced_at", { ascending: false })
      .limit(100),
    supabase.rpc("document_change_delivery_summary"),
  ]);
  if (plans.error || recipients.error)
    throw Error("Document changes could not be loaded.");
  return (
    <main style={{ padding: 24, maxWidth: 1000 }}>
      <h1>Document changes</h1>
      <p>
        Queue the approved document and its summary before a separately approved
        publication. Customer changes require written notice at least 30 days
        before publication. A late or failed delivery blocks publication. This
        tool does not publish legal text.
      </p>
      <DocumentChangeForm />
      <h2>Notices and delivery</h2>
      {(plans.data ?? []).map((plan) => {
        const counts = recipients.data?.find(
          (row: { plan_id: string }) => row.plan_id === plan.id,
        );
        return (
          <article
            key={plan.id}
            style={{
              border: "1px solid var(--ob-border)",
              borderRadius: 16,
              padding: 20,
              marginTop: 16,
            }}
          >
            <h3>
              {plan.title} · {plan.version}
            </h3>
            <p>{plan.summary}</p>
            <p>
              Effective {plan.effective_at}; announced {plan.announced_at}
            </p>
            <p>
              {counts?.sent ?? 0} sent / {counts?.total ?? 0} customer notices;{" "}
              {counts?.pending ?? 0} pending; {counts?.failed ?? 0} failed.
            </p>
          </article>
        );
      })}
    </main>
  );
}
