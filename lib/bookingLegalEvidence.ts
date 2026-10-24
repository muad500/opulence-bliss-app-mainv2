import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { EARLY_START_REQUEST_TEXT } from "./cancellationPeriod";
import {
  checkoutLegalConsentText,
  SAVED_CARD_CONSENT_TEXT,
  type CheckoutLegalDocument,
  type CheckoutLegalSlug,
} from "./checkoutLegal";

export type BookingLegalSnapshot = {
  slug: CheckoutLegalSlug;
  title: string;
  version: string;
  updatedAt: string | null;
  isFallback: boolean;
  sourceContentHtml: string;
  contentHash: string;
  contentHtml: string;
  displayContentHash: string;
};
export type BookingLegalEvidence = {
  schemaVersion: 1;
  account?: { userId: string; name: string | null; email: string };
  request: { ip: string | null; userAgent: string | null };
  checkboxes: Array<{ key: string; text: string; checked: true }>;
};
export type BookingLegalContract = {
  id: string;
  acceptedAt: string;
  documents: BookingLegalSnapshot[];
  evidence: BookingLegalEvidence;
  bookings: Array<{ id: string; service: string; scheduledAt: string }>;
};

export function legalContentHash(html: string) {
  return createHash("md5").update(html).digest("hex");
}

export function bookingLegalEvidence(
  documents: CheckoutLegalDocument[],
  headers: Headers,
  options: { earlyStart: boolean; savedCard: boolean; vercel: boolean },
): BookingLegalEvidence {
  // Only Vercel's overwritten forwarding header is treated as an IP source.
  // Never accept the IP or checkbox wording from the submitted JSON body.
  const forwarded = options.vercel
    ? headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    : null;
  const checkboxes: BookingLegalEvidence["checkboxes"] = [
    {
      key: "booking_policies",
      text: checkoutLegalConsentText(documents),
      checked: true,
    },
  ];
  if (options.earlyStart)
    checkboxes.push({
      key: "early_start",
      text: EARLY_START_REQUEST_TEXT,
      checked: true,
    });
  if (options.savedCard)
    checkboxes.push({
      key: "saved_card",
      text: SAVED_CARD_CONSENT_TEXT,
      checked: true,
    });
  return {
    schemaVersion: 1,
    request: {
      ip: forwarded && isIP(forwarded) ? forwarded : null,
      userAgent:
        headers
          .get("user-agent")
          ?.replace(/[\r\n\u0000]/g, " ")
          .slice(0, 1000) || null,
    },
    checkboxes,
  };
}
