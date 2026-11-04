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

export type CleaningPackageBreakdown = {
  name: string;
  purpose: string;
  timing: string;
  tasks: readonly { area: string; work: string }[];
  jobIntro?: string;
  afterTasks?: string;
  addOns: readonly string[];
  notIncluded?: string;
};

/** Transcribed from the client's 12 October Part 2 email, not generated copy.
 * Scope wording is independent of prices, billing and historical bookings. */
export const CLEANING_PACKAGE_BREAKDOWNS: readonly CleaningPackageBreakdown[] =
  [
    ESSENTIAL_CLEAN_SCOPE,
    {
      name: "One-Time Essential Clean",
      purpose:
        "a one-off standard clean with no ongoing commitment, for example before guests, after a busy period, or a first trial of our service.",
      timing:
        "the same as Essential Clean, plus roughly 30 to 60 minutes if the home has not been cleaned recently.",
      jobIntro: "the full Essential Clean scope above, with these differences:",
      tasks: [
        ...ESSENTIAL_CLEAN_SCOPE.tasks,
        {
          area: "",
          work: "Because it is the first visit to the home, the cleaner spends a few minutes at the start walking through priorities with the client or reading the booking notes.",
        },
        {
          area: "",
          work: "Light build-up in the kitchen and bathrooms is treated within the time booked; heavy build-up may need extra time or an upgrade to a Signature Deep Clean.",
        },
        {
          area: "",
          work: "Optional add-ons: interior windows, inside oven, inside fridge, ironing.",
        },
      ],
      addOns: [],
      notIncluded: "as for Essential Clean.",
    },
    {
      name: "Express Clean",
      purpose:
        "a quick visit that targets the areas that matter most when time is short or the home is already in good condition.",
      timing:
        "2 to 2.5 hours. Fixed list only; extra tasks require extra time.",
      tasks: [
        {
          area: "Kitchen",
          work: "wipe counters and sink; clean hob top; wipe table; empty bins.",
        },
        {
          area: "Bathroom(s)",
          work: "clean and disinfect toilet, sink and shower or bath; wipe mirror.",
        },
        {
          area: "Floors",
          work: "vacuum and mop main walkways and hard floors in the rooms covered.",
        },
        {
          area: "Living area",
          work: "quick dust of obvious surfaces; plump and tidy cushions.",
        },
        { area: "", work: "detailed dusting, bed changes" },
      ],
      addOns: [],
      notIncluded:
        "interior windows, inside appliances or cupboards, skirting boards, ironing. Clients can add specific tasks at booking.",
    },
    {
      name: "Signature Deep Clean",
      purpose:
        "a thorough top-to-bottom clean that removes built-up dirt and reaches the places a regular clean does not. Suitable for a first clean, seasonal or spring cleaning, or after a long gap.",
      timing:
        "about 3 to 6 hours depending on size and condition (for example 2 to 3 hours for a studio, 6 to 8 hours for a 5-bedroom house). Quoted per property.",
      tasks: [
        {
          area: "All rooms",
          work: "start at the top and work down; dust ceiling corners, light fittings (reachable), fans and cobwebs; wash down walls where marks are visible; clean skirting boards, door frames, door handles, light switches and sockets; clean air vents where accessible; clean window sills and interior window glass; wipe window blinds and curtains tracks where safe; move light furniture to clean underneath.",
        },
        {
          area: "Kitchen",
          work: "clean inside and outside of cupboards and drawers; clean inside and outside of oven, hob and extractor hood; clean inside and outside of fridge and freezer (defrost only if agreed); descale sink and taps; degrease tiles and splashbacks; clean small appliances inside and out; clean behind appliances where they can be moved safely.",
        },
        {
          area: "Bathrooms",
          work: "descale taps, shower heads, screens and fixtures; scrub grout and tile lines; sanitise all fixtures; clean extractor fans and vents (accessible); clean inside bathroom cabinets.",
        },
        {
          area: "Bedrooms and living areas",
          work: "dust and wipe all furniture, shelves and surfaces including tops and fronts; vacuum under and around furniture; vacuum upholstery surfaces; clean mirrors and glass.",
        },
        {
          area: "Floors",
          work: "detailed vacuum including edges and corners; mop all hard floors.",
        },
      ],
      addOns: [
        "carpet or upholstery shampooing (may be subcontracted to a specialist), ironing, balcony or conservatory, inside-of-cupboards organising.",
      ],
      notIncluded: "exterior windows, hazardous waste, refurbishment.",
    },
    {
      name: "End of Tenancy / Move-In Clean",
      purpose:
        "a full clean of an empty property so that it is ready for handover to a landlord or agent (move-out), or ready for a new occupant (move-in). Cleaning only, not repairs.",
      timing:
        "quoted per property from size, number of bathrooms and condition, usually longer than a Signature Deep Clean. Property should be empty of belongings.",
      jobIntro: "Job functions (move-out)",
      tasks: [
        {
          area: "All rooms",
          work: "clean and dust every surface, shelf, ledge, skirting board, door and door frame; wipe light switches, sockets and handles; clean and wipe window frames, sills and interior glass; wash visible marks on walls where possible; clean ventilation grilles; clean inside and outside of all built-in cupboards, wardrobes and drawers.",
        },
        {
          area: "Kitchen",
          work: "clean oven, hob, extractor hood and filters; clean inside and outside of fridge, freezer and dishwasher where supplied by the landlord; descale sink and taps; clean tiles and splashbacks; clean behind and under appliances that can be moved safely.",
        },
        {
          area: "Bathrooms and toilets",
          work: "remove limescale and soap scum; scrub and sanitise all fixtures, tiles and grout; clean mirrors, cabinets and extractor fans.",
        },
        {
          area: "Floors",
          work: "vacuum all floors and carpets; mop hard floors; remove light marks. (Professional carpet cleaning is an add-on.)",
        },
        {
          area: "Finish",
          work: "remove any rubbish left by us; leave the property in a condition to be inspected.",
        },
      ],
      afterTasks:
        "Job functions (move-in): the same list with emphasis on sanitising kitchens, bathrooms and the inside of cupboards, wardrobes and drawers so the new occupant can unpack straight away.",
      addOns: [
        "professional carpet cleaning, upholstery cleaning, internal window cleaning in hard-to-reach places, rubbish removal.",
      ],
      notIncluded:
        "repairs, painting, filling holes, descaling beyond what can be safely removed, removal of belongings. We do not guarantee the return of a deposit; the final decision rests with the landlord or agent.",
    },
    {
      name: "Guest Ready",
      purpose:
        "cleaning between guest stays so that a holiday or short-term rental is spotless and ready for the next arrival. Can be one-off or recurring, including same-day turnarounds.",
      timing:
        "based on property size, number of beds and bathrooms, and check-out/check-in window.",
      tasks: [
        {
          area: "Beds and linen",
          work: "strip beds, remake with fresh linen; collect used linen and towels and bag them for laundering; set out clean towels; replace pillows and throws neatly.",
        },
        {
          area: "Kitchen",
          work: "clean counters, sink, hob and the outside of cupboards; wipe small appliances; clean the microwave inside; clean the oven and fridge when scheduled; remove leftover food and check the fridge; wash or load dishes; empty bins and replace liners.",
        },
        {
          area: "Bathrooms",
          work: "clean and disinfect toilet, shower, bath, sink and taps; wipe mirrors; remove used toiletries and restock supplied items; replace toilet paper and soap if provided.",
        },
        {
          area: "Living areas and bedrooms",
          work: "dust and wipe surfaces; sanitise high-touch points (door handles, light switches, remote controls, key box); vacuum and mop floors; clean mirrors and interior glass; tidy the property to the host's setup.",
        },
        {
          area: "Host-specific items",
          work: "arrange welcome items, check lighting, check heating or air-conditioning is set to the host's instructions.",
        },
        {
          area: "Reporting",
          work: "report any damage, stains, missing items or items left behind by guests, with photos, on the same day.",
        },
        {
          area: "Finish",
          work: "lock up and confirm completion to the host; send photos where requested.",
        },
      ],
      addOns: [],
      notIncluded:
        "greeting guests, collecting keys, running the inventory check, off-site laundry (available as an add-on), restocking at our own cost.",
    },
  ];

export function cleaningPackageScope(name: string) {
  return (
    CLEANING_PACKAGE_BREAKDOWNS.find((scope) => scope.name === name) ?? null
  );
}

export function hasCleaningServiceRules(name: string) {
  return CLEANING_SESSION_ORDER.some((session) => session === name);
}

export const CLEANING_SUPPLIES_FAQ =
  'The client provides cleaning products and equipment, or chooses "Cleaner brings products" for £5 per visit. Provide a vacuum cleaner unless equipment is arranged separately. Oven £20, inside fridge £10, inside cupboards £10, interior windows £15 and ironing £15 are optional add-ons, each including up to one hour within the eight-hour visit limit.';

export const CLEANING_LAUNDRY_FAQ =
  "Ironing is available as an add-on. Laundry beyond bed linen and towels where stated is not included unless agreed in writing before the booking. Please agree any additional work before booking.";
