import { createClient } from "@/lib/supabase/server";
type PreviousReview = {
  id: string;
  customer_name: string;
  service_label: string;
  rating: number;
  comment: string;
  submitted_at: string;
};
export default async function PreviousCustomerReviews() {
  const client = await createClient();
  const { data, error } = await client.rpc("previous_customer_review_feed");
  const rows = (data ?? []) as PreviousReview[];
  if (error || !rows.length) return null;
  return (
    <section
      style={{ maxWidth: 1050, margin: "32px auto", padding: 20 }}
      aria-label="Previous customer reviews"
    >
      <h2>Previous customer experiences</h2>
      <p>
        Shared by previous customers and approved by our team. These reviews do
        not contribute to our booking star rating.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
          gap: 16,
        }}
      >
        {rows.map((row) => (
          <article
            key={row.id}
            style={{
              border: "1px solid #e8def1",
              borderRadius: 16,
              padding: 20,
            }}
          >
            <strong>{row.customer_name}</strong>
            <p>
              <span style={{ color: "#6d28d9", fontWeight: 800 }}>
                Previous customer
              </span>{" "}
              · {row.service_label}
            </p>
            <p aria-label={`${row.rating} out of 5 stars`}>
              {"★".repeat(row.rating)}
            </p>
            <blockquote style={{ margin: 0 }}>{row.comment}</blockquote>
            <time dateTime={row.submitted_at}>
              {new Date(row.submitted_at).toLocaleDateString("en-GB")}
            </time>
          </article>
        ))}
      </div>
    </section>
  );
}
