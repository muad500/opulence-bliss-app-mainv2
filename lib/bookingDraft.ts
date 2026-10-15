import { isBookingFrequency, type BookingFrequency } from "./bookingPolicy";
import { validCleaningDuration } from "./cleaningBooking";
import { parseCleaningHome, type CleaningHome } from "./cleaningHome";
import { parseCleaningExtras, type VisitExtras } from "./cleaningExtras";

const STORAGE_KEY = "opulence-booking-sign-in-draft";
export const BOOKING_DRAFT_MAX_AGE = 2 * 60 * 60 * 1000;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BookingDraft = {
  packageId: string;
  postcode: string;
  address: string;
  home: CleaningHome;
  frequency: BookingFrequency;
  regularVisits: number;
  cleaningMinutes: number;
  extras: VisitExtras;
  visitOverrides: Record<number, VisitExtras>;
  petsAtHome: boolean;
  slot: string;
  optionalSlots: string[];
  request: string;
  promo: string;
  preferredCleaner: string;
  phone: string;
};

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isTime(value: unknown): value is string {
  return isText(value, 40) && Number.isFinite(Date.parse(value));
}

function extras(value: unknown): VisitExtras {
  if (!value || typeof value !== "object") throw new Error("Invalid add-ons");
  const choice = value as VisitExtras;
  const parsed = parseCleaningExtras(choice.addons, choice.bringsProducts);
  return {
    addons: parsed.addons.map((addon) => addon.id),
    bringsProducts: parsed.bringsProducts,
  };
}

/** Persist choices only: prices, saved-card consent and legal consent are not saved. */
function parseDraft(value: unknown): BookingDraft | null {
  if (!value || typeof value !== "object") return null;
  const data = value as BookingDraft;
  const home = parseCleaningHome(data.home);
  if (
    !isText(data.packageId, 128) ||
    !data.packageId ||
    !isText(data.postcode, 16) ||
    !data.postcode.trim() ||
    !isText(data.address, 1000) ||
    data.address.trim().length < 5 ||
    !home ||
    !isBookingFrequency(data.frequency) ||
    !Number.isInteger(data.regularVisits) ||
    data.regularVisits < 6 ||
    data.regularVisits > 10 ||
    !validCleaningDuration(data.cleaningMinutes) ||
    typeof data.petsAtHome !== "boolean" ||
    !isTime(data.slot) ||
    !Array.isArray(data.optionalSlots) ||
    !data.optionalSlots.every(isTime) ||
    !isText(data.request, 5000) ||
    !isText(data.promo, 100) ||
    !isText(data.preferredCleaner, 128) ||
    !isText(data.phone, 40) ||
    !data.visitOverrides ||
    typeof data.visitOverrides !== "object" ||
    Array.isArray(data.visitOverrides)
  )
    return null;
  try {
    const visitOverrides: Record<number, VisitExtras> = {};
    for (const [index, choice] of Object.entries(data.visitOverrides)) {
      if (!/^\d$/.test(index) || Number(index) >= data.regularVisits)
        return null;
      visitOverrides[Number(index)] = extras(choice);
    }
    return {
      packageId: data.packageId,
      postcode: data.postcode,
      address: data.address,
      home,
      frequency: data.frequency,
      regularVisits: data.regularVisits,
      cleaningMinutes: data.cleaningMinutes,
      extras: extras(data.extras),
      visitOverrides,
      petsAtHome: data.petsAtHome,
      slot: data.slot,
      optionalSlots: [...new Set(data.optionalSlots)].filter(
        (time) => time !== data.slot,
      ),
      request: data.request,
      promo: data.promo,
      preferredCleaner: data.preferredCleaner,
      phone: data.phone,
    };
  } catch {
    return null;
  }
}

export function saveBookingDraft(
  storage: DraftStorage,
  draft: BookingDraft,
  now = Date.now(),
  token = crypto.randomUUID(),
): string | null {
  try {
    const data = parseDraft(draft);
    if (!data) return null;
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, token, savedAt: now, data }),
    );
    return `/book?resume=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

/** The opaque URL token never contains the address, requests or other personal details. */
export function readBookingDraft(
  storage: DraftStorage,
  token: string,
  now = Date.now(),
) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 1_000_000) return null;
    const saved = JSON.parse(raw);
    if (saved.token !== token) return null;
    if (
      saved.version !== 1 ||
      !Number.isFinite(saved.savedAt) ||
      saved.savedAt > now ||
      now - saved.savedAt > BOOKING_DRAFT_MAX_AGE
    ) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    const draft = parseDraft(saved.data);
    if (!draft) storage.removeItem(STORAGE_KEY);
    return draft;
  } catch {
    return null;
  }
}

export function clearBookingDraft(storage: DraftStorage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}
