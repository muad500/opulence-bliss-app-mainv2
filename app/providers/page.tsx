"use client";

// Our professionals — public list of vetted, active providers.
// Save at: app/providers/page.tsx

import { useEffect, useState } from "react";
import { visibleProfessionalServices } from "@/lib/professionalServices";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type P = {
  id: string;
  display_name: string | null;
  bio: string | null;
  photo_url: string | null;
  years_experience: number | null;
  services: string[] | null;
  public_rating_avg: number | null;
  public_rating_count: number;
  ratings: {
    service: string;
    rating_avg: number | null;
    rating_count: number;
  }[];
};

const SERVICE_LABEL: Record<string, string> = {
  cleaning: "Home cleaning",
  handyman: "Handyman",
};

export default function ProvidersPage() {
  const [list, setList] = useState<P[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const config = await fetch("/api/handyman/config")
        .then((r) => r.json())
        .catch(() => ({ enabled: false }));
      const { data: ratings, error: ratingsError } = await supabase
        .from("professional_service_ratings")
        .select("provider_id,service,rating_avg,rating_count");
      const visibleRatings = (ratings ?? []).filter(
        (row) =>
          visibleProfessionalServices([row.service], config.enabled === true)
            .length,
      );
      const { data: eligible, error: eligibilityError } = await supabase.rpc(
        "public_eligible_provider_ids",
      );
      const eligibleIds = (eligible ?? []).map((row: { id: string }) => row.id);
      if (eligibilityError || ratingsError || eligibleIds.length === 0) {
        setList([]);
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("providers")
        .select(
          "id, display_name, bio, photo_url, years_experience, services, public_rating_avg, public_rating_count",
        )
        .eq("vetting_status", "approved")
        .eq("dbs_verified", true)
        .eq("is_suspended", false)
        .eq("show_on_our_pros", true)
        .in("id", eligibleIds)
        .order("public_rating_avg", { ascending: false, nullsFirst: false });
      setList(
        (data ?? []).flatMap((p) => {
          const serviceRatings = visibleRatings.filter(
            (row) => row.provider_id === p.id,
          );
          return serviceRatings.length
            ? [
                {
                  ...p,
                  services: serviceRatings.map((row) => row.service),
                  ratings: serviceRatings,
                },
              ]
            : [];
        }),
      );
      setLoading(false);
    })();
  }, []);

  return (
    <main className="wrap">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap"
      />

      <div className="inner">
        <p className="eyebrow">Our professionals</p>
        <h1>The people who&apos;ll be in your home</h1>
        <p className="lede">
          Every professional shown here has completed our approval and DBS
          review and is rated by the clients they&apos;ve worked for. We&apos;ll
          match you with whoever&apos;s best placed for your booking.
        </p>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <div className="empty">
            No active professionals yet.{" "}
            <a href="/provider/join">Join as a provider →</a>
          </div>
        ) : (
          <div className="grid">
            {list.map((p) => (
              <article key={p.id} className="card">
                <div className="head">
                  {p.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo_url} alt={p.display_name ?? "Provider"} />
                  ) : (
                    <div className="initials">
                      {(p.display_name ?? "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h2>{p.display_name ?? "Opulence provider"}</h2>
                    <p className="meta">
                      {(p.services ?? [])
                        .map((s) => SERVICE_LABEL[s] ?? s)
                        .join(" · ")}
                      {p.years_experience
                        ? ` · ${p.years_experience} yrs experience`
                        : ""}
                    </p>
                    {p.ratings.map((row) => (
                      <p className="stars" key={row.service}>
                        {SERVICE_LABEL[row.service]}:{" "}
                        {row.rating_count > 0 && row.rating_avg != null ? (
                          <>
                            <span>
                              {"★".repeat(Math.round(Number(row.rating_avg)))}
                              {"☆".repeat(
                                5 - Math.round(Number(row.rating_avg)),
                              )}
                            </span>{" "}
                            {Number(row.rating_avg).toFixed(1)} (
                            {row.rating_count})
                          </>
                        ) : (
                          <span className="new">Newly joined</span>
                        )}
                      </p>
                    ))}
                  </div>
                </div>
                {p.bio && <p className="bio">{p.bio}</p>}
                <a className="profile-link" href={`/providers/${p.id}`}>
                  View profile <span aria-hidden="true">→</span>
                </a>
              </article>
            ))}
          </div>
        )}

        <div className="cta-row">
          <a className="cta" href="/book">
            Book a service
          </a>
          <a className="ghost" href="/provider/join">
            Work with us
          </a>
        </div>
      </div>

      <style jsx>{`
        .wrap {
          min-height: 100vh;
          background: #fff;
          color: #16202a;
          font-family: "Nunito", system-ui, sans-serif;
          padding: 0 20px 80px;
        }
        .inner {
          max-width: 820px;
          margin: 0 auto;
          padding-top: 40px;
        }
        /* Intro only. The provider cards below keep their own alignment. */
        .inner > .eyebrow,
        .inner > h1,
        .inner > .lede {
          text-align: center;
        }
        .inner > .lede {
          margin-left: auto;
          margin-right: auto;
        }
        .brand {
          font-family: "Nunito", system-ui, sans-serif;
          font-size: 19px;
          font-weight: 600;
          color: #16202a;
          text-decoration: none;
          display: inline-block;
          margin-bottom: 26px;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-size: 12px;
          font-weight: 600;
          color: #6d28d9;
          margin: 0 0 8px;
        }
        h1 {
          font-family: "Nunito", system-ui, sans-serif;
          font-weight: 900;
          font-size: clamp(30px, 4.6vw, 44px);
          line-height: 1.08;
          color: #16202a;
          margin: 0 0 12px;
        }
        .lede {
          color: #7a828c;
          font-size: 17px;
          line-height: 1.6;
          max-width: 54ch;
          margin: 0 0 34px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(
            auto-fit,
            minmax(min(100%, 320px), 1fr)
          );
          gap: 18px;
        }
        .card {
          background: #fff;
          border: 1px solid #edeff1;
          border-radius: 18px;
          padding: 24px 24px;
        }
        .head {
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }
        .head img,
        .initials {
          width: 62px;
          height: 62px;
          border-radius: 50%;
          flex-shrink: 0;
          object-fit: cover;
        }
        .initials {
          display: grid;
          place-items: center;
          background: #f4ecfe;
          color: #16202a;
          font-family: "Nunito", system-ui, sans-serif;
          font-size: 26px;
        }
        h2 {
          font-family: "Nunito", system-ui, sans-serif;
          font-weight: 900;
          font-size: 21px;
          color: #16202a;
          margin: 0 0 4px;
        }
        .meta {
          color: #7a828c;
          font-size: 13.5px;
          margin: 0 0 6px;
        }
        .stars {
          margin: 0;
          font-size: 13.5px;
          color: #7a828c;
        }
        .stars span {
          color: #6d28d9;
          letter-spacing: 1px;
        }
        .stars .new {
          color: #a9afb7;
          letter-spacing: 0;
        }
        .bio {
          color: #16202a;
          font-size: 14.5px;
          line-height: 1.6;
          margin: 16px 0 0;
        }
        .profile-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 18px;
          color: #6d28d9;
          font-size: 14px;
          font-weight: 800;
          text-decoration: none;
        }
        .profile-link:hover,
        .profile-link:focus-visible {
          text-decoration: underline;
        }
        .empty {
          background: #fff;
          border: 1.5px dashed #e5e7ea;
          border-radius: 14px;
          padding: 30px 24px;
          text-align: center;
          color: #7a828c;
        }
        .empty a {
          color: #16202a;
          font-weight: 600;
        }
        .cta-row {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 34px;
        }
        .cta,
        .ghost {
          border-radius: 999px;
          padding: 13px 26px;
          text-decoration: none;
          font-weight: 600;
          font-size: 15px;
        }
        .cta {
          background: linear-gradient(100deg, #f5c542, #c86fc9 55%, #7b2ff7);
          color: #fff;
        }
        .ghost {
          border: 1.5px solid #16202a;
          color: #16202a;
        }
        .muted {
          color: #7a828c;
        }
      `}</style>
    </main>
  );
}
