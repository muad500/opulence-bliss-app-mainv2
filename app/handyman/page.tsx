'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { HANDYMAN_TASKS, handymanBill } from '@/lib/handymanMarketplace';
import { londonDate } from '@/lib/appointmentWindow';
import styles from './marketplace.module.css';
type Offer = {
  id: string;
  display_name: string;
  bio: string | null;
  photo_url: string | null;
  years_experience: number | null;
  publicReviews: {
    rating: number;
    comment: string | null;
    reviewed_at: string;
  }[];
  hourlyRatePence: number;
  vatBps: number;
  equipment: boolean;
  completedJobs: number;
  rating: number | null;
  ratingCount: number;
};
const money = (p: number) => '£' + (p / 100).toFixed(2);
export default function Page() {
  const [task, setTask] = useState<string>(HANDYMAN_TASKS[0]),
    [description, setDescription] = useState(''),
    [address, setAddress] = useState(''),
    [postcode, setPostcode] = useState(''),
    [date, setDate] = useState(''),
    [time, setTime] = useState('12:00'),
    [minutes, setMinutes] = useState(60),
    [materials, setMaterials] = useState(0),
    [photos, setPhotos] = useState<File[]>([]),
    [offers, setOffers] = useState<Offer[]>([]),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false),
    [error, setError] = useState('');
  function slot() {
    const [y, m, d] = date.split('-').map(Number),
      [h, n] = time.split(':').map(Number);
    return londonDate(y, m, d, h, n).toISOString();
  }
  async function search() {
    setBusy(true);
    setError('');
    setSelected('');
    try {
      const q = new URLSearchParams({
          task,
          postcode: postcode.trim().toUpperCase(),
          slot: slot(),
          minutes: String(minutes)
        }),
        r = await fetch('/api/handyman/offers?' + q),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      setOffers(data.professionals);
      setSearched(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Choose a valid date and time.'
      );
    } finally {
      setBusy(false);
    }
  }
  async function book() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/handyman/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task,
            description,
            address,
            postcode: postcode.trim().toUpperCase(),
            slot: slot(),
            minutes,
            materialsBudgetPence: Math.round(materials * 100),
            providerId: selected
          })
        }),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      for (const photo of photos) {
        const form = new FormData();
        form.set('kind', 'photo');
        form.set('file', photo);
        const upload = await fetch(
          '/api/handyman/jobs/' + data.jobId + '/files',
          { method: 'POST', body: form }
        );
        if (!upload.ok)
          throw Error(
            'A photo could not be saved. Open My handyman jobs to retry the authorisation.'
          );
      }
      window.location.assign(data.url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Booking could not be started.'
      );
    } finally {
      setBusy(false);
    }
  }
  const professional = offers.find((p) => p.id === selected),
    bill = professional
      ? handymanBill(
          professional.hourlyRatePence,
          minutes,
          professional.vatBps,
          Math.round(materials * 100)
        )
      : null;
  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <nav className={styles.nav}>
          <Link href="/handyman/jobs">My handyman jobs</Link>
          <Link href="/handyman/apply">Apply as a handyman</Link>
          <Link href="/account/profile">My profile</Link>
        </nav>
        <h1>A professional for your home tasks</h1>
        <p>
          Choose the work, time and professional. Your card is held at checkout.
          Pay for worked time and the materials you approve after the job.
        </p>
      </div>
      <section className={styles.card}>
        <h2>What needs doing?</h2>
        <div className={styles.grid}>
          <label className={styles.field}>
            Task
            <select
              value={task}
              onChange={(e) => {
                setTask(e.target.value);
                setOffers([]);
                setSelected('');
              }}
            >
              {HANDYMAN_TASKS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Postcode
            <input
              autoComplete="postal-code"
              value={postcode}
              onChange={(e) => {
                setPostcode(e.target.value);
                setSelected('');
              }}
              placeholder="SW3 1AA"
            />
          </label>
          <label className={styles.field}>
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSelected('');
              }}
            />
          </label>
          <label className={styles.field}>
            Time in London
            <input
              type="time"
              step="1800"
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                setSelected('');
              }}
            />
          </label>
          <label className={styles.field}>
            Estimated hours
            <select
              value={minutes}
              onChange={(e) => {
                setMinutes(Number(e.target.value));
                setSelected('');
              }}
            >
              {Array.from({ length: 15 }, (_, i) => 60 + i * 30).map((m) => (
                <option value={m} key={m}>
                  {m / 60} hours
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Materials allowance (£)
            <input
              type="number"
              min="0"
              max="5000"
              step="0.01"
              value={materials}
              onChange={(e) =>
                setMaterials(
                  Math.max(0, Math.min(5000, Number(e.target.value) || 0))
                )
              }
            />
          </label>
          <label className={styles.field}>
            Full address
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
            />
          </label>
          <label className={styles.field}>
            Job photos (optional, up to 8)
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              onChange={(e) =>
                setPhotos(Array.from(e.target.files ?? []).slice(0, 8))
              }
            />
          </label>
        </div>
        <label className={styles.field} style={{ marginTop: 16 }}>
          Describe the job
          <textarea
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell your professional what needs doing and what to bring."
          />
        </label>
        <p className={styles.muted}>
          One-hour minimum. Choose a time in the next six days with at least two
          hours notice. Gas, electrical, structural and other regulated work are
          excluded. Unused held funds are released; materials are charged only
          with receipts you approve.
        </p>
        <button
          className={styles.button}
          disabled={busy}
          onClick={() => void search()}
        >
          Find available professionals
        </button>
      </section>
      {error && (
        <p className={styles.error} role="alert">
          {error} <Link href="/login?next=/handyman">Sign in</Link>
        </p>
      )}
      {searched && (
        <section className={styles.card}>
          <h2>Choose your professional</h2>
          {!offers.length && (
            <p className={styles.muted}>
              No approved professionals are free for this task and time. Try
              another time.
            </p>
          )}
          <div className={styles.grid}>
            {offers.map((p) => (
              <article className={styles.offer} key={p.id}>
                {p.photo_url && (
                  <Image
                    className={styles.photo}
                    src={p.photo_url}
                    width={58}
                    height={58}
                    alt={p.display_name}
                    unoptimized
                  />
                )}
                <label>
                  <input
                    type="radio"
                    name="professional"
                    checked={selected === p.id}
                    onChange={() => setSelected(p.id)}
                  />{' '}
                  <strong>{p.display_name}</strong>
                </label>
                <span className={styles.money}>
                  {money(p.hourlyRatePence)}/hr{p.vatBps ? ' + VAT' : ''}
                </span>
                <span>
                  {p.rating === null
                    ? 'No ratings yet'
                    : p.rating.toFixed(1) +
                      ' ★ · ' +
                      p.ratingCount +
                      ' reviews'}{' '}
                  · {p.completedJobs} completed jobs
                </span>
                <span className={styles.muted}>
                  {p.bio ?? 'Approved professional'} ·{' '}
                  {p.equipment
                    ? 'Brings equipment'
                    : 'Agree equipment needs before the visit'}
                </span>
                {p.years_experience !== null && (
                  <span>{p.years_experience} years of experience</span>
                )}
                {p.publicReviews.length > 0 && (
                  <details>
                    <summary>Public customer reviews</summary>
                    {p.publicReviews.map((r, i) => (
                      <div key={i}>
                        <p>
                          <strong>{r.rating} stars</strong> · Verified customer
                          ·{' '}
                          {new Date(r.reviewed_at).toLocaleDateString('en-GB')}
                        </p>
                        <p className={styles.muted}>{r.comment}</p>
                      </div>
                    ))}
                  </details>
                )}
              </article>
            ))}
          </div>
          {bill && (
            <>
              <div className={styles.bill}>
                <div>
                  <span>Estimated labour</span>
                  <strong>{money(bill.labour)}</strong>
                </div>
                <div>
                  <span>VAT</span>
                  <strong>{money(bill.vat)}</strong>
                </div>
                <div>
                  <span>Materials allowance</span>
                  <strong>{money(bill.materials)}</strong>
                </div>
                <div>
                  <span>Card hold</span>
                  <strong>{money(bill.gross)}</strong>
                </div>
              </div>
              <p className={styles.muted}>
                The final bill uses worked minutes, with a one-hour minimum.
                Extra time or materials above the hold require your revised
                authorisation.
              </p>
              <button
                className={styles.button}
                disabled={busy}
                onClick={() => void book()}
              >
                Continue to card authorisation
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
}
