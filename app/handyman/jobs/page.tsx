'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { HandymanJob } from '@/lib/handymanServer';
import styles from '../marketplace.module.css';
export default function Page() {
  const [jobs, setJobs] = useState<HandymanJob[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void fetch('/api/handyman/jobs')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setJobs(d.jobs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <nav className={styles.nav}>
          <Link href="/handyman">Book a handyman</Link>
          <Link href="/handyman/apply">Offer a trade</Link>
          <Link href="/worker">Professional dashboard</Link>
        </nav>
        <h1>My handyman jobs</h1>
        <p>Your customer bookings and professional jobs appear here.</p>
      </div>
      {loading && <p>Loading…</p>}
      {error && (
        <p className={styles.error}>
          {error} <Link href="/login?next=/handyman/jobs">Sign in</Link>
        </p>
      )}
      {!loading && !error && !jobs.length && (
        <section className={styles.card}>
          <h2>No jobs yet</h2>
          <p>Book a professional or apply to offer your services.</p>
        </section>
      )}
      {jobs.map((j) => (
        <Link
          href={'/handyman/jobs/' + j.id}
          className={styles.card + ' ' + styles.job}
          key={j.id}
        >
          <strong>{j.task_name}</strong>
          <p>
            {new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Europe/London',
              dateStyle: 'medium',
              timeStyle: 'short'
            }).format(new Date(j.scheduled_at))}{' '}
            · London time
          </p>
          <span className={styles.status}>{j.status.replaceAll('_', ' ')}</span>
          <p>
            {j.postcode} · £{(j.hourly_rate_pence / 100).toFixed(2)}/hr
            {j.vat_bps ? ' + VAT' : ''}
          </p>
        </Link>
      ))}
    </main>
  );
}
