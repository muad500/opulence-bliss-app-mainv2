// Build the AI agent's knowledge base.
// Save at: app/api/ai/seed/route.ts
//
// Run once (and again whenever prices or policies change):
//   GET http://localhost:3000/api/ai/seed?key=YOUR_CRON_SECRET
//
// Add to .env.local:  GEMINI_API_KEY=your-key-from-aistudio.google.com

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 768; // matches the vector(768) column

async function embed(text: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBED_DIMS,
      }),
    }
  );
  if (!res.ok) throw new Error(`Embedding failed: ${await res.text()}`);
  const json = await res.json();
  return json?.embedding?.values as number[];
}

const DOCS: { title: string; content: string }[] = [
  {
    title: "Where to find things on the site",
    content:
      "Use these pages: /book to see all cleaning services in full detail and make a booking. /providers to see our vetted cleaners and their ratings. /account for your bookings, to cancel, reschedule, rate a visit or add a tip. /account/profile to save your name, phone, address and default postcode. /notifications for updates on your bookings. /provider/join to sign up as a cleaner. /login to sign in. Cleaners manage jobs at /worker, hours at /worker/availability, and pay at /worker/earnings.",
  },
  {
    title: "What Opulence Bliss is",
    content:
      "Opulence Bliss is a premium pay-per-visit home-cleaning marketplace in London. A cleaner must complete the application, DBS review and administrator approval before receiving new work. Customers choose a cleaning session, frequency preference, duration, date and time, then pay securely for that visit.",
  },
  {
    title: "How booking works",
    content:
      "Booking takes four steps: choose your service, enter your postcode so we can check we cover you, pick a time from the slots our providers actually have free, then confirm and pay. You must be logged in to book. Bookings need at least two hours' notice. Once you book, matching providers are asked one at a time until somebody accepts, and you'll be notified as soon as one is confirmed.",
  },
  {
    title: "Where we cover",
    content:
      "We cover London, including Central, North, South, East and West London and outer London boroughs. Check the customer postcode with the live coverage tool or booking form. Coverage does not mean a professional is already assigned; matching happens after booking.",
  },
  {
    title: "How payment works",
    content:
      "When you book, your card is authorised but NOT charged — we place a hold to secure the booking. You are only charged after the visit is complete, when your provider checks out. If no provider accepts your booking, it is cancelled automatically and the hold is released, so you pay nothing. All card details are handled by Stripe; Opulence Bliss never stores your card number.",
  },
  {
    title: "Cancelling and rescheduling",
    content:
      "You can cancel or modify a visit from My bookings in your account or ask the assistant to prepare a time change. The assistant always shows a confirmation button before changing anything. A new time must meet the permitted appointment window. Under the cancellation policy, more than 48 hours' notice normally has no cancellation charge; 24 to 48 hours may incur up to 25%; less than 24 hours may incur up to 50%; and a same-day cancellation, no-access visit or missed appointment may incur up to 100%. The cancellation screen shows the exact amount before confirmation. Every modification keeps its audited history and the customer, provider and admin schedule are updated.",
  },
  {
    title: "Tipping",
    content:
      "Tipping is optional. After a completed visit you can add a tip of £3, £5 or £10 from your account or the rating pop-up. One hundred per cent of any tip goes to the provider who did the work — Opulence Bliss takes no cut of tips at all.",
  },
  {
    title: "Promo codes",
    content:
      "You can enter a promo code on the confirm step before paying, then press Apply to see the discount and your new total. Discounts come out of the Opulence Bliss platform margin, never out of the provider's pay. If a code is invalid, expired or fully redeemed, the form will tell you.",
  },
  {
    title: "Ratings and reviews",
    content:
      "After every completed visit both sides rate each other. Clients rate their provider out of five stars with an optional comment, and provider ratings are shown publicly on our professionals page. Providers also rate the client, and those client ratings are only visible to Opulence Bliss administrators.",
  },
  {
    title: "What happens on the day",
    content:
      "Your provider starts check-in near the service address. The platform checks their location and sends the customer a booking-specific six-digit code; the provider enters that code to begin the visit. The plaintext code is not stored. You can watch progress live in your account, including a timer once work starts. When the provider finishes they check out, which completes the job and captures the authorised payment. Both sides are then asked to rate the visit.",
  },
  {
    title: "How to prepare for a visit",
    content:
      "Someone needs to be able to let the cleaner in, or you can provide clear access instructions. Cleaners bring the products and equipment needed for the booked service. You can add requests such as access instructions, pets, delicate surfaces and priority rooms in the requests box when you book.",
  },
  {
    title: "Becoming a provider",
    content:
      "Home cleaners can join at the Work with us page without paying a joining fee. Sign up with your name, contact details and the areas you cover. The team reviews the application, and once approved you start receiving job offers matched to your area and availability.",
  },
  {
    title: "How providers get paid",
    content:
      "Providers see exactly what a job pays before they accept it. Payment is automatic: when the provider checks out of a completed visit, the client's card is charged and the provider's share is transferred to them by Stripe. Opulence Bliss keeps a platform margin from each visit. Tips are paid to the provider in full.",
  },
  {
    title: "Provider availability and offers",
    content:
      "Providers set the days and hours they work, and only those times appear as bookable slots to clients. A matching provider gets the offer first; if they decline or their response time ends, it moves automatically to the next provider. Each provider gets 60 minutes when a visit is at least a week away, 30 minutes when it is three to six days away, and 15 minutes when it is closer. If nobody accepts by two hours before the appointment, the booking is cancelled and the client is not charged.",
  },
  {
    title: "Getting help",
    content:
      "For a booking-specific problem, the assistant can prepare a request to the resolution desk and will submit it only after the customer confirms. A provider no-show can also be reported from the booking after the grace period. Complaints, damage, injury, safeguarding and payment disputes require a person to review the evidence; the assistant never decides fault, refunds or compensation. For immediate danger or a medical emergency call 999. Don't share card details or passwords in chat.",
  },
  {
    title: "What the assistant can do",
    content:
      "The Opulence Bliss assistant answers service, price, coverage, payment, provider and visit questions from the platform knowledge base. For signed-in customers it can read their own booking and payment status, find live availability, prepare a secure booking link, prepare a cancellation, prepare a reschedule and prepare a booking-help request. Cancellation, rescheduling and help requests always require a visible confirmation button. New bookings always finish on the secure Stripe review-and-pay page; the assistant never takes card details or charges invisibly. Providers can ask about their jobs, offers, earnings and availability, but check-in, check-out, accepting, declining and withdrawing stay in the dedicated worker screens.",
  },
  {
    title: "Booking messages and live updates",
    content:
      "Once a provider accepts a booking, the customer and provider can use its private message thread for arrival details, access instructions, delays, pets and other booking-related information. Messages are immutable and the thread closes seven days after the visit. Portal pages listen for booking notifications and refresh automatically, with focus and timed refreshes as a fallback.",
  },
];

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not set in .env.local" },
      { status: 500 }
    );
  }

  try {
    // Live prices, so the agent never quotes a stale figure.
    const { data: pkgs } = await admin
      .from("packages")
      .select("name, description, price, duration_minutes, service_type, billing_type, visits_per_month")
      .eq("active", true)
      .order("price");

    const perVisit = (pkgs ?? []).filter((p) => p.billing_type !== "monthly");
    const priceDoc = {
      title: "Services and current prices",
      content:
        "Single visits, charged per visit: " +
        perVisit
          .map(
            (p) => {
              const isCleaning = (p.service_type ?? "").toLowerCase().includes("clean");
              const duration = Number(p.duration_minutes ?? 120);
              const hourly = Number(p.price) * 60 / duration;
              return isCleaning
                ? `${p.name} — £${hourly.toFixed(2)} per cleaner-hour; cleaning bookings run from two to eight hours in 30-minute steps. ${p.description ?? ""}`
                : `${p.name} — £${Number(p.price).toFixed(0)} per visit${
                    p.duration_minutes ? `, ${p.duration_minutes} minutes` : ""
                  } (${p.service_type ?? "service"}). ${p.description ?? ""}`;
            }
          )
          .join(" ") +
        " Book and pay per visit at /book. Memberships are not offered.",
    };

    const all = [priceDoc, ...DOCS];

    // Rebuild from scratch
    await admin
      .from("ai_docs")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    for (const doc of all) {
      const vector = await embed(`${doc.title}. ${doc.content}`);
      await admin.from("ai_docs").insert({
        title: doc.title,
        content: doc.content,
        embedding: vector,
      });
    }

    return NextResponse.json({ ok: true, documents: all.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Seeding failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
