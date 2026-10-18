"use client";
import { FormEvent, useEffect, useState } from "react";
type Row = {
  id: string;
  customer_name: string;
  service_label: string;
  rating: number | null;
  comment: string | null;
  status: string;
  submitted_at: string | null;
};
export default function AdminPreviousCustomerReviews() {
  const [rows, setRows] = useState<Row[]>([]),
    [message, setMessage] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/admin/previous-customer-reviews", {
      cache: "no-store",
    });
    const result = await response.json();
    if (response.ok) setRows(result.reviews);
    else setMessage(result.error);
  }
  useEffect(() => {
    void load();
  }, []);
  async function post(body: object) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/previous-customer-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.message ?? "Decision saved.");
      setLink(result.link ?? "");
      await load();
    } catch (failure) {
      setMessage(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void post({
      name: data.get("name"),
      email: data.get("email"),
      service: data.get("service"),
    });
  }
  return (
    <section
      id="previous-customers"
      style={{
        background: "white",
        padding: 24,
        borderRadius: 16,
        marginBlock: 24,
      }}
    >
      <h2>Previous customer reviews</h2>
      <p>
        Invite a genuine past customer. Their submitted words, name, rating and
        date are locked. Approved reviews carry a “Previous customer” label and
        never change the headline star rating.
      </p>
      <form onSubmit={invite} style={{ display: "grid", gap: 10 }}>
        <label>
          Customer name
          <input required name="name" maxLength={100} />
        </label>
        <label>
          Customer email
          <input required name="email" type="email" />
        </label>
        <label>
          Previous service
          <input
            required
            name="service"
            maxLength={120}
            defaultValue="Cleaning"
          />
        </label>
        <button disabled={busy}>Create review link</button>
      </form>
      <p role="status">{message}</p>
      {link && (
        <div>
          <label>
            Private link for this customer
            <input readOnly value={link} style={{ width: "100%" }} />
          </label>
          <button onClick={() => void navigator.clipboard.writeText(link)}>
            Copy link
          </button>
        </div>
      )}
      <div>
        {rows.map((row) => (
          <article
            key={row.id}
            style={{
              borderTop: "1px solid #e8def1",
              marginTop: 18,
              paddingTop: 18,
            }}
          >
            <strong>{row.customer_name}</strong> · {row.service_label} ·{" "}
            {row.status}
            {row.submitted_at && (
              <>
                <p>
                  {row.rating} stars ·{" "}
                  {new Date(row.submitted_at).toLocaleDateString("en-GB")}
                </p>
                <blockquote>{row.comment}</blockquote>
              </>
            )}
            {row.status === "pending" && (
              <div>
                <button
                  disabled={busy}
                  onClick={() =>
                    void post({
                      action: "moderate",
                      id: row.id,
                      status: "approved",
                    })
                  }
                >
                  Approve
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void post({
                      action: "moderate",
                      id: row.id,
                      status: "rejected",
                    })
                  }
                >
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
