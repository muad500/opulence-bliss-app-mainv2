-- Client decisions on package wording (development checklist items 37 and 38).
-- Remove the unsupported inspection-readiness claim and qualify same-day cleaning.
-- Replace only the relevant phrases to preserve other catalogue edits.

begin;

update public.packages
set description = replace(description, ' Landlord and inspection ready.', '')
where name = 'End of Tenancy / Move-In Clean'
  and service_type = 'cleaning'
  and description like '% Landlord and inspection ready.%';

update public.packages
set description = replace(
  description,
  'when time is tight.',
  'when time is tight, subject to availability.'
)
where name = 'Express Clean'
  and service_type = 'cleaning'
  and description not ilike '%subject to availability%';

commit;
