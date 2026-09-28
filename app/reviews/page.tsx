import SiteFooter from "@/components/SiteFooter";
import { createClient } from "@/lib/supabase/server";

type PublicReview = {
  id: string;
  reviewer: "client" | "provider";
  rating: number;
  comment: string | null;
  created_at: string;
  recipient_name: string;
  recipient_type: "professional" | "client";
};

type CustomerReview = {
  id: string;
  rating: number;
  comment: string;
  customer_name: string;
  location: string | null;
  reviewed_at: string;
};

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ReviewsPage() {
  const supabase = await createClient();
  const [{ data }, { data: customerData }] = await Promise.all([
    supabase.rpc("public_reviews_feed", { p_limit: 60 }),
    supabase
      .from("marketing_reviews")
      .select("id, rating, comment, customer_name, location, reviewed_at")
      .eq("service_type", "cleaning")
      .eq("is_demo", false)
      .is("source_review_id", null)
      .or("published.eq.true,homepage_featured.eq.true")
      .order("reviewed_at", { ascending: false })
      .limit(60),
  ]);
  const reviews = (data ?? []) as PublicReview[];
  const customerReviews = (customerData ?? []) as CustomerReview[];
  const feed = [
    ...customerReviews.map((review) => ({ kind: "customer" as const, date: review.reviewed_at, review })),
    ...reviews.map((review) => ({ kind: "booking" as const, date: review.created_at, review })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <main className="review-page">
        <section className="review-hero">
          <p className="eyebrow">Community reviews</p>
          <h1>Shared by customers and professionals</h1>
          <p>
            These reviews were deliberately shared publicly. Private feedback
            is shown only to the person who received it.
          </p>
        </section>

        {feed.length === 0 ? (
          <section className="empty">No public reviews have been shared yet.</section>
        ) : (
          <section className="review-grid" aria-label="Public reviews">
            {feed.map((entry) => entry.kind === "customer" ? (
              <article className="review-card customer-review" key={`customer-${entry.review.id}`}>
                <strong className="customer-name">{entry.review.customer_name}</strong>
                <span className="stars" aria-label={`${entry.review.rating} out of 5 stars`}>
                  {"★".repeat(entry.review.rating)}
                  {"☆".repeat(5 - entry.review.rating)}
                </span>
                <blockquote>{entry.review.comment}</blockquote>
                {entry.review.location && <p className="location">{entry.review.location}</p>}
              </article>
            ) : (
              <article className="review-card" key={`booking-${entry.review.id}`}>
                <div className="review-top">
                  <span className="stars" aria-label={`${entry.review.rating} out of 5 stars`}>
                    {"★".repeat(entry.review.rating)}
                    {"☆".repeat(5 - entry.review.rating)}
                  </span>
                  <time dateTime={entry.review.created_at}>{when(entry.review.created_at)}</time>
                </div>
                <p className="direction">
                  {entry.review.reviewer === "client"
                    ? `Customer review of ${entry.review.recipient_name}`
                    : "Professional review of a verified client"}
                </p>
                <blockquote>
                  {entry.review.comment?.trim() || "Rating shared without a comment."}
                </blockquote>
              </article>
            ))}
          </section>
        )}
      </main>
      <SiteFooter />

      <style>{`
        .review-page{min-height:70vh;padding:64px 20px 80px;background:var(--ob-surface);color:var(--ob-text);font-family:var(--font-nunito),Nunito,system-ui,sans-serif}
        .review-hero{max-width:760px;margin:0 auto 34px;text-align:center}
        .review-hero .eyebrow{margin:0 0 8px;color:var(--ob-purple);font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
        .review-hero h1{margin:0 0 12px;font-size:clamp(34px,6vw,54px);line-height:1.05;font-weight:900}
        .review-hero>p:last-child{max-width:620px;margin:0 auto;color:var(--ob-muted);font-size:16px;line-height:1.6}
        .review-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;max-width:1050px;margin:0 auto}
        .review-card,.empty{background:var(--ob-surface-raised);border:1px solid var(--ob-border);border-radius:18px;padding:22px}
        .review-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
        .stars{color:var(--ob-purple);letter-spacing:1px}.review-top time{color:var(--ob-muted);font-size:12px}
        .customer-review .customer-name{display:block;margin-bottom:6px;font-size:18px}
        .customer-review .stars{display:block;margin-bottom:10px}
        .customer-review .location{margin:12px 0 0;color:var(--ob-muted);font-size:13px}
        .direction{margin:12px 0 7px;color:var(--ob-muted);font-size:12.5px;font-weight:800}
        blockquote{margin:0;color:var(--ob-text);font-size:15px;line-height:1.55}
        .empty{max-width:620px;margin:0 auto;text-align:center;color:var(--ob-muted)}
      `}</style>
    </>
  );
}
