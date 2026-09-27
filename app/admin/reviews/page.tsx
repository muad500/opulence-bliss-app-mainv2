import AdminNav from "../AdminNav";
import ReviewList from "../ReviewList";
import { requireAdminPage } from "@/lib/adminSession";
import { loadAdminReviews } from "@/lib/adminReviews";
import {
  createMarketingReview,
  deleteMarketingReview,
  updateMarketingReview,
} from "./marketing-actions";
import {
  featureHomepageReview,
  unfeatureHomepageReview,
} from "./homepage-actions";

type MarketingReview = {
  id: string;
  rating: number;
  service_label: string;
  comment: string;
  customer_name: string;
  location: string | null;
  reviewed_at: string;
  published: boolean;
  is_demo: boolean;
  sort_order: number;
};

export default async function AdminReviewsPage() {
  const { supabase, user } = await requireAdminPage();
  const { reviews, error } = await loadAdminReviews(supabase, 100);
  const { data: marketingData, error: marketingError } = await supabase
    .from("marketing_reviews")
    .select(
      "id, rating, service_label, comment, customer_name, location, reviewed_at, published, is_demo, sort_order",
    )
    .eq("service_type", "cleaning")
    .order("sort_order", { ascending: true })
    .order("reviewed_at", { ascending: false });
  const marketingReviews = (marketingData ?? []) as MarketingReview[];
  const { data: featuredData, error: featuredError } = await supabase
    .from("homepage_review_highlights")
    .select("review_id, selected_at")
    .order("selected_at", { ascending: true });
  const featuredIds = new Set((featuredData ?? []).map((row) => row.review_id));
  const eligibleReviews = reviews.filter((review) =>
    review.reviewer === "client" &&
    review.visibility === "public" &&
    review.rating >= 4,
  );

  return (
    <main style={page}>
      <AdminNav email={user.email ?? "Admin"} />
      <div style={inner}>
        <p style={eyebrow}>App activity</p>
        <h1 style={title}>All recent reviews</h1>
        <p style={lede}>
          Cleaner and client reviews, newest first. Select a review to open the
          reviewer&apos;s profile, or use the reviewed-profile link to inspect the
          recipient.
        </p>

        <section className="marketing-card" aria-labelledby="homepage-highlights">
          <div className="marketing-heading">
            <div>
              <p style={eyebrow}>Homepage only</p>
              <h2 id="homepage-highlights">Featured customer reviews</h2>
            </div>
            <p>
              Choose up to three positive, public reviews from actual bookings
              for the homepage highlights. This does not hide negative reviews
              from the full public feed or change the overall rating. If none
              are selected, the homepage shows the latest eligible reviews.
            </p>
          </div>
          {featuredError ? (
            <p style={errorBox}>{featuredError.message}</p>
          ) : (
            <>
              <p className="highlight-count">{featuredIds.size} of 3 selected</p>
              {(featuredData ?? []).filter((row) => !eligibleReviews.some((review) => review.id === row.review_id)).map((row) => (
                <form className="highlight-row" action={unfeatureHomepageReview} key={row.review_id}>
                  <span>Previously selected review {row.review_id.slice(0, 8)}</span>
                  <input type="hidden" name="reviewId" value={row.review_id} />
                  <button type="submit">Remove from homepage</button>
                </form>
              ))}
              {eligibleReviews.length === 0 && !error ? (
                <p className="marketing-empty">No eligible public booking reviews yet.</p>
              ) : eligibleReviews.map((review) => (
                <form className="highlight-row" action={featuredIds.has(review.id) ? unfeatureHomepageReview : featureHomepageReview} key={review.id}>
                  <span>
                    <strong>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</strong>
                    {review.comment?.trim()
                      ? ` “${review.comment.trim()}”`
                      : " Rating shared without a written comment."}
                    <small>Booking #{review.bookingReference} · {review.reviewerName}</small>
                  </span>
                  <input type="hidden" name="reviewId" value={review.id} />
                  <button type="submit" disabled={!featuredIds.has(review.id) && featuredIds.size >= 3}>
                    {featuredIds.has(review.id) ? "Remove from homepage" : "Feature on homepage"}
                  </button>
                </form>
              ))}
            </>
          )}
        </section>

        <section className="marketing-card" aria-labelledby="cleaning-testimonials">
          <div className="marketing-heading">
            <div>
              <p style={eyebrow}>Public cleaning page</p>
              <h2 id="cleaning-testimonials">Cleaning testimonials</h2>
            </div>
            <p>
              Use Feature on cleaning page to choose which genuine customer testimonials appear
              in the featured selection. Prototype samples cannot be published.
              This does not hide booking reviews or change the overall rating:
              public 1–5 star reviews remain available in the full review feed.
            </p>
          </div>

          <form className="review-form create" action={createMarketingReview}>
            <label>Service<input name="serviceLabel" placeholder="Essential Clean" required /></label>
            <label>Customer<input name="customerName" placeholder="First name" required /></label>
            <label>Location<input name="location" placeholder="London area (optional)" /></label>
            <label>Rating<select name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((rating) => <option value={rating} key={rating}>{rating} / 5</option>)}</select></label>
            <label>Date<input name="reviewedAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            <label>Order<input name="sortOrder" type="number" defaultValue="0" /></label>
            <label className="wide">Review<textarea name="comment" rows={3} placeholder="Cleaning-related feedback" required /></label>
            <div className="toggles">
              <label><input type="checkbox" name="published" defaultChecked /> Feature on cleaning page</label>
              <label><input type="checkbox" name="isDemo" defaultChecked /> Prototype sample</label>
            </div>
            <button type="submit">Add testimonial</button>
          </form>

          {marketingError ? (
            <p style={errorBox}>{marketingError.message}</p>
          ) : marketingReviews.length === 0 ? (
            <p className="marketing-empty">No manually managed cleaning testimonials yet.</p>
          ) : (
            <div className="managed-list">
              {marketingReviews.map((review) => (
                <form className="review-form managed" action={updateMarketingReview.bind(null, review.id)} key={review.id}>
                  <label>Service<input name="serviceLabel" defaultValue={review.service_label} required /></label>
                  <label>Customer<input name="customerName" defaultValue={review.customer_name} required /></label>
                  <label>Location<input name="location" defaultValue={review.location ?? ""} /></label>
                  <label>Rating<select name="rating" defaultValue={String(review.rating)}>{[5, 4, 3, 2, 1].map((rating) => <option value={rating} key={rating}>{rating} / 5</option>)}</select></label>
                  <label>Date<input name="reviewedAt" type="date" defaultValue={review.reviewed_at} required /></label>
                  <label>Order<input name="sortOrder" type="number" defaultValue={review.sort_order} /></label>
                  <label className="wide">Review<textarea name="comment" rows={3} defaultValue={review.comment} required /></label>
                  <div className="toggles">
                    <label><input type="checkbox" name="published" defaultChecked={review.published} /> Feature on cleaning page</label>
                    <label><input type="checkbox" name="isDemo" defaultChecked={review.is_demo} /> Prototype sample</label>
                  </div>
                  <div className="form-actions">
                    <button type="submit">Save</button>
                    <button className="delete" formAction={deleteMarketingReview.bind(null, review.id)}>Delete</button>
                  </div>
                </form>
              ))}
            </div>
          )}
        </section>

        <section style={card} aria-label="Recent app reviews">
          {error ? (
            <p style={errorBox}>{error}</p>
          ) : (
            <ReviewList reviews={reviews} />
          )}
        </section>
      </div>
      <style>{`
        .marketing-card{margin:0 0 24px;padding:22px;border:1px solid #e4daf5;border-radius:18px;background:linear-gradient(145deg,#fffdf7,#fff8fb 52%,#f5efff);box-shadow:0 10px 28px rgba(61,34,97,.05)}
        .marketing-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:18px}.marketing-heading h2{margin:0;font-size:24px;font-weight:950}.marketing-heading>p{max-width:470px;margin:0;color:#68717d;font-size:13px;line-height:1.5}
        .review-form{display:grid;grid-template-columns:1.3fr 1fr 1fr 100px 150px 80px;gap:10px;align-items:end;padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#fff}.review-form label{display:grid;gap:5px;color:#59626d;font-size:11px;font-weight:900}.review-form input,.review-form select,.review-form textarea{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #dfe2e7;border-radius:9px;background:#fff;color:#16202a;font:inherit}.review-form .wide{grid-column:1/-1}.toggles{display:flex;flex-wrap:wrap;gap:15px;grid-column:1/-2}.toggles label{display:flex;grid-auto-flow:column;justify-content:start;align-items:center;gap:7px}.toggles input{width:16px;height:16px}.review-form button{min-height:40px;padding:8px 15px;border:0;border-radius:999px;background:#6d28d9;color:#fff;font:inherit;font-weight:900;cursor:pointer}.managed-list{display:grid;gap:12px;margin-top:14px}.review-form.managed{background:rgba(255,255,255,.78)}.form-actions{display:flex;justify-content:flex-end;gap:7px}.review-form button.delete{background:#fff;border:1px solid #d4455c;color:#b82d46}.marketing-empty{margin:14px 0 0;padding:18px;border:1px dashed #d9cdea;border-radius:12px;color:#68717d;text-align:center}
        .highlight-count{margin:0 0 12px;color:#6d28d9;font-size:13px;font-weight:900}
        .highlight-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;border-top:1px solid #e5e7eb}
        .highlight-row>span{min-width:0;overflow-wrap:anywhere;color:#26302a;font-size:13px;line-height:1.45}
        .highlight-row strong{color:#6d28d9;white-space:nowrap;margin-right:8px}
        .highlight-row small{display:block;margin-top:4px;color:#68717d}
        .highlight-row button{flex:0 0 auto;min-height:38px;padding:7px 13px;border:1px solid #6d28d9;border-radius:999px;background:#fff;color:#6d28d9;font:inherit;font-size:12px;font-weight:900;cursor:pointer}
        .highlight-row button:disabled{opacity:.45;cursor:not-allowed}
        @media(max-width:900px){.review-form{grid-template-columns:repeat(2,minmax(0,1fr))}.review-form .wide,.toggles{grid-column:1/-1}.form-actions{grid-column:1/-1}.marketing-heading{display:block}.marketing-heading>p{margin-top:8px}}
        @media(max-width:560px){.review-form{grid-template-columns:1fr}.review-form .wide,.toggles,.form-actions{grid-column:1}.marketing-card{padding:15px}.highlight-row{align-items:flex-start;flex-direction:column}}
      `}</style>
    </main>
  );
}

const page: React.CSSProperties = {
  minHeight: "100vh",
  paddingBottom: 80,
  background: "#f7f8fa",
  color: "#16202a",
  fontFamily: "'Nunito', system-ui, sans-serif",
};
const inner: React.CSSProperties = { maxWidth: 1050, margin: "0 auto", padding: "0 20px" };
const eyebrow: React.CSSProperties = { margin: "0 0 5px", color: "#6d28d9", fontSize: 11, fontWeight: 900, letterSpacing: "0.13em", textTransform: "uppercase" };
const title: React.CSSProperties = { margin: "0 0 6px", fontSize: 34, fontWeight: 900 };
const lede: React.CSSProperties = { maxWidth: 720, margin: "0 0 24px", color: "#68717d", fontSize: 14.5, lineHeight: 1.55 };
const card: React.CSSProperties = { padding: "6px 20px", border: "1px solid #e5e7eb", borderRadius: 16, background: "#fff" };
const errorBox: React.CSSProperties = { margin: "14px 0", padding: 14, borderRadius: 12, background: "#fff1f3", color: "#a52e47" };
