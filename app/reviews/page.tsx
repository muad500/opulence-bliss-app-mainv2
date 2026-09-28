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

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ReviewsPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_reviews_feed", { p_limit: 60 });
  const reviews = (data ?? []) as PublicReview[];

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

        {reviews.length === 0 ? (
          <section className="empty">No public reviews have been shared yet.</section>
        ) : (
          <section className="review-grid" aria-label="Public reviews">
            {reviews.map((review) => (
              <article className="review-card" key={review.id}>
                <div className="review-top">
                  <span className="stars" aria-label={`${review.rating} out of 5 stars`}>
                    {"★".repeat(review.rating)}
                    {"☆".repeat(5 - review.rating)}
                  </span>
                  <time dateTime={review.created_at}>{when(review.created_at)}</time>
                </div>
                <p className="direction">
                  {review.reviewer === "client"
                    ? `Customer review of ${review.recipient_name}`
                    : "Professional review of a verified client"}
                </p>
                <blockquote>
                  {review.comment?.trim() || "Rating shared without a comment."}
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
        .direction{margin:12px 0 7px;color:var(--ob-muted);font-size:12.5px;font-weight:800}
        blockquote{margin:0;color:var(--ob-text);font-size:15px;line-height:1.55}
        .empty{max-width:620px;margin:0 auto;text-align:center;color:var(--ob-muted)}
      `}</style>
    </>
  );
}
