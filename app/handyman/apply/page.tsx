'use client';
import Link from 'next/link';
import { useState } from 'react';
import { HANDYMAN_TASKS } from '@/lib/handymanMarketplace';
import { PROVIDER_RESIDENT_STATUSES } from '@/lib/providerOnboarding';
import styles from '../marketplace.module.css';
export default function Page() {
  const [legalName, setLegalName] = useState(''),
    [displayName, setDisplayName] = useState(''),
    [homePostcode, setHomePostcode] = useState(''),
    [birth, setBirth] = useState(''),
    [resident, setResident] = useState(''),
    [selfEmployed, setSelfEmployed] = useState(false),
    [bio, setBio] = useState(''),
    [experience, setExperience] = useState(0),
    [coverage, setCoverage] = useState(''),
    [travel, setTravel] = useState(10),
    [daily, setDaily] = useState(8),
    [sameDay, setSameDay] = useState(true),
    [equipment, setEquipment] = useState(false),
    [rates, setRates] = useState<Record<string, string>>({}),
    [hours, setHours] = useState<
      Record<number, { start: string; end: string }>
    >({
      1: { start: '09:00', end: '17:00' },
      2: { start: '09:00', end: '17:00' },
      3: { start: '09:00', end: '17:00' },
      4: { start: '09:00', end: '17:00' },
      5: { start: '09:00', end: '17:00' }
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/handyman/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legalName,
            homePostcode: homePostcode.trim().toUpperCase(),
            displayName,
            bio,
            dateOfBirth: birth,
            residentStatus: resident,
            selfEmployed,
            yearsExperience: experience,
            coveragePostcodes: coverage
              .split(',')
              .map((x) => x.trim().toUpperCase())
              .filter(Boolean),
            maxTravelMiles: travel,
            maxDailyHours: daily,
            acceptsSameDay: sameDay,
            bringsEquipment: equipment,
            rates: Object.fromEntries(
              Object.entries(rates)
                .filter(([, v]) => v !== '')
                .map(([k, v]) => [k, Math.round(Number(v) * 100)])
            ),
            availability: Object.entries(hours).map(([day, h]) => ({
              weekday: Number(day),
              ...h
            }))
          })
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      window.location.assign(d.next);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Application could not be saved.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <nav className={styles.nav}>
          <Link href="/handyman">Handyman marketplace</Link>
          <Link href="/handyman/jobs">My jobs</Link>
        </nav>
        <h1>Offer your trade</h1>
        <p>
          Set your own tasks and rates. We review right to work, DBS, ID and
          public liability insurance before customers can book you.
        </p>
      </div>
      <section className={styles.card}>
        <h2>Your professional details</h2>
        <div className={styles.grid}>
          <label className={styles.field}>
            Full legal name (private)
            <input
              value={legalName}
              maxLength={160}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            Display name
            <input
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Amina K."
            />
          </label>
          <label className={styles.field}>
            Home postcode (private)
            <input
              value={homePostcode}
              onChange={(e) => setHomePostcode(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            Date of birth (private, 18+)
            <input
              type="date"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            UK resident status
            <select
              value={resident}
              onChange={(e) => setResident(e.target.value)}
            >
              <option value="">Choose your status</option>
              {PROVIDER_RESIDENT_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Years of experience
            <input
              type="number"
              min="0"
              max="60"
              value={experience}
              onChange={(e) => setExperience(Number(e.target.value))}
            />
          </label>
        </div>
        <label className={styles.field} style={{ marginTop: 16 }}>
          Short bio
          <textarea
            value={bio}
            maxLength={1200}
            onChange={(e) => setBio(e.target.value)}
          />
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={selfEmployed}
            onChange={(e) => setSelfEmployed(e.target.checked)}
          />
          I work on a self-employed basis.
        </label>
      </section>
      <section className={styles.card}>
        <h2>Tasks and your hourly rates</h2>
        <p className={styles.muted}>
          Enter a rate for each task you offer. Leave others blank. Rates
          exclude VAT; add your VAT number in My profile if registered.
          Regulated work is excluded, so trade certificates are optional for
          these tasks.
        </p>
        <div className={styles.grid}>
          {HANDYMAN_TASKS.map((t) => (
            <label className={styles.field} key={t}>
              {t} (£/hr)
              <input
                type="number"
                min="1"
                max="1000"
                step="0.01"
                value={rates[t] ?? ''}
                onChange={(e) => setRates({ ...rates, [t]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </section>
      <section className={styles.card}>
        <h2>Areas and availability</h2>
        <div className={styles.grid}>
          <label className={styles.field}>
            Postcodes or districts you cover
            <input
              value={coverage}
              onChange={(e) => setCoverage(e.target.value)}
              placeholder="SW3, SW1, W1"
            />
          </label>
          <label className={styles.field}>
            Maximum travel (miles)
            <input
              type="number"
              min="0"
              max="100"
              value={travel}
              onChange={(e) => setTravel(Number(e.target.value))}
            />
          </label>
          <label className={styles.field}>
            Maximum hours per day
            <input
              type="number"
              min="1"
              max="16"
              value={daily}
              onChange={(e) => setDaily(Number(e.target.value))}
            />
          </label>
        </div>
        <p className={styles.muted}>
          Choose working days and hours in London time. Keep your selected
          districts within the distance you are prepared to travel.
        </p>
        <div className={styles.availability}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
            <div key={day} className={styles.period}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={!!hours[i]}
                  onChange={(e) => {
                    const next = { ...hours };
                    if (e.target.checked)
                      next[i] = { start: '09:00', end: '17:00' };
                    else delete next[i];
                    setHours(next);
                  }}
                />
                {day}
              </label>
              {hours[i] && (
                <>
                  <input
                    aria-label={day + ' start'}
                    type="time"
                    min="07:00"
                    max="20:00"
                    value={hours[i].start}
                    onChange={(e) =>
                      setHours({
                        ...hours,
                        [i]: { ...hours[i], start: e.target.value }
                      })
                    }
                  />
                  <input
                    aria-label={day + ' end'}
                    type="time"
                    min="07:00"
                    max="20:00"
                    value={hours[i].end}
                    onChange={(e) =>
                      setHours({
                        ...hours,
                        [i]: { ...hours[i], end: e.target.value }
                      })
                    }
                  />
                </>
              )}
            </div>
          ))}
        </div>
        <div className={styles.actions}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={sameDay}
              onChange={(e) => setSameDay(e.target.checked)}
            />
            Consider same-day bookings
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={equipment}
              onChange={(e) => setEquipment(e.target.checked)}
            />
            I bring my own equipment
          </label>
        </div>
      </section>
      <section className={styles.card}>
        <h2>Next: private verification</h2>
        <p className={styles.muted}>
          After saving, upload your DBS certificate, photo ID and public
          liability insurance in My profile, and provide a right-to-work share
          code or visa evidence. An administrator must complete the checks and
          approval. Bank details stay with Stripe Connect. Adding a trade
          requires fresh approval of your professional account.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error} <Link href="/login?next=/handyman/apply">Sign in</Link>
          </p>
        )}
        <button
          className={styles.button}
          disabled={busy}
          onClick={() => void submit()}
        >
          Save application and continue verification
        </button>
      </section>
    </main>
  );
}
