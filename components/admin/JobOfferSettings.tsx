"use client";

import { useEffect, useState } from "react";
import type { JobOfferSettings as Settings } from "@/lib/jobOfferSettings";

export default function JobOfferSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/admin/job-offer-settings", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setSettings(body);
      })
      .catch((error) => setMessage(error.message));
  }, []);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/job-offer-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstWaveSize: Number(form.get("size")),
          secondWaveAfterMinutes: Number(form.get("wait")),
          version: settings.version,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setSettings(body);
      setMessage(
        "Saved for new offer runs. Offers already sent keep their timing.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="job-offer-heading">
      <h2 id="job-offer-heading">Cleaning job offers</h2>
      <p>
        Favourites rank first, then cleaners who have served this customer.
        Distance, ratings, completed work, acceptance and reliability rank each
        group.
      </p>
      <p>
        The first wave stays open. After the wait, all remaining qualified
        cleaners receive the offer. The first acceptance wins.
      </p>
      <p>
        Distance uses postcode district centres. Missing location data earns no
        distance points. Checks, coverage and availability are always required.
      </p>
      {message && <p role="status">{message}</p>}
      {settings ? (
        <form onSubmit={save} key={settings.version}>
          <fieldset disabled={busy}>
            <legend>Offer waves</legend>
            <label>
              Cleaners in the first wave
              <input
                name="size"
                type="number"
                min="1"
                max="100"
                step="1"
                required
                defaultValue={settings.firstWaveSize}
              />
            </label>
            <label>
              Minutes before offering to everyone else
              <input
                name="wait"
                type="number"
                min="1"
                max="1440"
                step="1"
                required
                defaultValue={settings.secondWaveAfterMinutes}
              />
            </label>
          </fieldset>
          <button disabled={busy}>
            {busy ? "Saving…" : "Save offer settings"}
          </button>
        </form>
      ) : (
        <p role="status">Loading offer settings…</p>
      )}
      <style jsx>{`
        h2 {
          margin: 0 0 12px;
          font-size: 26px;
          line-height: 1.25;
          font-weight: 800;
        }
        p {
          margin: 0 0 12px;
          color: #617085;
          line-height: 1.6;
        }
        section {
          margin-top: 36px;
          border-top: 1px solid #e3ddef;
          padding-top: 24px;
        }
        fieldset {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 18px;
          border: 1px solid #e3ddef;
          border-radius: 16px;
          padding: 20px;
          margin: 20px 0;
        }
        legend,
        label {
          font-weight: 700;
        }
        label {
          display: grid;
          gap: 8px;
        }
        input {
          width: 100%;
          border: 1px solid #cfc6df;
          border-radius: 8px;
          padding: 10px;
          font: inherit;
        }
        button {
          border: 0;
          border-radius: 10px;
          padding: 12px 20px;
          background: #7028c7;
          color: white;
          font-weight: 800;
        }
      `}</style>
    </section>
  );
}
