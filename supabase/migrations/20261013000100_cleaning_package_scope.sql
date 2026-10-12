-- Client-approved Part 2: Essential Clean scope and cleaning supplies wording.
-- No prices, durations, booking records, payment rules or legal documents change.
begin;

update public.packages
set description = 'Regular upkeep of a home that is kept reasonably tidy. Weekly, fortnightly or monthly.',
    inclusions = array[
      'Kitchen: Wipe counters, sink and taps; clean hob top; wipe the outside of small appliances (kettle, toaster, coffee machine, microwave exterior); wipe cupboard fronts where marked; empty bins.',
      'Bathrooms and toilets: Clean and disinfect toilet, sink, taps, shower/bath and tiles; polish taps; clean accessible mirrors.',
      'Living areas and bedrooms: Dust reachable surfaces, shelves and furniture; wipe visible marks on switches and handles; make beds with clean linen if left out by the client; tidy lightly.',
      'Floors: Vacuum all carpets and rugs; vacuum and mop hard floors.',
      'General: Empty all bins and replace liners if provided; leave the home tidy.'
    ]::text[]
where name = 'Essential Clean'
  and service_type = 'cleaning';

update public.faqs
set answer = 'The client provides cleaning products and equipment, or books the "cleaner brings supplies" option for an extra fee. Provide a vacuum cleaner unless the cleaner is booked to bring equipment. Any extra fee must be confirmed before the booking.'
where category = 'cleaning'
  and question = 'Do cleaners bring products and equipment?';

update public.faqs
set answer = 'Ironing is available as an add-on. Laundry beyond bed linen and towels where stated is not included unless agreed in writing before the booking. Please agree any additional work before booking.'
where category = 'cleaning'
  and question = 'Can I add ironing or laundry?';

commit;
