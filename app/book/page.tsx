"use client";
import { DEFAULT_CLEANING_BILLING_TERMS } from "@/lib/cleaningBillingTerms";
import { REFERRAL_SOURCES } from "@/lib/bookingPreferences";

// SETUP: mkdir -p "app/book" && code "app/book/page.tsx"
//
// Booking: Where → Session → Time → Confirm. One question per screen.

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CLEANING_DURATIONS,
  isCleaning,
  bookingPricePence,
  cleaningHourlyRatePence,
  compareCleaningSessions,
} from "@/lib/cleaningBooking";
import { bookingPolicyError } from "@/lib/bookingPolicy";
import {
  REGULAR_MAX_VISITS,
  REGULAR_MIN_VISITS,
  regularVisitSlots,
  type RegularFrequency,
} from "@/lib/regularBooking";
import {
  cleaningHomeLabel,
  parseCleaningHome,
  recommendedCleaningMinutesForHome,
  type PropertyType,
} from "@/lib/cleaningHome";
import AppointmentTimePicker from "@/components/AppointmentTimePicker";
import { isStoredUkPhone, isValidUkPhone } from "@/lib/ukPhone";
import {
  EARLY_START_REQUEST_TEXT,
  startsWithinCancellationPeriod,
} from "@/lib/cancellationPeriod";
import {
  assistantBookingHandoff,
  type AssistantPackage,
} from "@/lib/assistantBooking";
import { CANCELLATION_REFUND_URL } from "@/lib/legal";
import BookingLegalConsent, {
  type BookingLegalState,
} from "@/components/BookingLegalConsent";
import { visitDiscounts } from "@/lib/visitLineItems";
import CleaningPackageScope from "@/components/CleaningPackageScope";
import { cleaningPackageScope } from "@/lib/cleaningScope";

import CleaningExtrasPicker from "@/components/CleaningExtrasPicker";
import { cleaningSeriesQuote, type VisitExtras } from "@/lib/cleaningExtras";
import {
  clearBookingDraft,
  readBookingDraft,
  saveBookingDraft,
} from "@/lib/bookingDraft";
import { authLink } from "@/lib/authReturn";
import {
  ONE_OFF_PAYMENT_COPY,
  REGULAR_PAYMENT_COPY,
} from "@/lib/cleaningPaymentCopy";

const supabase = createClient();

type Pkg = {
  id: string;
  name: string;
  description: string | null;
  inclusions: string[] | null;
  good_to_know: string[] | null;
  price: number;
  service_type: string | null;
  duration_minutes: number | null;
};

type Area = { name: string; postcode_prefixes: string[] };
type SavedAddress = {
  accessInstructions?: string;
  id: string;
  label: string;
  isDefault: boolean;
  line1: string;
  line2: string;
  city: string;
  postcode: string;
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
};

const STEPS = ["Address", "Session", "Frequency", "Hours", "Time", "Confirm"];

type BookingFrequency = "one_time" | "weekly" | "fortnightly" | "monthly";

const FREQUENCIES: Array<{
  value: BookingFrequency;
  title: string;
  note: string;
}> = [
  { value: "one_time", title: "One time", note: "Just this visit" },
  {
    value: "weekly",
    title: "Every week",
    note: "6 to 10 weekly visits",
  },
  {
    value: "fortnightly",
    title: "Every two weeks",
    note: "6 to 10 visits, two weeks apart",
  },
  {
    value: "monthly",
    title: "Every month",
    note: "6 to 10 monthly visits",
  },
];

function frequencyLabel(value: BookingFrequency) {
  return FREQUENCIES.find((item) => item.value === value)?.title ?? "One time";
}

function outwardCode(pc: string) {
  const s = pc.toUpperCase().replace(/\s+/g, "");
  return s.length <= 4 ? s : s.slice(0, s.length - 3);
}

const money = (n: number) => "£" + Number(n).toFixed(2);
function dayLabel(iso: string) {
  const d = new Date(iso);
  const t = new Date();
  const tm = new Date();
  tm.setDate(t.getDate() + 1);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === tm.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
const fullLabel = (iso: string) => `${dayLabel(iso)}, ${timeLabel(iso)}`;

function duration(mins: number | null) {
  if (!mins) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h} hr${h > 1 ? "s" : ""}`;
  return `${m} min`;
}

export default function BookPage() {
  const [billingPrices, setBillingPrices] = useState(
    DEFAULT_CLEANING_BILLING_TERMS,
  );
  const [pricesReady, setPricesReady] = useState(false);
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [perVisitBilling, setPerVisitBilling] = useState(false);
  const [saveCardConsent, setSaveCardConsent] = useState(false);
  const [bookingLegal, setBookingLegal] = useState<BookingLegalState>({
    accepted: false,
    documents: null,
  });
  const [legalRefresh, setLegalRefresh] = useState(0);
  useEffect(() => {
    void fetch("/api/visit-billing-config", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!data.pricing) return;
        setBillingPrices({
          ...DEFAULT_CLEANING_BILLING_TERMS,
          ...data.pricing,
        });
        setPricesReady(true);
        setPerVisitBilling(data.perVisitBilling === true);
        setSmsAvailable(data.smsAvailable === true);
      })
      .catch(() => undefined);
  }, []);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [serviceType, setServiceType] = useState<string | null>("clean");

  const [step, setStep] = useState(0);
  const [postcode, setPostcode] = useState("");
  const [address, setAddress] = useState("");
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [savedAddressId, setSavedAddressId] = useState("");
  const [gate, setGate] = useState<null | { ok: boolean; area?: string }>(null);
  const [selected, setSelected] = useState<Pkg | null>(null);

  const [extras, setExtras] = useState<VisitExtras>({
    addons: [],
    bringsProducts: false,
  });
  const [visitOverrides, setVisitOverrides] = useState<
    Record<number, VisitExtras>
  >({});
  const [petsAtHome, setPetsAtHome] = useState<boolean | null>(null);
  const [cleaningMinutes, setCleaningMinutes] = useState(120);
  const [propertyType, setPropertyType] = useState<PropertyType | "">("");
  const [bedrooms, setBedrooms] = useState<number | "">("");
  const [bathrooms, setBathrooms] = useState<number | "">("");
  const [frequency, setFrequency] = useState<BookingFrequency>("weekly");
  const [regularVisits, setRegularVisits] =
    useState<number>(REGULAR_MIN_VISITS);
  const [previousCleaners, setPreviousCleaners] = useState<
    { provider_id: string; display_name: string }[]
  >([]);
  const [preferredCleaner, setPreferredCleaner] = useState("");
  const cleaning = isCleaning(selected?.service_type);
  const visitCount = frequency === "one_time" ? 1 : regularVisits;
  const visitExtras = Array.from(
    { length: visitCount },
    (_, index) => visitOverrides[index] ?? extras,
  );
  let quote: ReturnType<typeof cleaningSeriesQuote> | null = null;
  let extrasError: string | null = null;
  if (selected) {
    try {
      quote = cleaningSeriesQuote(
        selected,
        cleaningMinutes,
        extras.addons,
        extras.bringsProducts,
        visitCount,
        visitExtras,
        billingPrices,
      );
    } catch (cause) {
      extrasError =
        cause instanceof Error ? cause.message : "Check your add-ons.";
    }
  }
  const minutes = quote?.maxDurationMinutes ?? cleaningMinutes;
  const addressValid = address.trim().length >= 5;
  const home = parseCleaningHome({ propertyType, bedrooms, bathrooms });
  function applySavedAddress(place: SavedAddress) {
    setSavedAddressId(place.id);
    setAccessInstructions(place.accessInstructions ?? "");
    setAddress(
      [place.line1, place.line2, place.city].filter(Boolean).join(", "),
    );
    setPostcode(place.postcode);
    const kind = place.propertyType?.toLowerCase();
    setPropertyType(
      ["studio", "flat", "house", "other"].includes(kind)
        ? (kind as PropertyType)
        : "other",
    );
    setBedrooms(
      place.bedrooms != null && place.bedrooms <= 8 ? place.bedrooms : "",
    );
    setBathrooms(
      place.bathrooms != null && place.bathrooms >= 1 && place.bathrooms <= 8
        ? place.bathrooms
        : "",
    );
    setGate(null);
    setSlot(null);
    setOptionalSlots([]);
  }

  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [optionalSlots, setOptionalSlots] = useState<string[]>([]);
  const [scheduleNow, setScheduleNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = setInterval(() => setScheduleNow(Date.now()), 60_000);
    return () => clearInterval(clock);
  }, []);

  const [howHeard, setHowHeard] = useState("");
  const [confirmationChannel, setConfirmationChannel] = useState<
    "email" | "sms"
  >("email");
  const [roomsToClean, setRoomsToClean] = useState("");
  const [accessInstructions, setAccessInstructions] = useState("");
  const [request, setRequest] = useState("");
  const [promo, setPromo] = useState("");
  const [promoInfo, setPromoInfo] = useState<{
    ok: boolean;
    msg: string;
    discount?: number;
    total?: number;
  } | null>(null);

  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // null means the saved profile has not been checked yet.
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [earlyStartAgreed, setEarlyStartAgreed] = useState(false);
  // Set when the server says a request is needed, in case time moved on.
  const [earlyStartForced, setEarlyStartForced] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState<{
    packageId: string;
    postcode: string;
    minutes: number;
    slot: string;
    optional: string[];
  } | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  /* ---------- load ---------- */
  const loadingStarted = useRef(false);
  useEffect(() => {
    if (loadingStarted.current) return;
    loadingStarted.current = true;
    (async () => {
      const [{ data: pkgs }, { data: ars }] = await Promise.all([
        supabase
          .from("packages")
          .select("*")
          .eq("active", true)
          .eq("billing_type", "per_visit")
          .ilike("service_type", "%clean%")
          .order("price"),
        supabase
          .from("service_areas")
          .select("name, postcode_prefixes")
          .eq("active", true),
      ]);

      const list = ((pkgs ?? []) as Pkg[]).sort(compareCleaningSessions);
      const areaList = (ars ?? []) as Area[];
      setPackages(list);
      setAreas(areaList);
      const essential =
        list.find((item) => item.name === "Essential Clean") ?? list[0] ?? null;
      setSelected(essential);
      if (essential) {
        setCleaningMinutes(
          Math.min(480, Math.max(120, essential.duration_minutes ?? 120)),
        );
      }

      let savedPc: string | null = null;
      let savedAddress: string | null = null;
      let preferredCleanerIds = new Set<string>();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setSignedIn(!!user);
      if (user) {
        const { data: p } = await supabase
          .from("profiles")
          .select("role, postcode, address, phone")
          .eq("id", user.id)
          .maybeSingle();
        setRole(p?.role ?? null);
        setSavedPhone(p?.phone ?? "");
        const { data: cleaners } = await supabase.rpc("my_previous_cleaners");
        setPreviousCleaners(cleaners ?? []);
        const response = await fetch("/api/account/profile", {
          cache: "no-store",
        }).catch(() => null);
        if (response?.ok) {
          const account = await response
            .json()
            .catch(() => ({ addresses: [], favourites: [] }));
          const saved = (account.addresses ?? []) as SavedAddress[];
          setSavedAddresses(saved);
          const defaultPlace = saved.find((place) => place.isDefault);
          if (defaultPlace) {
            applySavedAddress(defaultPlace);
            savedPc = defaultPlace.postcode;
            savedAddress = [
              defaultPlace.line1,
              defaultPlace.line2,
              defaultPlace.city,
            ]
              .filter(Boolean)
              .join(", ");
          }
          const merged = new Map<
            string,
            { provider_id: string; display_name: string }
          >(
            (cleaners ?? []).map(
              (cleaner: { provider_id: string; display_name: string }) => [
                cleaner.provider_id,
                cleaner,
              ],
            ),
          );
          for (const favourite of account.favourites ?? [])
            merged.set(favourite.providerId, {
              provider_id: favourite.providerId,
              display_name: `${favourite.displayName} (favourite)`,
            });
          const options = Array.from(merged.values());
          preferredCleanerIds = new Set(
            options.map((cleaner) => cleaner.provider_id),
          );
          setPreviousCleaners(options);
          const requested = new URLSearchParams(window.location.search).get(
            "preferred",
          );
          if (
            requested &&
            options.some((cleaner) => cleaner.provider_id === requested)
          )
            setPreferredCleaner(requested);
        }
        if (p?.postcode && !savedPc) {
          savedPc = p.postcode;
          setPostcode(p.postcode);
        }
        if (p?.address && !savedAddress) {
          savedAddress = p.address;
          setAddress(p.address);
        }
      }

      const q = new URLSearchParams(window.location.search);
      const resumeToken = q.get("resume");
      if (resumeToken) {
        let draft: ReturnType<typeof readBookingDraft> = null;
        try {
          draft = readBookingDraft(window.sessionStorage, resumeToken);
        } catch {
          /* Storage may be disabled. */
        }
        if (draft) {
          // Restore after account defaults have loaded so they cannot overwrite the booking.
          setSavedAddressId("");
          setAddress(draft.address);
          setPostcode(draft.postcode);
          setPropertyType(draft.home.propertyType);
          setBedrooms(draft.home.bedrooms);
          setBathrooms(draft.home.bathrooms);
          setPetsAtHome(draft.petsAtHome);
          setFrequency(draft.frequency);
          setRegularVisits(draft.regularVisits);
          setCleaningMinutes(draft.cleaningMinutes);
          setExtras(draft.extras);
          setVisitOverrides(draft.visitOverrides);
          setRequest(draft.request);
          setHowHeard(draft.preferences?.howHeard ?? "");
          setConfirmationChannel(
            draft.preferences?.confirmationChannel ?? "email",
          );
          setRoomsToClean(draft.preferences?.roomsToClean ?? "");
          setAccessInstructions(draft.preferences?.accessInstructions ?? "");
          setPromo(draft.promo);
          setPhone(draft.phone);
          setPreferredCleaner(
            preferredCleanerIds.has(draft.preferredCleaner)
              ? draft.preferredCleaner
              : "",
          );
          const restoredPackage = list.find(
            (pkg) => pkg.id === draft.packageId,
          );
          const area = areaList.find((item) =>
            item.postcode_prefixes.includes(outwardCode(draft.postcode)),
          );
          setGate(area ? { ok: true, area: area.name } : { ok: false });
          let resumeStep = 0;
          let retryAvailability = false;
          let message =
            "Your booking details have been kept. Please check the service address.";
          if (area && !restoredPackage) {
            resumeStep = 1;
            message =
              "Your details have been kept. That package is no longer available; please choose another.";
          } else if (area && restoredPackage) {
            setSelected(restoredPackage);
            try {
              const policyError = bookingPolicyError(
                restoredPackage.name,
                draft.frequency,
              );
              if (policyError) throw new Error(policyError);
              const count =
                draft.frequency === "one_time" ? 1 : draft.regularVisits;
              const restoredQuote = cleaningSeriesQuote(
                restoredPackage,
                draft.cleaningMinutes,
                draft.extras.addons,
                draft.extras.bringsProducts,
                count,
                Array.from(
                  { length: count },
                  (_, index) => draft.visitOverrides[index] ?? draft.extras,
                ),
                billingPrices,
              );
              resumeStep = 4;
              const response = await fetch(
                `/api/slots?${new URLSearchParams({ postcode: draft.postcode, service: restoredPackage.service_type ?? "", duration: String(restoredQuote.maxDurationMinutes) })}`,
                { cache: "no-store" },
              );
              if (!response.ok)
                throw new Error(
                  "Your details are saved. Please check the available times again.",
                );
              const availability = await response.json();
              const available = new Set<string>(availability.slots ?? []);
              setSlots([...available]);
              const optional = draft.optionalSlots.filter((time) =>
                available.has(time),
              );
              setOptionalSlots(optional);
              if (available.has(draft.slot)) {
                setSlot(draft.slot);
                resumeStep =
                  optional.length === draft.optionalSlots.length ? 5 : 4;
                message =
                  resumeStep === 5
                    ? "Your booking details are ready. Review them below, then confirm your payment."
                    : "Your details and preferred time have been kept. Some optional times are no longer available; please review your times.";
              } else {
                setSlot(null);
                message =
                  "Your booking details have been kept. Your preferred time is no longer available; please choose another.";
              }
            } catch (cause) {
              if (resumeStep === 4) {
                retryAvailability = true;
                setSlots([]);
                message =
                  "Your details are saved. Reload this page to check the available times again.";
              } else {
                resumeStep = 3;
                message =
                  cause instanceof Error
                    ? cause.message
                    : "Your details have been kept. Please review your booking.";
              }
            }
          }
          setStep(resumeStep);
          setHandoffError(message);
          if (!retryAvailability) {
            clearBookingDraft(window.sessionStorage);
            q.delete("resume");
            window.history.replaceState(
              window.history.state,
              "",
              `/book${q.size ? `?${q}` : ""}`,
            );
          }
          setLoading(false);
          return;
        }
        setHandoffError(
          "Your saved booking has expired or is unavailable in this tab. Please check your booking details.",
        );
      }
      const wantPc = q.get("pc");
      const wantType = q.get("type");
      const wantService = q.get("service");
      const wantSlot = q.get("slot");
      const reviewHandoff = q.get("review") === "1";

      if (wantType === "clean") setServiceType("clean");
      if (wantPc) {
        setPostcode(wantPc);
        if (
          wantPc.replace(/\s/g, "").toUpperCase() !==
          savedPc?.replace(/\s/g, "").toUpperCase()
        )
          setSavedAddressId("");
      }

      // Already know where they live? Verify it quietly — no need to ask again.
      const pcToCheck = wantPc ?? savedPc;
      let covered = false;
      if (pcToCheck) {
        const hit = areaList.find((a) =>
          a.postcode_prefixes.includes(outwardCode(pcToCheck)),
        );
        covered = !!hit;
        setGate(hit ? { ok: true, area: hit.name } : { ok: false });
      }

      const match =
        (wantService ? list.find((p) => p.id === wantService) : undefined) ??
        essential;
      if (match) {
        setSelected(match);
        setFrequency(match.name === "Essential Clean" ? "weekly" : "one_time");
        setCleaningMinutes(
          Math.min(480, Math.max(120, match.duration_minutes ?? 120)),
        );
      }
      const hasAddress = (savedAddress ?? "").trim().length >= 5;

      // Carry the assistant's choices without skipping address or home details.
      // Prices, notice, frequency and every optional time are checked again.
      if (reviewHandoff && match && wantSlot && pcToCheck) {
        try {
          const draft = assistantBookingHandoff(match as AssistantPackage, {
            postcode: pcToCheck,
            slot: wantSlot,
            duration_minutes:
              q.get("duration") ?? match.duration_minutes ?? 120,
            frequency:
              q.get("frequency") ??
              (match.name === "Essential Clean" ? "weekly" : "one_time"),
            visits: q.get("visits") ?? 6,
            optional_slots: q.getAll("optional"),
          });
          if (!covered)
            throw new Error(
              "That postcode is not currently in our service area.",
            );
          setCleaningMinutes(draft.duration_minutes);
          setFrequency(draft.frequency as BookingFrequency);
          setRegularVisits(draft.visits > 1 ? draft.visits : 6);
          setSlot(draft.preferred_time);
          setOptionalSlots(draft.optional_times);
          setAssistantDraft({
            packageId: match.id,
            postcode: draft.postcode,
            minutes: draft.duration_minutes,
            slot: draft.preferred_time,
            optional: draft.optional_times,
          });
          if (
            wantPc &&
            wantPc.replace(/\s/g, "").toUpperCase() !==
              savedPc?.replace(/\s/g, "").toUpperCase()
          )
            setAddress("");
          setHandoffError(
            "Your booking draft is ready. Confirm the full address, then add or check your home details. Your chosen times will be kept.",
          );
          setStep(0);
        } catch (cause) {
          setSlot(null);
          setOptionalSlots([]);
          setStep(0);
          setHandoffError(
            cause instanceof Error
              ? cause.message
              : "Please choose your booking details again.",
          );
        }
      } else if (reviewHandoff) {
        setHandoffError(
          "That booking link is incomplete. Please ask the assistant to prepare it again.",
        );
        setStep(0);
      } else if (match && wantSlot && covered && hasAddress) {
        setSlot(wantSlot);
        setStep(match.name === "Essential Clean" ? 2 : 3);
      } else {
        // Every normal booking starts by confirming the service address.
        setStep(0);
      }

      setLoading(false);
    })();
  }, []);

  /* ---------- actions ---------- */
  function checkPostcode() {
    const hit = areas.find((a) =>
      a.postcode_prefixes.includes(outwardCode(postcode)),
    );
    if (hit) {
      setGate({ ok: true, area: hit.name });
    } else setGate({ ok: false });
  }

  async function loadSlots(
    pc: string,
    serviceType: string,
    durationMinutes: number | null = minutes,
  ) {
    setSlots(null);
    setSlot(null);
    setOptionalSlots([]);
    try {
      const res = await fetch(
        `/api/slots?postcode=${encodeURIComponent(pc)}&service=${encodeURIComponent(
          serviceType,
        )}&duration=${encodeURIComponent(String(durationMinutes ?? 120))}`,
      );
      const data = await res.json();
      const list: string[] = data.slots ?? [];
      setSlots(list);
      if (
        assistantDraft &&
        assistantDraft.packageId === selected?.id &&
        assistantDraft.minutes === durationMinutes &&
        assistantDraft.postcode.replace(/\s/g, "") ===
          pc.toUpperCase().replace(/\s/g, "")
      ) {
        if (data.covered && list.includes(assistantDraft.slot)) {
          setSlot(assistantDraft.slot);
          setOptionalSlots(
            assistantDraft.optional.filter((time) => list.includes(time)),
          );
        } else {
          setHandoffError(
            "Your preferred time is no longer permitted. Please choose another time.",
          );
        }
        setAssistantDraft(null);
      }
    } catch {
      setSlots([]);
    }
  }

  function pick(p: Pkg) {
    setSelected(p);
    setAssistantDraft(null);
    setFrequency(p.name === "Essential Clean" ? "weekly" : "one_time");
    setPromoInfo(null);
    setPreferredCleaner("");
    setCleaningMinutes(Math.min(480, Math.max(120, p.duration_minutes ?? 120)));
    setSlot(null);
    setOptionalSlots([]);
  }

  function goToFrequency() {
    if (!selected) return;
    setStep(2);
  }

  function goToTimes() {
    if (!selected || !home || petsAtHome === null || extrasError) return;
    setStep(4);
    loadSlots(postcode, selected.service_type ?? "", minutes);
  }

  async function checkPromo() {
    if (!selected) return;
    setPromoInfo(null);
    try {
      const res = await fetch("/api/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: promo,
          packageId: selected.id,
          durationMinutes: cleaningMinutes,
          frequency,
          regularVisits,
          addons: extras.addons,
          bringsProducts: extras.bringsProducts,
          visitExtras,
        }),
      });
      const d = await res.json();
      setPromoInfo(
        d.valid
          ? {
              ok: true,
              msg: `${d.code} applied`,
              discount: d.discount,
              total: d.total,
            }
          : { ok: false, msg: d.error ?? "That code isn't valid." },
      );
    } catch {
      setPromoInfo({ ok: false, msg: "Couldn't check that code." });
    }
  }

  function checkout() {
    const policyError =
      selected && bookingPolicyError(selected.name, frequency);
    if (policyError) {
      setPayError(policyError);
      return;
    }
    if (signedIn === false) {
      continueAfterSignIn();
      return;
    }
    return startCheckout();
  }

  function continueAfterSignIn() {
    if (!selected || !home || !slot || petsAtHome === null) return;
    let returnTo: string | null = null;
    try {
      returnTo = saveBookingDraft(window.sessionStorage, {
        packageId: selected.id,
        postcode,
        address,
        home,
        frequency,
        regularVisits,
        cleaningMinutes,
        extras,
        visitOverrides,
        preferences: {
          howHeard,
          confirmationChannel,
          roomsToClean,
          accessInstructions,
        },
        petsAtHome,
        slot,
        optionalSlots,
        request,
        promo,
        preferredCleaner,
        phone,
      });
    } catch {
      /* Keep the form on screen if browser storage is blocked. */
    }
    if (!returnTo) {
      setPayError(
        "We couldn't save your booking for sign-in. Allow storage for this website, then try again. Your details are still here.",
      );
      return;
    }
    window.location.assign(authLink("/login", returnTo));
  }

  const needsPhone =
    signedIn === true && savedPhone !== null && !isStoredUkPhone(savedPhone);
  const phoneValid = isValidUkPhone(phone);
  // Any chosen time could become the visit, so the earliest one decides.
  const earliestChosenStart = [slot, ...optionalSlots]
    .filter((time): time is string => Boolean(time))
    .map((time) => new Date(time).getTime())
    .reduce(
      (earliest, time) => Math.min(earliest, time),
      Number.POSITIVE_INFINITY,
    );
  const needsEarlyStart =
    earlyStartForced ||
    (Number.isFinite(earliestChosenStart) &&
      startsWithinCancellationPeriod(earliestChosenStart));

  async function startCheckout() {
    if (
      !selected ||
      !addressValid ||
      !slot ||
      !home ||
      petsAtHome === null ||
      extrasError
    )
      return;
    if (needsPhone && !phoneValid) {
      setPhoneTouched(true);
      return;
    }
    if (needsEarlyStart && !earlyStartAgreed) return;
    if (perVisitBilling && !saveCardConsent) return;
    if (!bookingLegal.accepted || !bookingLegal.documents) {
      setPayError("Please read and accept the booking policies before paying.");
      return;
    }
    const policyError = bookingPolicyError(selected.name, frequency);
    if (policyError) {
      setPayError(policyError);
      return;
    }
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: selected.id,
          durationMinutes: cleaningMinutes,
          addons: extras.addons,
          bringsProducts: extras.bringsProducts,
          petsAtHome,
          saveCardConsent,
          legalAccepted: bookingLegal.accepted,
          legalDocuments: bookingLegal.documents,
          bookingPreferences: {
            howHeard,
            confirmationChannel,
            roomsToClean,
            accessInstructions,
          },
          visitExtras,
          regularVisits: frequency === "one_time" ? undefined : regularVisits,
          address,
          savedAddressId: savedAddressId || undefined,
          frequency,
          preferredProviderId: cleaning ? preferredCleaner || null : null,
          postcode,
          request,
          home,
          slot,
          optionalSlots,
          promoCode: promoInfo?.ok ? promo.trim().toUpperCase() : null,
          phone: needsPhone ? phone : undefined,
          earlyStartRequested: needsEarlyStart && earlyStartAgreed,
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setPaying(false);
        continueAfterSignIn();
        return;
      }
      if (data.url) window.location.assign(data.url);
      else {
        if (data.code === "phone_required") {
          setSavedPhone("");
          setPhoneTouched(true);
        }
        if (data.code === "early_start_required") setEarlyStartForced(true);
        if (data.code === "legal_documents_changed") {
          setBookingLegal({ accepted: false, documents: null });
          setLegalRefresh((value) => value + 1);
        }
        throw new Error(data.error || "Could not start checkout");
      }
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Checkout failed");
      setPaying(false);
    }
  }

  /* ---------- administrator guard ---------- */
  if (role === "admin") {
    return (
      <main className="guard">
        <div className="gcard">
          <div style={{ fontSize: 38 }}>🧹</div>
          <h1>This is the customer booking page</h1>
          <p>Open your control panel to manage the service.</p>
          <a className="btn" href="/admin">
            Go to admin
          </a>
        </div>
        <style jsx>{`
          .guard {
            min-height: 70vh;
            display: grid;
            place-items: center;
            padding: 24px;
            font-family: "Nunito", system-ui, sans-serif;
          }
          .gcard {
            background: #fff;
            border: 2px solid #edeff1;
            border-radius: 24px;
            padding: 34px 30px;
            max-width: 420px;
            text-align: center;
          }
          h1 {
            font-size: 23px;
            font-weight: 900;
            color: #16202a;
            margin: 10px 0 6px;
          }
          p {
            color: #7a828c;
            font-weight: 600;
            margin: 0 0 22px;
          }
          .btn {
            display: inline-block;
            background: linear-gradient(100deg, #f5c542, #c86fc9 55%, #7b2ff7);
            color: #fff;
            padding: 13px 26px;
            border-radius: 999px;
            text-decoration: none;
            font-weight: 900;
          }
        `}</style>
      </main>
    );
  }

  const shown = (
    serviceType
      ? packages.filter((p) => (p.service_type ?? "").includes(serviceType))
      : packages
  ).sort(serviceType === "clean" ? compareCleaningSessions : () => 0);

  const total = selected
    ? promoInfo?.ok && promoInfo.total !== undefined
      ? promoInfo.total
      : (quote?.totalPence ?? 0) / 100
    : 0;
  const discounts = quote
    ? visitDiscounts(
        quote.quotes.map((visit) => visit.totalPence),
        Math.round((promoInfo?.ok ? (promoInfo.discount ?? 0) : 0) * 100),
      )
    : [];
  const dueToday =
    perVisitBilling && frequency !== "one_time"
      ? 0
      : perVisitBilling
        ? ((quote?.quotes[0].totalPence ?? 0) - (discounts[0] ?? 0)) / 100
        : total;
  const policyError = selected
    ? bookingPolicyError(selected.name, frequency)
    : null;
  const oneTimeEssential = packages.find(
    (item) => item.name === "One-Time Essential Clean",
  );
  const regular = frequency !== "one_time";
  let regularSlots: string[] = [];
  let regularScheduleError: string | null = null;
  if (regular && slot) {
    try {
      regularSlots = regularVisitSlots(
        slot,
        frequency as RegularFrequency,
        cleaningMinutes,
        scheduleNow,
        regularVisits,
      );
    } catch (cause) {
      regularScheduleError =
        cause instanceof Error
          ? cause.message
          : "Choose an earlier first date.";
    }
  }

  return (
    <div className="wrap">
      <div className="grid">
        {/* ================= MAIN ================= */}
        <main>
          {handoffError && <p className="handoffError">{handoffError}</p>}
          {/* progress */}
          <p className="stepline">
            Step {step + 1} of {STEPS.length} · <strong>{STEPS[step]}</strong>
          </p>
          <div className="prog">
            <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>

          {/* ---- 0 ADDRESS ---- */}
          {step === 0 && (
            <section>
              <p className="eyebrow">Home cleaning</p>
              <h1>Where should we clean?</h1>
              <p className="lede">Start with the address for this visit.</p>

              {savedAddresses.length > 0 && (
                <label className="label">
                  Saved address
                  <select
                    value={savedAddressId}
                    onChange={(event) => {
                      const place = savedAddresses.find(
                        (item) => item.id === event.target.value,
                      );
                      if (place) applySavedAddress(place);
                      else {
                        setSavedAddressId("");
                        setAddress("");
                        setPostcode("");
                        setGate(null);
                      }
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: 14,
                      margin: "10px 0 18px",
                      borderRadius: 12,
                      border: "1px solid #e5e1ef",
                      background: "white",
                    }}
                  >
                    <option value="">Enter a different address</option>
                    {savedAddresses.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.label} · {place.postcode}
                        {place.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                  {savedAddressId && (
                    <small>
                      Saved home and access details will be included for your
                      assigned professional.
                    </small>
                  )}
                </label>
              )}
              <p className="label">Full service address</p>
              <input
                className="field bigAddress"
                placeholder="e.g. 21 Baker Street, London"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setSavedAddressId("");
                }}
                autoComplete="street-address"
                aria-label="Full service address"
              />

              <p className="label">Postcode</p>
              <div className="inline">
                <input
                  className="field big"
                  placeholder="e.g. SW3 1AA"
                  value={postcode}
                  onChange={(e) => {
                    setPostcode(e.target.value);
                    setSavedAddressId("");
                    setGate(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && checkPostcode()}
                  aria-label="Postcode"
                />
                <button className="go" onClick={checkPostcode}>
                  Check area
                </button>
              </div>

              {gate?.ok && (
                <div className="covered">
                  <strong>✓ We cover this address</strong>
                  <span>{gate.area}</span>
                </div>
              )}
              {gate && !gate.ok && (
                <div className="alert">
                  <strong>Please check your postcode.</strong>
                  <span>
                    We cover London, including all outer London boroughs. Enter
                    your full postcode, for example SW1A 1AA.
                  </span>
                </div>
              )}

              <button
                className="next"
                onClick={() => setStep(assistantDraft ? 3 : 1)}
                disabled={!addressValid || !gate?.ok}
              >
                {!addressValid
                  ? "Add your full address"
                  : !gate?.ok
                    ? "Check your postcode"
                    : assistantDraft
                      ? "Confirm home details"
                      : "Continue to sessions"}
              </button>

              <ul className="trust">
                <li>
                  <em>✓</em> Approved, DBS-verified professionals
                </li>
                <li>
                  <em>✓</em>{" "}
                  {perVisitBilling
                    ? "One-off payment at checkout; regular visits paid individually"
                    : "Review the full price and payment details before checkout"}
                </li>
                <li>
                  <em>✓</em> No cancellation charge with at least 48 hours&apos;
                  notice
                </li>
              </ul>
            </section>
          )}

          {/* ---- 1 SESSION ---- */}
          {step === 1 && (
            <section>
              <h1>Choose your session</h1>
              <p className="lede">
                Essential Clean is selected to get you started. Pick another
                session to see its details.
              </p>

              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <div className="list">
                  {shown.map((p) => (
                    <button
                      key={p.id}
                      className={selected?.id === p.id ? "opt on" : "opt"}
                      onClick={() => pick(p)}
                    >
                      <span className="optbody">
                        {p.name === "Essential Clean" && (
                          <span className="popular">Popular</span>
                        )}
                        <span className="optTop">
                          <strong>{p.name}</strong>
                          <b>{money(cleaningHourlyRatePence(p) / 100)} / hr</b>
                        </span>
                        <span className="optMeta">
                          2–8 hours · 30-minute steps ·{" "}
                          {p.name === "Essential Clean"
                            ? "6 to 10 visits"
                            : "One-time cleaning"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {selected && (
                <div className="sessionDetails">
                  <div>
                    <span>Selected session</span>
                    <strong>{selected.name}</strong>
                    <p>
                      {cleaningPackageScope(selected.name)?.purpose ??
                        selected.description ??
                        "Professional home cleaning tailored to this visit."}
                    </p>
                  </div>
                  {!cleaningPackageScope(selected.name) &&
                    (selected.inclusions?.length ||
                      selected.good_to_know?.length) && (
                      <ul>
                        {[
                          ...(selected.inclusions ?? []),
                          ...(selected.good_to_know ?? []),
                        ]
                          .slice(0, 4)
                          .map((item) => (
                            <li key={item}>✓ {item}</li>
                          ))}
                      </ul>
                    )}
                </div>
              )}
              {selected && (
                <CleaningPackageScope
                  key={selected.id}
                  packageName={selected.name}
                />
              )}

              <button
                className="next"
                onClick={goToFrequency}
                disabled={!selected}
              >
                {selected
                  ? `Continue with ${selected.name}`
                  : "Choose a session"}
              </button>

              <button className="back" onClick={() => setStep(0)}>
                ← Change address
              </button>
            </section>
          )}

          {/* ---- 2 FREQUENCY ---- */}
          {step === 2 && selected && (
            <section>
              <h1>How often?</h1>
              <p className="lede">
                Choose how regularly you would like this cleaning.
              </p>

              <div className="frequencyGrid">
                {FREQUENCIES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={
                      frequency === item.value ? "frequency on" : "frequency"
                    }
                    onClick={() => {
                      setFrequency(item.value);
                      setPromoInfo(null);
                      setOptionalSlots([]);
                    }}
                  >
                    <span className="choiceDot" />
                    <strong>{item.title}</strong>
                    <small>{item.note}</small>
                  </button>
                ))}
              </div>

              {frequency !== "one_time" && (
                <div
                  className="visitCount"
                  role="group"
                  aria-label="Number of visits"
                >
                  <span>Number of visits</span>
                  <div>
                    {Array.from(
                      { length: REGULAR_MAX_VISITS - REGULAR_MIN_VISITS + 1 },
                      (_, index) => REGULAR_MIN_VISITS + index,
                    ).map((count) => (
                      <button
                        key={count}
                        type="button"
                        className={regularVisits === count ? "on" : ""}
                        aria-pressed={regularVisits === count}
                        onClick={() => {
                          setRegularVisits(count);
                          setPromoInfo(null);
                        }}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="frequencyNote">
                A regular booking means 6 to 10 visits booked together.{" "}
                {perVisitBilling
                  ? REGULAR_PAYMENT_COPY
                  : "Pay for the plan at checkout."}{" "}
                If you prefer separate bookings, choose a one-time session.
              </p>

              {policyError && (
                <p className="flash no" role="alert">
                  {policyError}
                </p>
              )}
              {selected.name === "Essential Clean" &&
                frequency === "one_time" &&
                oneTimeEssential && (
                  <button
                    className="next"
                    type="button"
                    onClick={() => pick(oneTimeEssential)}
                  >
                    Switch to One-Time Essential Clean
                  </button>
                )}

              {!policyError && (
                <button className="next" onClick={() => setStep(3)}>
                  Continue · {frequencyLabel(frequency)}
                </button>
              )}
              <button className="back" onClick={() => setStep(1)}>
                ← Change session
              </button>
            </section>
          )}

          {/* ---- 3 HOURS ---- */}
          {step === 3 && selected && (
            <section>
              <h1>How many hours?</h1>
              <p className="lede">
                Tell us about your home for a suggested time, then choose from 2
                to 8 hours in 30-minute steps.
              </p>

              <div className="homeCard">
                <h2>Your home</h2>
                <div className="homeGrid">
                  <label>
                    Property type
                    <select
                      className="field"
                      value={propertyType}
                      onChange={(event) => {
                        const next = event.target.value as PropertyType | "";
                        setPropertyType(next);
                        if (next === "studio") setBedrooms(0);
                        else if (propertyType === "studio") setBedrooms("");
                      }}
                    >
                      <option value="">Select a property type</option>
                      <option value="studio">Studio</option>
                      <option value="flat">Flat</option>
                      <option value="house">House</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    Bedrooms
                    <select
                      className="field"
                      value={bedrooms}
                      disabled={propertyType === "studio"}
                      onChange={(event) =>
                        setBedrooms(
                          event.target.value === ""
                            ? ""
                            : Number(event.target.value),
                        )
                      }
                    >
                      <option value="">Select bedrooms</option>
                      {Array.from({ length: 9 }, (_, count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Bathrooms
                    <select
                      className="field"
                      value={bathrooms}
                      onChange={(event) =>
                        setBathrooms(
                          event.target.value === ""
                            ? ""
                            : Number(event.target.value),
                        )
                      }
                    >
                      <option value="">Select bathrooms</option>
                      {Array.from({ length: 8 }, (_, index) => (
                        <option key={index + 1} value={index + 1}>
                          {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="label">
                  Do you have pets at home?
                  <select
                    className="field"
                    value={petsAtHome === null ? "" : petsAtHome ? "yes" : "no"}
                    onChange={(event) =>
                      setPetsAtHome(
                        event.target.value === ""
                          ? null
                          : event.target.value === "yes",
                      )
                    }
                  >
                    <option value="">Choose an answer</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                {home && (
                  <div className="homeSuggestion">
                    <span>
                      Suggested starting point:{" "}
                      <strong>
                        {duration(
                          recommendedCleaningMinutesForHome(
                            home,
                            selected.name,
                          ),
                        )}
                      </strong>
                      . Time depends on your property and agreed tasks. Your
                      cleaner will see these home details.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCleaningMinutes(
                          recommendedCleaningMinutesForHome(
                            home,
                            selected.name,
                          ),
                        );
                        setPromoInfo(null);
                        setSlot(null);
                        setOptionalSlots([]);
                      }}
                    >
                      Use suggestion
                    </button>
                  </div>
                )}
              </div>

              <div className="hoursCard">
                <div className="hoursTop">
                  <div>
                    <span>Cleaning time</span>
                    <strong>{duration(cleaningMinutes)}</strong>
                  </div>
                  <div className="sessionPrice">
                    <span>Per session</span>
                    <strong>
                      {money(
                        bookingPricePence(selected, cleaningMinutes) / 100,
                      )}
                    </strong>
                  </div>
                </div>
                <input
                  className="hoursRange"
                  type="range"
                  min={CLEANING_DURATIONS[0]}
                  max={CLEANING_DURATIONS[CLEANING_DURATIONS.length - 1]}
                  step={30}
                  value={cleaningMinutes}
                  onChange={(event) => {
                    setCleaningMinutes(Number(event.target.value));
                    setPromoInfo(null);
                    setSlot(null);
                    setOptionalSlots([]);
                  }}
                  aria-label="Cleaning duration"
                />
                <div className="rangeLabels">
                  <span>2 hours</span>
                  <span>8 hours</span>
                </div>
              </div>

              <CleaningExtrasPicker
                prices={billingPrices}
                value={extras}
                visits={visitCount}
                overrides={visitOverrides}
                onChange={(value) => {
                  setExtras(value);
                  setPromoInfo(null);
                  setSlot(null);
                  setOptionalSlots([]);
                }}
                onOverride={(index, value) => {
                  setVisitOverrides((old) => {
                    const next = { ...old };
                    if (value) next[index] = value;
                    else delete next[index];
                    return next;
                  });
                  setPromoInfo(null);
                  setSlot(null);
                  setOptionalSlots([]);
                }}
              />
              {extrasError && (
                <p className="flash no" role="alert">
                  {extrasError}
                </p>
              )}
              <p className="muted">
                Reserved visit time: {duration(minutes)}. Products:{" "}
                {money(billingPrices.productsFeePence / 100)} for each visit
                where selected. Visit total:{" "}
                {money((quote?.quotes[0].totalPence ?? 0) / 100)}.
              </p>
              {previousCleaners.length > 0 && (
                <div className="previousCleaner">
                  <label className="label" htmlFor="preferred-cleaner">
                    Request a favourite or previous cleaner (optional)
                  </label>
                  <select
                    id="preferred-cleaner"
                    className="field"
                    value={preferredCleaner}
                    onChange={(e) => setPreferredCleaner(e.target.value)}
                  >
                    <option value="">
                      Match me with any available cleaner
                    </option>
                    {previousCleaners.map((p) => (
                      <option key={p.provider_id} value={p.provider_id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                  <p className="muted">
                    We’ll ask them first. Assignment still depends on their
                    acceptance.
                  </p>
                </div>
              )}

              <button
                className="next"
                onClick={goToTimes}
                disabled={!home || petsAtHome === null || !!extrasError}
              >
                Continue · {duration(minutes)}
              </button>
              {!home && (
                <p className="muted">
                  Add your property type, bedrooms, bathrooms and pets answer to
                  continue.
                </p>
              )}
              <button className="back" onClick={() => setStep(2)}>
                ← Change frequency
              </button>
            </section>
          )}

          {/* ---- 4 TIME ---- */}
          {step === 4 && selected && (
            <section>
              <h1>When suits you?</h1>
              <p className="lede">
                {regular
                  ? "Choose your first visit. The next five will follow on the same weekday or day of the month, at the same London time."
                  : "Choose the time you want. We'll find your professional after you book."}
              </p>

              {slots === null && <p className="muted">Finding times…</p>}

              {slots !== null && slots.length === 0 && (
                <div className="alert">
                  <strong>No appointment times are available.</strong>
                  <span>Try another session or contact support.</span>
                </div>
              )}

              {slots !== null && slots.length > 0 && (
                <AppointmentTimePicker
                  slots={slots}
                  value={slot}
                  onChange={setSlot}
                  {...(!regular
                    ? {
                        optionalValues: optionalSlots,
                        onOptionalValuesChange: setOptionalSlots,
                      }
                    : {})}
                  durationMinutes={minutes}
                />
              )}

              {regularScheduleError && (
                <p className="flash no" role="alert">
                  {regularScheduleError}
                </p>
              )}
              {regular && regularSlots.length === regularVisits && (
                <div className="timeChoicesReview">
                  <strong>
                    Your {regularVisits} visits ·{" "}
                    {perVisitBilling ? "paid individually" : "paid upfront"}
                  </strong>
                  <ol>
                    {regularSlots.map((visit, index) => (
                      <li key={visit}>
                        Visit {index + 1}: {fullLabel(visit)} ·{" "}
                        {duration(
                          quote?.quotes[index].durationMinutes ?? minutes,
                        )}{" "}
                        ·{" "}
                        {quote?.quotes[index].addons
                          .map((item) => item.label)
                          .join(", ") || "No add-ons"}{" "}
                        ·{" "}
                        {quote?.quotes[index].bringsProducts
                          ? "Cleaner brings products"
                          : "Your products"}{" "}
                        ·{" "}
                        {money(
                          ((quote?.quotes[index].totalPence ?? 0) -
                            (discounts[index] ?? 0)) /
                            100,
                        )}
                        {perVisitBilling && " · charged when a cleaner accepts"}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {slots !== null && slots.length > 0 && (
                <button
                  className="next"
                  onClick={() => setStep(5)}
                  disabled={!slot || !!regularScheduleError}
                >
                  {slot ? `Continue · ${fullLabel(slot)}` : "Pick a time"}
                </button>
              )}

              <button className="back" onClick={() => setStep(3)}>
                ← Change hours
              </button>
            </section>
          )}

          {/* ---- 5 CONFIRM ---- */}
          {step === 5 && selected && (
            <section>
              <h1>Review and pay</h1>
              <p className="lede">
                {regular
                  ? `Check all ${regularVisits} dates and amounts before continuing to secure checkout.`
                  : "Check your visit and payment before continuing to secure checkout."}
              </p>

              <div className="reviewCard">
                <div>
                  <span>Service</span>
                  <strong>{selected.name}</strong>
                  <small>{duration(minutes) ?? "Visit"}</small>
                </div>
                <div>
                  <span>Your home</span>
                  <strong>
                    {home ? cleaningHomeLabel(home) : "Add home details"}
                  </strong>
                  <small>
                    The professional will see this before accepting.
                  </small>
                </div>
                <div>
                  <span>Preferred time · first choice</span>
                  <strong>{slot ? fullLabel(slot) : "Choose a time"}</strong>
                  <small>
                    {address}, {postcode.toUpperCase()}
                  </small>
                </div>
                <div>
                  <span>
                    {perVisitBilling && regular
                      ? "Due today"
                      : regular
                        ? `${regularVisits}-visit total`
                        : "Amount"}
                  </span>
                  <strong>{money(dueToday)}</strong>
                  <small>
                    {regular
                      ? perVisitBilling
                        ? "Charged when a cleaner accepts"
                        : "Charged in full now"
                      : perVisitBilling
                        ? "Charged at checkout"
                        : "Payment details confirmed at checkout"}
                  </small>
                </div>
              </div>

              {regular ? (
                <div className="timeChoicesReview">
                  <strong>All {regularVisits} booked visits</strong>
                  <ol>
                    {regularSlots.map((visit, index) => (
                      <li key={visit}>
                        Visit {index + 1}: {fullLabel(visit)}
                      </li>
                    ))}
                  </ol>
                  {regularScheduleError && (
                    <p className="flash no" role="alert">
                      {regularScheduleError}
                    </p>
                  )}
                  <small>
                    We&apos;ll match a professional to each visit. They may be
                    different professionals.
                  </small>
                </div>
              ) : (
                <div className="timeChoicesReview">
                  <strong>Optional times</strong>
                  {optionalSlots.length ? (
                    <ul>
                      {optionalSlots.map((optionalSlot) => (
                        <li key={optionalSlot}>{fullLabel(optionalSlot)}</li>
                      ))}
                    </ul>
                  ) : (
                    <span>No optional times added.</span>
                  )}
                  <small>
                    Cleaners can choose one of these if your preferred time is
                    unavailable.
                  </small>
                </div>
              )}

              <p>
                {frequencyLabel(frequency)} · {duration(minutes)}
                {preferredCleaner
                  ? ` · Requested cleaner: ${previousCleaners.find((p) => p.provider_id === preferredCleaner)?.display_name ?? "Previous cleaner"}`
                  : ""}
              </p>
              <p>Pets at home: {petsAtHome ? "Yes" : "No"}</p>
              {!regular && (
                <p>
                  Add-ons:{" "}
                  {quote?.quotes[0].addons
                    .map((item) => item.label)
                    .join(", ") || "None"}
                  .{" "}
                  {extras.bringsProducts
                    ? `Cleaner brings products: ${money(billingPrices.productsFeePence / 100)}`
                    : "You supply products"}
                  .
                </p>
              )}
              <CleaningPackageScope packageName={selected.name} />
              {policyError && (
                <>
                  <p className="flash no" role="alert">
                    {policyError}
                  </p>
                  <button
                    className="back"
                    type="button"
                    onClick={() => setStep(2)}
                  >
                    ← Change frequency or session
                  </button>
                </>
              )}
              <label className="label" htmlFor="rooms-to-clean">
                Rooms to clean
              </label>
              <textarea
                id="rooms-to-clean"
                className="field"
                maxLength={500}
                rows={2}
                value={roomsToClean}
                onChange={(e) => setRoomsToClean(e.target.value)}
                placeholder="e.g. both bedrooms, bathroom, kitchen and living room"
              />
              <label className="label" htmlFor="access-instructions">
                Access instructions (optional)
              </label>
              <textarea
                id="access-instructions"
                className="field"
                maxLength={1000}
                rows={2}
                value={accessInstructions}
                onChange={(e) => setAccessInstructions(e.target.value)}
                placeholder="e.g. concierge, entry code, key safe or parking. Do not include a phone number."
              />
              <label className="label" htmlFor="how-heard">
                How did you hear about us?
              </label>
              <select
                id="how-heard"
                className="field"
                value={howHeard}
                onChange={(e) => setHowHeard(e.target.value)}
              >
                <option value="">Select (optional)</option>
                {REFERRAL_SOURCES.map((source) => (
                  <option key={source}>{source}</option>
                ))}
              </select>
              <label className="label" htmlFor="confirmation-channel">
                How would you like booking confirmations?
              </label>
              <select
                id="confirmation-channel"
                className="field"
                value={confirmationChannel}
                onChange={(e) =>
                  setConfirmationChannel(e.target.value as "email" | "sms")
                }
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
              <p className="fineprint">
                {smsAvailable
                  ? "We will use your selected confirmation channel. Email is a fallback if a text cannot be sent. In-app updates remain available."
                  : "SMS is not enabled yet. If you choose SMS, we will use email until text messages are available. In-app updates remain available."}
              </p>
              <p className="label">Requests (optional)</p>
              <textarea
                className="field"
                rows={3}
                maxLength={250}
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="e.g. key is under the mat, please avoid the study"
              />

              <p className="label">Promo code (optional)</p>
              <div className="inline">
                <input
                  className="field"
                  placeholder="WELCOME10"
                  value={promo}
                  onChange={(e) => {
                    setPromo(e.target.value);
                    setPromoInfo(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && checkPromo()}
                />
                <button className="ghost" onClick={checkPromo}>
                  Apply
                </button>
              </div>
              {promoInfo && (
                <p className={promoInfo.ok ? "flash ok" : "flash no"}>
                  {promoInfo.msg}
                  {promoInfo.ok && promoInfo.discount !== undefined
                    ? ` — ${money(promoInfo.discount)} off`
                    : ""}
                </p>
              )}

              <div className="held">
                <strong>
                  {perVisitBilling
                    ? regular
                      ? "Save your card for your regular visits"
                      : "Pay for your visit now"
                    : regular
                      ? `Pay for all ${regularVisits} visits now`
                      : "Review your visit payment"}
                </strong>
                <span>
                  {perVisitBilling
                    ? regular
                      ? REGULAR_PAYMENT_COPY
                      : ONE_OFF_PAYMENT_COPY
                    : regular
                      ? `This payment covers the ${regularVisits} dates above. Refunds follow the cancellation policy.`
                      : "Review the payment amount and timing at secure checkout before confirming."}
                </span>
              </div>

              {perVisitBilling && signedIn === true && (
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={saveCardConsent}
                    onChange={(event) =>
                      setSaveCardConsent(event.target.checked)
                    }
                  />{" "}
                  I authorise Opulence Bliss to save my card with Stripe, charge
                  each regular visit when a cleaner accepts it, and charge any
                  add-on changes I confirm. Add-ons can be changed until 24
                  hours before the visit.
                </label>
              )}
              {payError && <p className="flash no">{payError}</p>}

              <button className="back" onClick={() => setStep(4)}>
                ← Change time
              </button>
            </section>
          )}
        </main>

        <a
          data-earn-with-us
          className="earn-link"
          style={{
            gridColumn: "1 / -1",
            gridRow: 3,
            padding: 20,
            textAlign: "center",
            fontWeight: 800,
          }}
          href="/provider/join"
        >
          Earn with us →
        </a>
        {/* ================= BASKET ================= */}
        {step > 0 && (
          <aside className="basket">
            <p className="bhead">Your booking</p>

            <div className="brow">
              <span className="k">Address</span>
              <span className="v">
                {address}
                <br />
                {postcode.toUpperCase()}
                <button className="chg" onClick={() => setStep(0)}>
                  Change
                </button>
              </span>
            </div>

            <div className="brow">
              <span className="k">Service</span>
              <span className="v">Cleaning</span>
            </div>

            {selected && step >= 2 && (
              <div className="brow">
                <span className="k">Cleaning type</span>
                <span className="v">{selected.name}</span>
              </div>
            )}
            {step >= 3 && (
              <div className="brow">
                <span className="k">Frequency</span>
                <span className="v">{frequencyLabel(frequency)}</span>
              </div>
            )}
            {step >= 3 && selected && (
              <>
                {home && (
                  <div className="brow">
                    <span className="k">Home</span>
                    <span className="v">{cleaningHomeLabel(home)}</span>
                  </div>
                )}
                <div className="brow">
                  <span className="k">Hours</span>
                  <span className="v">{duration(minutes) ?? "—"}</span>
                </div>
                {step >= 4 && (
                  <>
                    <div className="brow">
                      <span className="k">Preferred time</span>
                      <span className="v">
                        {slot ? fullLabel(slot) : "Not picked"}
                      </span>
                    </div>
                    {!regular && optionalSlots.length > 0 && (
                      <div className="brow">
                        <span className="k">Optional times</span>
                        <span className="v">
                          {optionalSlots.map(fullLabel).join(" · ")}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {promoInfo?.ok && promoInfo.discount !== undefined && (
                  <div className="brow">
                    <span className="k">{promo.toUpperCase()}</span>
                    <span className="v disc">−{money(promoInfo.discount)}</span>
                  </div>
                )}

                <div className="total">
                  <span>
                    {regular
                      ? perVisitBilling
                        ? `Plan total for ${regularVisits} visits`
                        : `Total for ${regularVisits} visits upfront`
                      : "Total per session"}
                  </span>
                  <strong>{money(total)}</strong>
                </div>
                <p className="fee">Service fee included</p>
              </>
            )}

            {step === 1 && (
              <p className="hint">Choose a cleaning session on the left.</p>
            )}
            {step === 2 && (
              <p className="hint">Now choose how often you would like it.</p>
            )}
            {step === 5 && needsPhone && (
              <div className="phone-ask">
                <label htmlFor="booking-phone">Your phone number</label>
                <div
                  className={`phone-row ${phoneTouched && !phoneValid ? "invalid" : ""}`}
                >
                  <span>+44</span>
                  <input
                    id="booking-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="7912 345678"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    onBlur={() => setPhoneTouched(true)}
                    aria-invalid={phoneTouched && !phoneValid}
                    aria-describedby="booking-phone-help"
                  />
                </div>
                {phoneTouched && !phoneValid && (
                  <p className="phone-error">Enter a valid UK phone number.</p>
                )}
                <p className="phone-help" id="booking-phone-help">
                  Your cleaner uses this to reach you on the day, for example if
                  they cannot get in. It is saved to your account.
                </p>
              </div>
            )}
            {step === 5 && signedIn !== false && (
              <BookingLegalConsent
                value={bookingLegal}
                onChange={setBookingLegal}
                refreshKey={legalRefresh}
              />
            )}
            {step === 5 && signedIn === true && needsEarlyStart && (
              <label className="early-start" htmlFor="early-start">
                <input
                  id="early-start"
                  type="checkbox"
                  checked={earlyStartAgreed}
                  onChange={(event) =>
                    setEarlyStartAgreed(event.target.checked)
                  }
                />
                <span>
                  {EARLY_START_REQUEST_TEXT}{" "}
                  <a
                    href={CANCELLATION_REFUND_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Your cancellation rights
                  </a>
                </span>
              </label>
            )}
            {step === 5 && (
              <button
                className="pay"
                onClick={checkout}
                disabled={
                  paying ||
                  !pricesReady ||
                  (signedIn !== false &&
                    (!bookingLegal.accepted || !bookingLegal.documents)) ||
                  (signedIn !== false && perVisitBilling && !saveCardConsent) ||
                  !slot ||
                  !addressValid ||
                  !home ||
                  petsAtHome === null ||
                  !!extrasError ||
                  !!policyError ||
                  !!regularScheduleError ||
                  (needsPhone && !phoneValid) ||
                  (signedIn !== false && needsEarlyStart && !earlyStartAgreed)
                }
              >
                {paying
                  ? "Taking you to checkout…"
                  : signedIn === false
                    ? "Sign in to continue"
                    : regular
                      ? perVisitBilling
                        ? "Book and pay £0 today (save card)"
                        : `Book and pay ${money(total)} for ${regularVisits} visits`
                      : `Book and pay ${money(total)}`}
              </button>
            )}
            {step === 5 && <p className="alt">No VAT is charged.</p>}

            <p className="alt">
              Need another visit? You can book again whenever it suits you.
            </p>
          </aside>
        )}
      </div>

      <style jsx>{`
        .wrap {
          --ink: #16202a;
          --muted: #7a828c;
          --line: #edeff1;
          --purple: #6d28d9;
          --grad: linear-gradient(100deg, #f5c542, #c86fc9 55%, #7b2ff7);
          --tint: #f8f3ff;
          min-height: 100vh;
          background: #fff;
          color: var(--ink);
          font-family: "Nunito", system-ui, sans-serif;
        }
        .grid {
          width: 100%;
          box-sizing: border-box;
          max-width: 1040px;
          margin: 0 auto;
          padding: 30px 20px 96px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 34px;
          align-items: start;
        }
        /* Without this, a wide grid child stops the column shrinking and
           pushes content off screen. */
        main {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        main section {
          min-width: 0;
        }
        .next {
          width: 100%;
          margin-top: 26px;
          background: var(--grad);
          color: #fff;
          border: none;
          border-radius: 999px;
          padding: 16px;
          font: inherit;
          font-size: 16.5px;
          font-weight: 900;
          cursor: pointer;
        }
        .next:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        /* progress */
        .stepline {
          font-size: 13.5px;
          font-weight: 700;
          color: var(--muted);
          margin: 0 0 8px;
        }
        .stepline strong {
          color: var(--purple);
          font-weight: 900;
        }
        .types {
          display: grid;
          grid-template-columns: repeat(
            auto-fit,
            minmax(min(100%, 190px), 1fr)
          );
          gap: 12px;
          margin-bottom: 6px;
        }
        .type {
          background: #fff;
          border: 2px solid var(--line);
          border-radius: 18px;
          padding: 22px 20px;
          text-align: left;
          font: inherit;
          cursor: pointer;
          transition:
            border-color 0.15s ease,
            transform 0.15s ease;
        }
        .type:hover {
          border-color: #c9b6f2;
          transform: translateY(-2px);
        }
        .type.on {
          border-color: var(--purple);
          background: var(--tint);
        }
        .typeIcon {
          display: grid;
          place-items: center;
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: var(--grad);
          color: #fff;
          font-size: 18px;
          margin-bottom: 12px;
        }
        .type strong {
          display: block;
          font-size: 19px;
          font-weight: 900;
          margin-bottom: 3px;
        }
        .type small {
          color: var(--muted);
          font-size: 13.5px;
          font-weight: 600;
        }
        .chg {
          background: none;
          border: none;
          padding: 0 0 0 8px;
          font: inherit;
          font-size: 12.5px;
          font-weight: 800;
          color: var(--purple);
          cursor: pointer;
          text-decoration: underline;
        }
        .pcEdit {
          display: flex;
          gap: 6px;
          padding: 10px 0 4px;
        }
        .pcEdit input {
          flex: 1;
          min-width: 0;
          border: 2px solid var(--line);
          border-radius: 10px;
          padding: 9px 11px;
          font: inherit;
          font-size: 14px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--ink);
        }
        .pcEdit input:focus-visible {
          outline: none;
          border-color: var(--purple);
        }
        .pcEdit button {
          background: var(--grad);
          color: #fff;
          border: none;
          border-radius: 10px;
          padding: 9px 14px;
          font: inherit;
          font-size: 13.5px;
          font-weight: 900;
          cursor: pointer;
        }
        .prog {
          height: 8px;
          background: #f1f2f4;
          border-radius: 999px;
          overflow: hidden;
          margin-bottom: 26px;
        }
        .prog span {
          display: block;
          height: 100%;
          background: var(--grad);
          border-radius: 999px;
          transition: width 0.3s ease;
        }

        h1 {
          font-size: clamp(26px, 4vw, 34px);
          font-weight: 900;
          letter-spacing: -0.025em;
          margin: 0 0 6px;
        }
        .eyebrow {
          margin: 0 0 7px;
          color: var(--purple);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.11em;
          text-transform: uppercase;
        }
        .lede {
          color: var(--muted);
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 24px;
        }
        .handoffError {
          margin: 0 0 16px;
          padding: 12px 14px;
          border: 1.5px solid #f0c36a;
          border-radius: 13px;
          background: #fff9e8;
          color: #7a5200;
          font-size: 14px;
          font-weight: 800;
        }
        .label {
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
          margin: 22px 0 9px;
        }
        .muted {
          color: var(--muted);
          font-weight: 600;
        }

        /* fields */
        .field {
          width: 100%;
          box-sizing: border-box;
          min-height: 44px;
          padding: 9px 13px;
          border: 2px solid var(--line);
          border-radius: 14px;
          font: inherit;
          font-size: 16px;
          font-weight: 600;
          color: var(--ink);
          background: #fff;
          margin-bottom: 7px;
          resize: vertical;
        }
        .field:focus-visible {
          outline: none;
          border-color: var(--purple);
        }
        .field.big {
          font-size: 19px;
          font-weight: 800;
          text-transform: uppercase;
          padding: 11px 15px;
          margin-bottom: 0;
        }
        .field.bigAddress {
          padding: 13px 16px;
          font-size: 18px;
          font-weight: 800;
        }
        @media (hover: hover) and (pointer: fine) {
          .field {
            min-height: 40px;
            padding: 7px 12px;
            font-size: 15px;
            margin-bottom: 6px;
          }
          .field.big {
            font-size: 17px;
            padding: 9px 14px;
          }
          .field.bigAddress {
            padding: 10px 14px;
            font-size: 17px;
          }
        }
        .inline {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .inline .field {
          flex: 1;
          min-width: 0;
        }
        .go,
        .ghost {
          border: none;
          border-radius: 14px;
          padding: 16px 26px;
          font: inherit;
          font-size: 16px;
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
        }
        .go {
          background: var(--grad);
          color: #fff;
        }
        .ghost {
          background: #fff;
          color: var(--purple);
          border: 2px solid var(--line);
          padding: 14px 22px;
        }
        .covered {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 14px;
          padding: 13px 15px;
          border: 1.5px solid #bfe7cf;
          border-radius: 14px;
          background: #effaf4;
          color: #137b4e;
          font-size: 14px;
          font-weight: 800;
        }

        /* trust */
        .trust {
          list-style: none;
          padding: 24px 0 0;
          margin: 26px 0 0;
          border-top: 1px solid var(--line);
          display: grid;
          gap: 12px;
        }
        .trust li {
          display: flex;
          gap: 10px;
          align-items: center;
          font-size: 15px;
          font-weight: 700;
          color: var(--ink);
        }
        .trust em {
          font-style: normal;
          color: #137b4e;
          font-weight: 900;
        }

        /* session options */
        .list {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .opt {
          display: block;
          min-width: 0;
          min-height: 92px;
          text-align: left;
          background: #fff;
          border: 2px solid var(--line);
          border-radius: 15px;
          padding: 11px 12px;
          font: inherit;
          cursor: pointer;
          transition:
            border-color 0.15s ease,
            transform 0.15s ease;
        }
        .opt:hover {
          border-color: #c9b6f2;
          transform: translateY(-1px);
        }
        .opt.on {
          border-color: var(--purple);
          background: var(--tint);
        }
        .optbody {
          display: block;
          min-width: 0;
        }
        .popular {
          display: inline-flex;
          margin-bottom: 5px;
          border-radius: 999px;
          padding: 3px 7px;
          background: var(--grad);
          color: #fff;
          font-size: 9.5px;
          font-weight: 900;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }
        .optTop {
          display: grid;
          gap: 3px;
        }
        .optTop strong {
          font-size: 14px;
          font-weight: 900;
          line-height: 1.18;
        }
        .optTop b {
          font-size: 13px;
          font-weight: 900;
          color: var(--purple);
          white-space: nowrap;
        }
        .optMeta {
          display: block;
          font-size: 10.5px;
          font-weight: 700;
          color: var(--muted);
          margin-top: 4px;
          line-height: 1.25;
        }
        .sessionDetails {
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
          gap: 18px;
          margin-top: 12px;
          padding: 14px 16px;
          border: 1.5px solid #e3d7f5;
          border-radius: 15px;
          background: #faf7ff;
        }
        .sessionDetails span {
          display: block;
          color: var(--purple);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .sessionDetails strong {
          display: block;
          margin-top: 2px;
          font-size: 15px;
          font-weight: 900;
        }
        .sessionDetails p {
          margin: 4px 0 0;
          color: var(--muted);
          font-size: 12px;
          font-weight: 650;
          line-height: 1.4;
        }
        .sessionDetails ul {
          margin: 0;
          padding: 0;
          list-style: none;
          color: #4c5967;
          font-size: 11.5px;
          font-weight: 750;
          line-height: 1.5;
        }

        /* frequency and duration */
        .frequencyGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .frequency {
          display: grid;
          justify-items: start;
          gap: 5px;
          min-height: 128px;
          padding: 18px;
          border: 2px solid var(--line);
          border-radius: 17px;
          background: #fff;
          color: var(--ink);
          text-align: left;
          font: inherit;
          cursor: pointer;
        }
        .frequency:hover,
        .frequency.on {
          border-color: var(--purple);
        }
        .frequency.on {
          background: var(--tint);
        }
        .choiceDot {
          width: 19px;
          height: 19px;
          border: 2px solid #ced3da;
          border-radius: 50%;
        }
        .frequency.on .choiceDot {
          border-color: var(--purple);
          background: var(--grad);
          box-shadow: inset 0 0 0 3px #fff;
        }
        .frequency strong {
          font-size: 17px;
          font-weight: 900;
        }
        .frequency small {
          color: var(--muted);
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.35;
        }
        .visitCount {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px 14px;
          margin: 18px 0 0;
        }
        .visitCount > span {
          color: var(--ink);
          font-size: 14px;
          font-weight: 800;
        }
        .visitCount > div {
          display: flex;
          gap: 8px;
        }
        .visitCount button {
          width: 44px;
          height: 44px;
          border: 2px solid var(--line);
          border-radius: 12px;
          background: #fff;
          color: var(--ink);
          font: inherit;
          font-weight: 800;
          cursor: pointer;
        }
        .visitCount button.on {
          border-color: var(--purple);
          background: var(--purple);
          color: #fff;
        }
        .frequencyNote {
          margin: 14px 0 0;
          padding: 12px 14px;
          border-radius: 13px;
          background: #f5f1fc;
          color: #685d78;
          font-size: 12.5px;
          font-weight: 700;
        }
        .homeCard {
          margin-bottom: 18px;
          padding: 20px;
          border: 1.5px solid #e5d9f7;
          border-radius: 18px;
          background: #faf7ff;
        }
        .homeCard h2 {
          margin: 0 0 14px;
          font-size: 19px;
          font-weight: 900;
        }
        .homeGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .homeGrid label {
          display: block;
          min-width: 0;
          font-size: 12px;
          font-weight: 800;
        }
        .homeGrid .field {
          width: 100%;
          margin: 6px 0 0;
          padding-inline: 10px;
          font-size: 13px;
        }
        .homeSuggestion {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 15px;
          color: #4c5967;
          font-size: 13px;
          line-height: 1.45;
        }
        .homeSuggestion button {
          flex: 0 0 auto;
          padding: 9px 12px;
          border: 1px solid #6d28d9;
          border-radius: 10px;
          background: #fff;
          color: #6d28d9;
          font: inherit;
          font-weight: 900;
          cursor: pointer;
        }
        .hoursCard {
          padding: 24px;
          border: 2px solid #e5d9f7;
          border-radius: 20px;
          background: linear-gradient(145deg, #fff, #faf7ff);
        }
        .hoursTop {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: end;
          margin-bottom: 24px;
        }
        .hoursTop span {
          display: block;
          color: var(--muted);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }
        .hoursTop strong {
          display: block;
          margin-top: 4px;
          font-size: 30px;
          font-weight: 900;
        }
        .sessionPrice {
          text-align: right;
        }
        .sessionPrice strong {
          color: var(--purple);
        }
        .hoursRange {
          width: 100%;
          accent-color: var(--purple);
          cursor: pointer;
        }
        .rangeLabels {
          display: flex;
          justify-content: space-between;
          margin-top: 5px;
          color: var(--muted);
          font-size: 11.5px;
          font-weight: 800;
        }
        .previousCleaner {
          margin-top: 16px;
          padding: 2px 16px 10px;
          border-radius: 16px;
          background: #fafafa;
        }

        /* times */
        .times {
          display: grid;
          grid-template-columns: repeat(
            auto-fill,
            minmax(min(100%, 74px), 1fr)
          );
          gap: 8px;
        }
        .time {
          padding: 11px 6px;
          font-size: 14.5px;
          border-width: 1.5px;
          border-radius: 10px;
        }

        /* confirm */
        .reviewCard {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 24px;
        }
        .reviewCard > div {
          min-width: 0;
          padding: 15px 16px;
          border: 1.5px solid #e8e2f2;
          border-radius: 16px;
          background: linear-gradient(145deg, #fff, #faf7ff);
        }
        .reviewCard span,
        .reviewCard strong,
        .reviewCard small {
          display: block;
        }
        .reviewCard span {
          margin-bottom: 6px;
          color: #8b92a0;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }
        .reviewCard strong {
          color: var(--ink);
          font-size: 15px;
          font-weight: 900;
          line-height: 1.3;
          overflow-wrap: anywhere;
        }
        .reviewCard small {
          margin-top: 4px;
          color: var(--muted);
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.35;
        }
        .timeChoicesReview {
          display: grid;
          gap: 5px;
          margin: -12px 0 24px;
          padding: 13px 15px;
          border: 1px solid #e8dff1;
          border-radius: 14px;
          background: #fffaf6;
        }
        .timeChoicesReview > strong {
          color: var(--purple);
          font-size: 13px;
          font-weight: 900;
        }
        .timeChoicesReview > span,
        .timeChoicesReview li {
          color: var(--ink);
          font-size: 13px;
          font-weight: 800;
        }
        .timeChoicesReview ul,
        .timeChoicesReview ol {
          display: grid;
          gap: 3px;
          margin: 0;
          padding-left: 19px;
        }
        .timeChoicesReview small {
          color: var(--muted);
          font-size: 11.5px;
          font-weight: 700;
        }
        .held {
          background: #f4fbf7;
          border: 2px solid #cdead9;
          border-radius: 16px;
          padding: 15px 18px;
          margin-top: 22px;
          display: grid;
          gap: 4px;
        }
        .held strong {
          color: #137b4e;
          font-size: 15.5px;
          font-weight: 900;
        }
        .held span {
          color: #4b6b58;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.5;
        }

        .alert {
          background: #fff5d9;
          border: 2px solid #ffe09e;
          border-radius: 16px;
          padding: 15px 18px;
          margin-top: 16px;
          display: grid;
          gap: 3px;
          color: #8a5a00;
        }
        .alert strong {
          font-size: 15.5px;
          font-weight: 900;
        }
        .alert span {
          font-size: 14px;
          font-weight: 600;
        }
        .flash {
          font-size: 14.5px;
          font-weight: 800;
          padding: 11px 14px;
          border-radius: 12px;
          margin: 0 0 6px;
        }
        .flash.ok {
          background: #e4f6ec;
          color: #137b4e;
        }
        .flash.no {
          background: #ffe6ea;
          color: #b0384f;
        }
        .back {
          display: inline-block;
          margin-top: 26px;
          background: none;
          border: none;
          color: var(--muted);
          font: inherit;
          font-size: 14.5px;
          font-weight: 800;
          cursor: pointer;
          padding: 6px 0;
        }
        .back:hover {
          color: var(--purple);
        }

        /* basket */
        .basket {
          background: #fff;
          border: 2px solid var(--line);
          border-radius: 22px;
          padding: 22px 22px 20px;
          position: sticky;
          top: 20px;
        }
        .bhead {
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          margin: 0 0 14px;
        }
        .brow {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 11px 0;
          border-bottom: 1px solid #f4f5f7;
        }
        .k {
          font-size: 13.5px;
          font-weight: 700;
          color: var(--muted);
        }
        .v {
          font-size: 14.5px;
          font-weight: 800;
          text-align: right;
          overflow-wrap: anywhere;
        }
        .v.disc {
          color: #137b4e;
        }
        .total {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 16px 0 2px;
        }
        .total span {
          font-size: 15px;
          font-weight: 800;
          color: var(--muted);
        }
        .total strong {
          font-size: 28px;
          font-weight: 900;
        }
        .fee {
          text-align: right;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--muted);
          margin: 0 0 18px;
        }
        .hint {
          font-size: 14px;
          font-weight: 700;
          color: var(--muted);
          text-align: center;
          margin: 16px 0;
        }
        .pay {
          width: 100%;
          background: var(--grad);
          color: #fff;
          border: none;
          border-radius: 999px;
          padding: 16px;
          font: inherit;
          font-size: 16.5px;
          font-weight: 900;
          cursor: pointer;
        }
        .pay:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .phone-ask {
          margin: 0 0 14px;
        }
        .phone-ask label {
          display: block;
          margin: 0 0 6px;
          color: var(--ink);
          font-size: 14px;
          font-weight: 800;
        }
        .phone-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 44px;
          padding: 0 12px;
          border: 2px solid var(--line);
          border-radius: 14px;
          background: #fff;
        }
        .phone-row:focus-within {
          border-color: var(--purple);
        }
        .phone-row.invalid {
          border-color: #d82f45;
        }
        .phone-row span {
          color: var(--muted);
          font-weight: 800;
        }
        .phone-row input {
          flex: 1;
          min-width: 0;
          border: 0;
          outline: none;
          background: transparent;
          color: var(--ink);
          font: inherit;
          font-weight: 600;
        }
        .phone-error {
          margin: 6px 0 0;
          color: #d82f45;
          font-size: 12.5px;
          font-weight: 700;
        }
        .early-start {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          margin: 0 0 14px;
          padding: 12px 14px;
          border: 2px solid var(--line);
          border-radius: 14px;
          background: #fff;
          color: var(--ink);
          font-size: 13px;
          line-height: 1.5;
          cursor: pointer;
        }
        .early-start input {
          flex: 0 0 auto;
          width: 18px;
          height: 18px;
          margin-top: 2px;
          accent-color: var(--purple);
        }
        .early-start a {
          color: var(--purple);
          font-weight: 800;
        }
        .phone-help {
          margin: 6px 0 0;
          color: var(--muted);
          font-size: 12.5px;
          line-height: 1.45;
        }
        .alt {
          margin: 18px 0 0;
          padding-top: 16px;
          border-top: 1px solid #f4f5f7;
          font-size: 13.5px;
          font-weight: 700;
          color: var(--muted);
          text-align: center;
        }
        .alt a {
          color: var(--purple);
          font-weight: 900;
          text-decoration: none;
        }

        @media (max-width: 760px) {
          .list {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .sessionDetails {
            grid-template-columns: 1fr;
          }
          .frequencyGrid {
            grid-template-columns: 1fr;
          }
          .frequency {
            min-height: 0;
          }
          .reviewCard {
            grid-template-columns: 1fr;
          }
          .picker {
            grid-template-columns: minmax(0, 1fr);
          }
          .picker .pickerCol:last-child {
            order: -1;
          }
        }
        @media (max-width: 1020px) {
          .grid {
            grid-template-columns: 1fr;
            gap: 24px;
          }
          .basket {
            position: static;
            order: 2;
          }
          main {
            order: 1;
          }
        }
        @media (max-width: 470px) {
          .homeGrid {
            grid-template-columns: 1fr;
          }
          .homeSuggestion {
            align-items: flex-start;
            flex-direction: column;
          }
          .list {
            grid-template-columns: 1fr;
          }
          .inline {
            flex-direction: column;
          }
          .inline .go {
            width: 100%;
          }
          .covered,
          .hoursTop {
            align-items: flex-start;
            flex-direction: column;
          }
          .sessionPrice {
            text-align: left;
          }
        }
      `}</style>
    </div>
  );
}
