export const FAQ_CATEGORIES = [
  "general",
  "cleaning",
  "handyman",
  "booking_pricing",
  "appointments",
  "quality",
  "preparation_coverage",
] as const;

export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

export const FAQ_CATEGORY_LABELS: Record<FaqCategory, string> = {
  general: "General",
  cleaning: "Cleaning",
  handyman: "Property maintenance",
  booking_pricing: "Booking & pricing",
  appointments: "Appointments, changes & cancellations",
  quality: "Service quality & professionals",
  preparation_coverage: "Preparing & coverage",
};

export type FaqRow = {
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
  published: boolean;
  sort_order: number;
  created_at?: string;
};

export function isFaqCategory(value: string): value is FaqCategory {
  return FAQ_CATEGORIES.includes(value as FaqCategory);
}
