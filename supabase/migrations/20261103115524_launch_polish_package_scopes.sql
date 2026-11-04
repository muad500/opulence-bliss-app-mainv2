-- Exact scope text: client Part 2 email, 12 October 2026. No prices or old bookings change.

begin;

update public.packages set description='a one-off standard clean with no ongoing commitment, for example before guests, after a busy period, or a first trial of our service.',
    inclusions=array['Kitchen: Wipe counters, sink and taps; clean hob top; wipe the outside of small appliances (kettle, toaster, coffee machine, microwave exterior); wipe cupboard fronts where marked; empty bins.',
      'Bathrooms and toilets: Clean and disinfect toilet, sink, taps, shower/bath and tiles; polish taps; clean accessible mirrors.',
      'Living areas and bedrooms: Dust reachable surfaces, shelves and furniture; wipe visible marks on switches and handles; make beds with clean linen if left out by the client; tidy lightly.',
      'Floors: Vacuum all carpets and rugs; vacuum and mop hard floors.',
      'General: Empty all bins and replace liners if provided; leave the home tidy.',
      'Because it is the first visit to the home, the cleaner spends a few minutes at the start walking through priorities with the client or reading the booking notes.',
      'Light build-up in the kitchen and bathrooms is treated within the time booked; heavy build-up may need extra time or an upgrade to a Signature Deep Clean.',
      'Optional add-ons: interior windows, inside oven, inside fridge, ironing.']::text[],
    good_to_know=array['Indicative time: the same as Essential Clean, plus roughly 30 to 60 minutes if the home has not been cleaned recently.',
      'Not included: as for Essential Clean.']::text[]
where name='One-Time Essential Clean' and service_type='cleaning';

update public.packages set description='a quick visit that targets the areas that matter most when time is short or the home is already in good condition.',
    inclusions=array['Kitchen: wipe counters and sink; clean hob top; wipe table; empty bins.',
      'Bathroom(s): clean and disinfect toilet, sink and shower or bath; wipe mirror.',
      'Floors: vacuum and mop main walkways and hard floors in the rooms covered.',
      'Living area: quick dust of obvious surfaces; plump and tidy cushions.',
      'detailed dusting, bed changes']::text[],
    good_to_know=array['Indicative time: 2 to 2.5 hours. Fixed list only; extra tasks require extra time.',
      'Not included: interior windows, inside appliances or cupboards, skirting boards, ironing. Clients can add specific tasks at booking.']::text[]
where name='Express Clean' and service_type='cleaning';

update public.packages set description='a thorough top-to-bottom clean that removes built-up dirt and reaches the places a regular clean does not. Suitable for a first clean, seasonal or spring cleaning, or after a long gap.',
    inclusions=array['All rooms: start at the top and work down; dust ceiling corners, light fittings (reachable), fans and cobwebs; wash down walls where marks are visible; clean skirting boards, door frames, door handles, light switches and sockets; clean air vents where accessible; clean window sills and interior window glass; wipe window blinds and curtains tracks where safe; move light furniture to clean underneath.',
      'Kitchen: clean inside and outside of cupboards and drawers; clean inside and outside of oven, hob and extractor hood; clean inside and outside of fridge and freezer (defrost only if agreed); descale sink and taps; degrease tiles and splashbacks; clean small appliances inside and out; clean behind appliances where they can be moved safely.',
      'Bathrooms: descale taps, shower heads, screens and fixtures; scrub grout and tile lines; sanitise all fixtures; clean extractor fans and vents (accessible); clean inside bathroom cabinets.',
      'Bedrooms and living areas: dust and wipe all furniture, shelves and surfaces including tops and fronts; vacuum under and around furniture; vacuum upholstery surfaces; clean mirrors and glass.',
      'Floors: detailed vacuum including edges and corners; mop all hard floors.']::text[],
    good_to_know=array['Indicative time: about 3 to 6 hours depending on size and condition (for example 2 to 3 hours for a studio, 6 to 8 hours for a 5-bedroom house). Quoted per property.',
      'Add-ons: carpet or upholstery shampooing (may be subcontracted to a specialist), ironing, balcony or conservatory, inside-of-cupboards organising.',
      'Not included: exterior windows, hazardous waste, refurbishment.']::text[]
where name='Signature Deep Clean' and service_type='cleaning';

update public.packages set description='a full clean of an empty property so that it is ready for handover to a landlord or agent (move-out), or ready for a new occupant (move-in). Cleaning only, not repairs.',
    inclusions=array['All rooms: clean and dust every surface, shelf, ledge, skirting board, door and door frame; wipe light switches, sockets and handles; clean and wipe window frames, sills and interior glass; wash visible marks on walls where possible; clean ventilation grilles; clean inside and outside of all built-in cupboards, wardrobes and drawers.',
      'Kitchen: clean oven, hob, extractor hood and filters; clean inside and outside of fridge, freezer and dishwasher where supplied by the landlord; descale sink and taps; clean tiles and splashbacks; clean behind and under appliances that can be moved safely.',
      'Bathrooms and toilets: remove limescale and soap scum; scrub and sanitise all fixtures, tiles and grout; clean mirrors, cabinets and extractor fans.',
      'Floors: vacuum all floors and carpets; mop hard floors; remove light marks. (Professional carpet cleaning is an add-on.)',
      'Finish: remove any rubbish left by us; leave the property in a condition to be inspected.']::text[],
    good_to_know=array['Indicative time: quoted per property from size, number of bathrooms and condition, usually longer than a Signature Deep Clean. Property should be empty of belongings.',
      'Job functions (move-in): the same list with emphasis on sanitising kitchens, bathrooms and the inside of cupboards, wardrobes and drawers so the new occupant can unpack straight away.',
      'Add-ons: professional carpet cleaning, upholstery cleaning, internal window cleaning in hard-to-reach places, rubbish removal.',
      'Not included: repairs, painting, filling holes, descaling beyond what can be safely removed, removal of belongings. We do not guarantee the return of a deposit; the final decision rests with the landlord or agent.']::text[]
where name='End of Tenancy / Move-In Clean' and service_type='cleaning';

update public.packages set description='cleaning between guest stays so that a holiday or short-term rental is spotless and ready for the next arrival. Can be one-off or recurring, including same-day turnarounds.',
    inclusions=array['Beds and linen: strip beds, remake with fresh linen; collect used linen and towels and bag them for laundering; set out clean towels; replace pillows and throws neatly.',
      'Kitchen: clean counters, sink, hob and the outside of cupboards; wipe small appliances; clean the microwave inside; clean the oven and fridge when scheduled; remove leftover food and check the fridge; wash or load dishes; empty bins and replace liners.',
      'Bathrooms: clean and disinfect toilet, shower, bath, sink and taps; wipe mirrors; remove used toiletries and restock supplied items; replace toilet paper and soap if provided.',
      'Living areas and bedrooms: dust and wipe surfaces; sanitise high-touch points (door handles, light switches, remote controls, key box); vacuum and mop floors; clean mirrors and interior glass; tidy the property to the host''s setup.',
      'Host-specific items: arrange welcome items, check lighting, check heating or air-conditioning is set to the host''s instructions.',
      'Reporting: report any damage, stains, missing items or items left behind by guests, with photos, on the same day.',
      'Finish: lock up and confirm completion to the host; send photos where requested.']::text[],
    good_to_know=array['Indicative time: based on property size, number of beds and bathrooms, and check-out/check-in window.',
      'Not included: greeting guests, collecting keys, running the inventory check, off-site laundry (available as an add-on), restocking at our own cost.']::text[]
where name='Guest Ready' and service_type='cleaning';

commit;


