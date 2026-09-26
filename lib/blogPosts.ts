export type BlogSection = {
  heading: string;
  paragraphs: string[];
  points?: string[];
};

export type BlogPost = {
  slug: string;
  category: string;
  title: string;
  summary: string;
  published: string;
  publishedIso: string;
  readTime: string;
  accent: "purple" | "gold" | "pink";
  sections: BlogSection[];
};

export const blogPosts: BlogPost[] = [
  {
    slug: "cancellation-policy-explained",
    category: "Booking guide",
    title: "Our cancellation policy, explained",
    summary:
      "Know exactly what is refunded when plans change before your home visit.",
    published: "8 September 2026",
    publishedIso: "2026-09-08",
    readTime: "2 min read",
    accent: "pink",
    sections: [
      {
        heading: "The refund depends on when you cancel",
        paragraphs: [
          "We calculate the cancellation window from the moment you confirm cancellation to the scheduled start time of your booking.",
        ],
        points: [
          "More than 48 hours before the booking: normally no cancellation charge and a full refund.",
          "From 24 to 48 hours before the booking: up to a 25% cancellation charge.",
          "Less than 24 hours before the booking: up to a 50% cancellation charge.",
          "Same-day cancellation, no access or a missed appointment: up to a 100% cancellation charge.",
        ],
      },
      {
        heading: "What happens to a card hold",
        paragraphs: [
          "For a normal one-off visit, your card is authorised when you book and is usually charged after the work is complete. If you cancel, we release the refundable part of that hold and charge only the cancellation amount that applies. If the payment was already captured, the eligible refund is sent back through Stripe.",
          "Banks can take a few working days to remove a released hold or show a refund on your statement.",
        ],
      },
      {
        heading: "You will see the amount before confirming",
        paragraphs: [
          "Open the visit in My bookings and choose Cancel booking. The confirmation window shows the exact refund and cancellation charge before you confirm. The policy tier is recorded with the cancellation for a clear payment history.",
        ],
      },
    ],
  },
  {
    slug: "how-many-cleaning-hours-do-i-need",
    category: "Cleaning guide",
    title: "How many cleaning hours does your home need?",
    summary:
      "Compare our nine cleaning sessions and choose enough time for a calm, thorough visit.",
    published: "13 September 2026",
    publishedIso: "2026-09-13",
    readTime: "7 min read",
    accent: "purple",
    sections: [
      {
        heading: "Choose the cleaning session that fits",
        paragraphs: [
          "Every cleaning session can be booked for two to eight hours in 30-minute steps. The price scales with the time you choose, and the booking form shows the full total before payment.",
        ],
        points: [
          "Essential Clean — £18.90 per hour for six weekly or monthly visits booked and paid together. Our regular standard clean covers dusting, floors, bedroom, kitchen and bathroom.",
          "One-Time Essential Clean — £22.99 per hour. A single standard clean with no ongoing commitment, perfect for a one-off refresh.",
          "Express Clean — £22.90 per hour. A same-day standard clean for when time is tight, subject to available cleaners and time slots.",
          "Signature Deep Clean — £24.90 per hour. A thorough, top-to-bottom clean that reaches the spots regular cleaning misses, ideal for a seasonal reset or before hosting.",
          "End of Tenancy / Move-In Clean — £25 per hour. A detailed deep clean that leaves a property spotless for moving out or moving in.",
          "Guest Ready — £22.90 per hour. Fast-turnaround cleaning between guests, tailored for Airbnb and holiday-rental hosts.",
          "Linen Care — £16.90 per hour. Ironing and laundry service to keep linens and clothing fresh, crisp and ready to use.",
          "Window Cleaning — £16.90 per hour. Interior and exterior window cleaning for a streak-free shine, available alone or added to a clean.",
          "Essential Clean and Linen Care — £23.90 per hour. Regular dusting, floors, kitchen and bathroom cleaning combined with ironing and laundry care.",
        ],
      },
      {
        heading: "Choose the time your home needs",
        paragraphs: [
          "After choosing a cleaning session, select the number of hours that suits the condition of your home and your priorities.",
          "Our cleaning visits run from two to eight hours in 30-minute steps, so you can choose a clear finish time without guessing at odd intervals.",
        ],
      },
      {
        heading: "Allow more time for the first clean",
        paragraphs: [
          "A first visit often needs longer because your professional is learning the layout and bringing the home up to the standard you want. Kitchens, bathrooms, pet hair and built-up dust can all add time.",
        ],
        points: [
          "Add time when several bathrooms need a deep clean.",
          "Mention pet hair, heavy limescale or areas that need extra attention.",
          "Choose your must-do rooms if the whole list may not fit into one visit.",
        ],
      },
      {
        heading: "Share your priorities before the visit",
        paragraphs: [
          "Use the special instructions box to explain what matters most. Once a professional accepts your booking, the booking chat also lets you send a message or photo. Clear priorities help them use the booked time well.",
          "For regular visits, you can adjust the duration as you learn what works for your home, and returning customers can request a professional they have worked with before.",
        ],
      },
    ],
  },
  {
    slug: "prepare-your-home-for-a-cleaner",
    category: "Before your visit",
    title: "Five simple ways to prepare for your cleaner",
    summary:
      "Small steps before the doorbell rings help your professional spend more time cleaning.",
    published: "8 September 2026",
    publishedIso: "2026-09-08",
    readTime: "3 min read",
    accent: "gold",
    sections: [
      {
        heading: "Make the booked time count",
        paragraphs: [
          "You do not need to clean before your cleaner arrives. A few minutes of preparation simply removes obstacles and makes your priorities obvious.",
        ],
        points: [
          "Put away loose clothes, toys and paperwork where possible.",
          "Leave clear access instructions, including entry codes or concierge details.",
          "Keep pets comfortable in a separate room if they may be anxious.",
          "Point out delicate surfaces or products that should not be used.",
          "List your top priorities in the booking instructions.",
        ],
      },
      {
        heading: "Use the booking chat",
        paragraphs: [
          "After your booking is matched, you can message your professional directly about arrival details or send a photo of an area that needs attention. Keep the conversation focused on the visit so the useful details are easy to find.",
        ],
      },
      {
        heading: "Check in after the visit",
        paragraphs: [
          "Your feedback helps your professional understand your preferences next time. If you enjoyed the visit, your account makes it easy to request the same person again when they are available.",
        ],
      },
    ],
  },
];

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}
