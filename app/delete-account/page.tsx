import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import styles from "../legal/[slug]/page.module.css";

export const metadata: Metadata = {
  title: "Delete your account · Opulence Bliss",
  description:
    "Request deletion of your Opulence Bliss account and personal data, online or by email.",
  alternates: { canonical: "/delete-account" },
};

export default function DeleteAccountPage() {
  return (
    <>
      <main className={styles.shell}>
        <article className={styles.document}>
          <p className={styles.eyebrow}>Opulence Bliss · Your account</p>
          <h1>Delete your account</h1>
          <div className={styles.content}>
            <p>
              You can request deletion of your Opulence Bliss account and
              associated personal data whether you use our website, customer app
              or professional app.
            </p>
            <h2>Request from your account settings</h2>
            <ol>
              <li>Sign in to your Opulence Bliss account.</li>
              <li>
                For customers, open{" "}
                <Link href="/account/profile#privacy">
                  Account → Profile → Privacy → Delete my account
                </Link>
                . For professionals, open{" "}
                <Link href="/worker/profile#legal">
                  Profile → Legal and account → Delete my account
                </Link>
                .
              </li>
              <li>
                Read the information, type the confirmation requested on screen
                and send your deletion request.
              </li>
            </ol>
            <h2>Request by email — no sign-in needed</h2>
            <p>
              Email{" "}
              <a href="mailto:hello@opulencebliss.com?subject=Delete%20my%20Opulence%20Bliss%20account">
                hello@opulencebliss.com
              </a>{" "}
              with the subject “Delete my Opulence Bliss account”. Tell us the
              email address used for your account and that you want the account
              and associated personal data deleted. Please do not send a
              password, card details or identity documents by email.
            </p>
            <h2>What happens next</h2>
            <p>
              This is a reviewed deletion request, not instant deletion. We may
              need to verify that the account is yours. We review active
              bookings, outstanding payments, refunds, payouts and unresolved
              cases before completing it, and explain anything that needs to be
              resolved. Requesting deletion does not cancel a booking or settle
              an outstanding payment.
            </p>
            <p>
              Once deletion is completed, you can no longer sign in. Personal
              profile details, saved addresses, preferences and information we
              no longer need are removed or anonymised. Professional profiles
              are taken out of public listings, and personal profile or
              verification uploads covered by the deletion are removed.
            </p>
            <h2>Information we may need to keep</h2>
            <ul>
              <li>
                <strong>
                  Booking, invoice, payment, refund and payout records:
                </strong>{" "}
                for accounting, tax, financial record-keeping and unresolved
                transactions. Stripe holds payment card and bank information;
                those financial records are subject to its retention obligations
                too.
              </li>
              <li>
                <strong>
                  Accepted agreements, reviews, conversation and case records:
                </strong>{" "}
                where needed to handle complaints, investigate safety or fraud
                concerns, or establish or defend legal claims.
              </li>
              <li>
                <strong>
                  A minimal deletion record and non-identifying account
                  reference:
                </strong>{" "}
                to record the request and keep retained transaction records
                consistent.
              </li>
            </ul>
            <p>
              Retained information is kept only for the relevant legal or
              documented operational purpose, with restricted access. The period
              depends on the record and reason; we explain what must be kept and
              why when responding to your request. Information is removed or
              anonymised when it is no longer needed. Deletion does not require
              us to remove another person’s records where we have a lawful
              reason to retain them.
            </p>
            <p>
              See our <Link href="/legal/privacy">Privacy Policy</Link> or
              contact{" "}
              <a href="mailto:hello@opulencebliss.com">
                hello@opulencebliss.com
              </a>{" "}
              if you need help with your request.
            </p>
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
