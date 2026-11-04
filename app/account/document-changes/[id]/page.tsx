import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sanitizeLegalHtml } from "@/lib/legalDocuments";
export default async function DocumentChangeNotice({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await client.rpc("document_change_for_me", {
    p_plan: id,
  });
  if (error) throw Error("This document notice could not be loaded.");
  const plan = data?.[0];
  if (!plan) notFound();
  return (
    <main style={{ padding: 24, maxWidth: 850, margin: "auto" }}>
      <h1>{plan.title}</h1>
      <p>
        Version {plan.version} · Effective{" "}
        {new Date(plan.effective_at).toLocaleDateString("en-GB", {
          timeZone: "Europe/London",
        })}
      </p>
      <h2>What is changing</h2>
      <p style={{ whiteSpace: "pre-line" }}>{plan.summary}</p>
      <a href={`/api/account/document-updates/${id}/pdf`}>
        Download the approved PDF
      </a>
      <div
        dangerouslySetInnerHTML={{
          __html: sanitizeLegalHtml(plan.source_content_html),
        }}
      />
      <p>
        Your existing bookings keep their accepted terms. You will be asked to
        accept the updated version at your next booking after it takes effect.
      </p>
      <Link href="/account/roles">My account roles and documents</Link>
    </main>
  );
}
