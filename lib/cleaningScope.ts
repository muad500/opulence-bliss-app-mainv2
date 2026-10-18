import { CLEANING_SESSION_ORDER } from "./cleaningBooking";

/** Client-approved cleaning scope, shared by the website, apps and assistant. */
export const CLEANING_SERVICE_RULES = {
  exclusionsIntro:
    "Unless agreed in writing before the booking, none of our cleaning services include:",
  exclusions: [
    "Redecorating, repairs, filling holes, painting or any refurbishment (cleaning only).",
    "Cleaning at height beyond safe reach from the floor or a stable step stool, or exterior windows.",
    "Biohazard, human or animal waste, mould remediation beyond light surface mould, pest infestations, or hazardous waste.",
    "Moving heavy furniture or appliances, or anything the cleaner judges unsafe to move.",
    "Cleaning items that are fragile, antique, unstable or without a safe cleaning method.",
    "Laundry beyond bed linen and towels where stated, and ironing (available as an add-on).",
  ],
  preparation: [
    "Clear personal valuables, cash, documents and fragile items from the work area.",
    "Provide safe access, working water and electricity, and a vacuum cleaner unless the cleaner is booked to bring equipment.",
    "Tell us in advance about pets, allergies, delicate surfaces, and areas not to be cleaned.",
    'Supplies: the client provides products and equipment, or books the "cleaner brings supplies" option for an extra fee.',
  ],
  everyJob: [
    "Cleaners confirm the agreed scope with the client (or by checklist) before starting.",
    "Cleaners report any pre-existing damage, breakage or hazard before starting and record it with photos.",
    "Any damage or loss during the job must be reported to Opulence Bliss Ltd the same day.",
    "On completion, the cleaner completes the job checklist and, where required, sends finished-result photos.",
  ],
} as const;

export const ESSENTIAL_CLEAN_SCOPE = {
  name: "Essential Clean",
  purpose:
    "Regular upkeep of a home that is kept reasonably tidy. Weekly, fortnightly or monthly.",
  timing:
    "2 to 3 hours for a 1 to 2 bedroom home; 4 hours or more for 3+ bedrooms. Time to be set per property.",
  tasks: [
    {
      area: "Kitchen",
      work: "Wipe counters, sink and taps; clean hob top; wipe the outside of small appliances (kettle, toaster, coffee machine, microwave exterior); wipe cupboard fronts where marked; empty bins.",
    },
    {
      area: "Bathrooms and toilets",
      work: "Clean and disinfect toilet, sink, taps, shower/bath and tiles; polish taps; clean accessible mirrors.",
    },
    {
      area: "Living areas and bedrooms",
      work: "Dust reachable surfaces, shelves and furniture; wipe visible marks on switches and handles; make beds with clean linen if left out by the client; tidy lightly.",
    },
    {
      area: "Floors",
      work: "Vacuum all carpets and rugs; vacuum and mop hard floors.",
    },
    {
      area: "General",
      work: "Empty all bins and replace liners if provided; leave the home tidy.",
    },
  ],
  addOns: [
    "Inside oven or fridge",
    "Inside cupboards",
    "Interior windows",
    "Ironing",
  ],
} as const;

export function cleaningPackageScope(name: string) {
  return name === ESSENTIAL_CLEAN_SCOPE.name ? ESSENTIAL_CLEAN_SCOPE : null;
}

export function hasCleaningServiceRules(name: string) {
  return CLEANING_SESSION_ORDER.some((session) => session === name);
}

export const CLEANING_SUPPLIES_FAQ =
  'The client provides cleaning products and equipment, or chooses "Cleaner brings products" for £5 per visit. Provide a vacuum cleaner unless equipment is arranged separately. Oven £20, inside fridge £10, inside cupboards £10, interior windows £15 and ironing £15 are optional add-ons, each including up to one hour within the eight-hour visit limit.';

export const CLEANING_LAUNDRY_FAQ =
  "Ironing is available as an add-on. Laundry beyond bed linen and towels where stated is not included unless agreed in writing before the booking. Please agree any additional work before booking.";
