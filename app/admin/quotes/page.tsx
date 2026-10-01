import AdminNav from "../AdminNav";
import { requireAdminPage } from "@/lib/adminSession";
import { updateHandymanQuote } from "./actions";

type Quote = {
  id: string;
  reference: string;
  full_name: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  task_type: string;
  description: string;
  preferred_date: string | null;
  preferred_time: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  preferred_provider_id: string | null;
  quoted_hourly_rate_pence: number | null;
  estimated_hours: number | null;
  estimate_total_pence: number | null;
};

export default async function AdminQuotesPage() {
  const { supabase, user } = await requireAdminPage();
  const { data, error } = await supabase
    .from("handyman_quote_requests")
    .select("id, reference, full_name, email, phone, address, postcode, task_type, description, preferred_date, preferred_time, status, admin_notes, created_at, preferred_provider_id, quoted_hourly_rate_pence, estimated_hours, estimate_total_pence")
    .order("created_at", { ascending: false });
  const quotes = (data ?? []) as Quote[];

  return (
    <main className="page">
      <AdminNav email={user.email ?? "Admin"} />
      <div className="inner">
        <p className="eyebrow">Handyman</p>
        <h1>Quotation requests</h1>
        <p className="lede">Review the work requested, contact the customer and record the quotation stage.</p>

        {error ? <p className="error">{error.message}</p> : quotes.length === 0 ? (
          <section className="empty">No handyman quotation requests yet.</section>
        ) : (
          <section className="list">
            {quotes.map((quote) => (
              <article className="card" key={quote.id}>
                <div className="head">
                  <div><span>{quote.reference}</span><h2>{quote.task_type}</h2></div>
                  <strong className={`status ${quote.status}`}>{quote.status}</strong>
                </div>
                <div className="facts">
                  <p><b>Customer</b>{quote.full_name}</p>
                  <p><b>Contact</b><a href={`mailto:${quote.email}`}>{quote.email}</a><br /><a href={`tel:${quote.phone}`}>{quote.phone}</a></p>
                  <p><b>Address</b>{quote.address}<br />{quote.postcode}</p>
                  <p><b>Preferred</b>{quote.preferred_date ?? "Flexible"}{quote.preferred_time ? ` · ${quote.preferred_time}` : ""}</p>
                </div>
                {quote.preferred_provider_id && <p><a href={`/admin/cleaners/${quote.preferred_provider_id}`}>Requested professional →</a> · £{((quote.quoted_hourly_rate_pence ?? 0) / 100).toFixed(2)}/hr · {quote.estimated_hours} hours · estimate £{((quote.estimate_total_pence ?? 0) / 100).toFixed(2)}</p>}
                <div className="description"><b>Job details</b><p>{quote.description}</p></div>
                <form action={updateHandymanQuote.bind(null, quote.id)}>
                  <label>Status<select name="status" defaultValue={quote.status}>
                    <option value="new">New</option><option value="reviewing">Reviewing</option>
                    <option value="quoted">Quoted</option><option value="accepted">Accepted</option>
                    <option value="declined">Declined</option><option value="closed">Closed</option>
                  </select></label>
                  <label className="notes">Admin notes<textarea name="adminNotes" rows={3} defaultValue={quote.admin_notes ?? ""} /></label>
                  <button type="submit">Save quote status</button>
                </form>
                <small>Received {new Date(quote.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</small>
              </article>
            ))}
          </section>
        )}
      </div>
      <style>{`
        .page{min-height:100vh;padding-bottom:80px;background:#f7f8fa;color:#16202a;font-family:"Nunito",system-ui,sans-serif}.inner{max-width:1080px;margin:0 auto;padding:0 20px}.eyebrow{margin:0 0 5px;color:#6d28d9;font-size:11px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}.page h1{margin:0 0 7px;font-size:36px;font-weight:900}.lede{margin:0 0 25px;color:#68717d}.list{display:grid;gap:16px}.card{padding:22px;border:1px solid #e5e7eb;border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(22,32,42,.05)}.head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.head span{color:#6d28d9;font-size:11px;font-weight:900;letter-spacing:.08em}.head h2{margin:3px 0 0;font-size:22px;font-weight:900}.status{padding:5px 10px;border-radius:999px;background:#f1e9fb;color:#6d28d9;font-size:11px;text-transform:capitalize}.status.new{background:#fff3cc;color:#7a5610}.status.accepted,.status.quoted{background:#e4f6ec;color:#137b4e}.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.facts p{margin:0;color:#4f5965;font-size:13.5px;line-height:1.45}.facts b,.description b{display:block;margin-bottom:4px;color:#16202a;font-size:11px;text-transform:uppercase;letter-spacing:.07em}.facts a{color:#6d28d9}.description{padding:14px;border-radius:12px;background:#f8f6fb}.description p{margin:5px 0 0;white-space:pre-wrap}.card form{display:grid;grid-template-columns:190px minmax(0,1fr) auto;gap:12px;align-items:end;margin-top:16px}.card label{display:grid;gap:5px;color:#58616d;font-size:12px;font-weight:800}.card select,.card textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #dfe2e7;border-radius:10px;background:#fff;font:inherit}.card button{min-height:42px;padding:9px 16px;border:0;border-radius:999px;background:#6d28d9;color:#fff;font:inherit;font-weight:900;cursor:pointer}.card>small{display:block;margin-top:12px;color:#9298a1}.empty,.error{padding:24px;border:1px solid #e5e7eb;border-radius:16px;background:#fff}.error{color:#a52e47}@media(max-width:760px){.facts{grid-template-columns:1fr 1fr}.card form{grid-template-columns:1fr}.page h1{font-size:30px}}@media(max-width:480px){.facts{grid-template-columns:1fr}}
      `}</style>
    </main>
  );
}
