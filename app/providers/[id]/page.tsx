import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import styles from "./page.module.css";

const SERVICE_LABEL: Record<string, string> = {
  cleaning: "Home cleaning",
};

const PROVIDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PublicProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!PROVIDER_ID.test(id)) notFound();

  const supabase = await createClient();
  const { data: eligible, error: eligibilityError } = await supabase
    .rpc("public_eligible_provider_ids")
    .eq("id", id)
    .maybeSingle();
  if (eligibilityError) throw new Error("Professional verification could not be checked.");
  if (!eligible) notFound();
  const { data: provider, error } = await supabase
    .from("providers")
    .select("id,display_name,bio,photo_url,years_experience,services,public_rating_avg,public_rating_count")
    .eq("id", id)
    .eq("vetting_status", "approved")
    .eq("dbs_verified", true)
    .eq("is_suspended", false)
    .eq("show_on_our_pros", true)
    .maybeSingle();

  if (error) throw new Error("Professional profile could not be loaded.");
  if (!provider) notFound();

  const name = provider.display_name?.trim() || "Opulence professional";
  const services = (provider.services ?? []).map((service: string) => SERVICE_LABEL[service] ?? service);
  const rating = Number(provider.public_rating_avg);
  const hasRating = provider.public_rating_avg !== null && Number.isFinite(rating);
  const ratingCount = Number(provider.public_rating_count) || 0;
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = serviceUrl && serviceKey
    ? createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  // These settings are private as a table; disclose only the fields the worker
  // edits under "Customers can see this", after checking public eligibility.
  const [settingsResult, ratesResult, reviewsResult] = admin ? await Promise.all([
    admin.from("provider_profile_settings").select("languages,brings_equipment").eq("provider_id", id).maybeSingle(),
    services.includes("handyman")
      ? admin.from("provider_task_rates").select("task_name,hourly_rate_pence").eq("provider_id", id).order("task_name")
      : Promise.resolve({ data: [], error: null }),
    admin.from("reviews")
      .select("id,rating,comment,created_at,bookings!inner(provider_id)")
      .eq("bookings.provider_id", id).eq("reviewer", "client").eq("visibility", "public")
      .order("created_at", { ascending: false }).limit(8),
  ]) : [{ data: null, error: null }, { data: [], error: null }, { data: [], error: null }];
  const languages = !settingsResult.error && Array.isArray(settingsResult.data?.languages)
    ? settingsResult.data.languages.filter((language: unknown): language is string => typeof language === "string" && language.trim().length > 0)
    : [];
  const equipment = !settingsResult.error ? settingsResult.data?.brings_equipment : null;
  const rates = !ratesResult.error ? (ratesResult.data ?? []).filter((row) =>
    typeof row.task_name === "string" && Number.isFinite(Number(row.hourly_rate_pence))
  ) : [];
  const reviews = !reviewsResult.error ? (reviewsResult.data ?? []) : [];

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Link className={styles.back} href="/providers">← All professionals</Link>
        <article className={styles.profile}>
          <div className={styles.heading}>
            {provider.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.photo} src={provider.photo_url} alt="" />
            ) : (
              <div className={styles.initial} aria-hidden="true">{name.charAt(0).toUpperCase()}</div>
            )}
            <div>
              <p className={styles.eyebrow}>Our professionals</p>
              <h1>{name}</h1>
              <p className={styles.verified}>Approved professional · DBS verified</p>
            </div>
          </div>

          <div className={styles.facts}>
            <div>
              <span className={styles.factLabel}>Client rating</span>
              {hasRating ? (
                <strong>{rating.toFixed(1)} / 5 <span className={styles.factDetail}>({ratingCount} {ratingCount === 1 ? "review" : "reviews"})</span></strong>
              ) : (
                <strong>Newly joined</strong>
              )}
            </div>
            {provider.years_experience != null && provider.years_experience > 0 && (
              <div>
                <span className={styles.factLabel}>Experience</span>
                <strong>{provider.years_experience} {provider.years_experience === 1 ? "year" : "years"}</strong>
              </div>
            )}
          </div>

          {provider.bio && (
            <section className={styles.section}>
              <h2>About {name}</h2>
              <p className={styles.bio}>{provider.bio}</p>
            </section>
          )}

          {(languages.length > 0 || equipment !== null && equipment !== undefined) && (
            <section className={styles.section}>
              <h2>Good to know</h2>
              {languages.length > 0 && <p className={styles.bio}><strong>Languages:</strong> {languages.join(", ")}</p>}
              {equipment !== null && equipment !== undefined && <p className={styles.bio}><strong>Equipment and supplies:</strong> {equipment ? "Brings their own" : "Arrange with the customer"}</p>}
            </section>
          )}

          {services.length > 0 && (
            <section className={styles.section}>
              <h2>Services</h2>
              <ul className={styles.services}>
                {services.map((service: string) => <li key={service}>{service}</li>)}
              </ul>
            </section>
          )}

          {rates.length > 0 && (
            <section className={styles.section}>
              <h2>Listed handyman rates</h2>
              <ul className={styles.rateList}>{rates.map((rate) => <li key={rate.task_name}><span>{rate.task_name}</span><strong>£{(Number(rate.hourly_rate_pence) / 100).toFixed(2)}/hr</strong></li>)}</ul>
              <p className={styles.rateNote}>The quote form confirms the price for each enquiry.</p>
            </section>
          )}

          {reviews.length > 0 && (
            <section className={styles.section}>
              <h2>Client reviews</h2>
              <div className={styles.reviewList}>{reviews.map((review) => <article key={review.id} className={styles.review}>
                <strong aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(Math.max(0, Math.min(5, review.rating)))}{"☆".repeat(Math.max(0, 5 - review.rating))}</strong>
                {review.comment && <p>{review.comment}</p>}
                <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</time>
              </article>)}</div>
            </section>
          )}

          <div className={styles.action}>
            <p>Ready to book? We&apos;ll match you with an available professional for your service.</p>
            <Link href="/book">Book a service</Link>
          </div>
        </article>
      </div>
    </main>
  );
}
