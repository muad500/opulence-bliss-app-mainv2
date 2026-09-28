-- Seed only the client-approved FAQs missing from a database. Staging had no FAQ
-- rows despite recording the original seed migration as applied. Production
-- already has these rows, so the NOT EXISTS guard leaves them unchanged.
begin;

insert into public.faqs (category, question, answer, sort_order)
select seed.category, seed.question, seed.answer, seed.sort_order
from (values
  ('general', 'What services do you provide?', 'We provide professional home cleaning and handyman services. Our cleaning services can include regular domestic cleaning, one-off cleaning, deep cleaning, end-of-tenancy cleaning and other cleaning tasks. Our handyman services can include furniture assembly, hanging and mounting, minor repairs, painting and decorating, and general home maintenance.', 10),
  ('general', 'Can I book a one-off or recurring service?', 'Yes. You can book a one-off service, or arrange regular cleaning on a weekly, fortnightly or monthly basis.', 20),
  ('general', 'Do I need to be at home during the service?', 'Not necessarily. If you are not present, we can arrange access to the property in advance, provided we have clear instructions and the agreed access arrangements are safe and suitable.', 30),

  ('cleaning', 'What is included in a standard clean?', 'A standard clean includes dusting, vacuuming, mopping floors, cleaning bathrooms and kitchens, wiping accessible surfaces, emptying bins and general tidying.', 10),
  ('cleaning', 'Can I choose which cleaning tasks are prioritised?', 'Tasks can be agreed on before your appointment so we can focus on the areas that matter most to you.', 20),
  ('cleaning', 'Do you offer deep cleaning?', 'Yes. Deep cleaning is available for homes that need more detailed attention. This can include areas not normally covered during a standard clean, and is subject to the condition of the property and the time booked.', 30),
  ('cleaning', 'Do you offer end-of-tenancy cleaning?', 'Yes. We can provide end-of-tenancy cleaning to help prepare a property for handover. We recommend discussing the property''s size, condition and any specific requirements before booking so we can allow enough time.', 40),
  ('cleaning', 'Can I add ironing or laundry?', 'Yes. This can be requested as an additional cleaning service. Please let us know when booking so we can allow enough time.', 50),
  ('cleaning', 'Do you clean windows?', 'Interior window cleaning may be available as an additional service. Please ask when making your booking.', 60),
  ('cleaning', 'Do cleaners bring products and equipment?', 'This depends on the service and your booking. If you have preferred products or specific equipment, please let us know in advance. We will confirm what is required before the appointment.', 70),
  ('cleaning', 'Can you clean homes with pets?', 'Yes. We are happy to clean homes with pets. Please let us know about any pets when booking so we can take appropriate precautions.', 80),

  ('handyman', 'What handyman jobs do you cover?', E'Depending on the job, our handyman services can include:\n\n• Furniture assembly\n• Shelving and curtain or blind installation\n• Picture and mirror hanging\n• TV and wall mounting\n• Minor repairs\n• Door and handle adjustments\n• Basic painting and decorating\n• General household maintenance\n• Other small home improvement jobs\n\nIf you are unsure whether we can do a particular job, send us the details or photos and we will let you know.', 10),
  ('handyman', 'Who supplies materials and parts?', 'This depends on the job. We can discuss whether you would like us to supply materials or you will provide them. Any additional materials or parts required will be agreed with you before purchase where possible.', 20),
  ('handyman', 'Do you assemble flat-pack furniture?', 'Yes. We can assemble many types of flat-pack and household furniture. Please provide the furniture details or a photo when requesting a quote.', 30),
  ('handyman', 'Can you mount shelves, mirrors, pictures or TVs?', 'We can help with suitable wall-mounting jobs such as shelves, mirrors, pictures and certain TV installations. The wall type and item weight are important, so please provide details before the appointment.', 40),
  ('handyman', 'Do you carry out electrical, gas or plumbing work?', 'Some electrical, gas and plumbing work may require a suitably qualified or certified professional. We will only undertake work that is appropriate for our service and qualifications. If a job requires specialist certification, we will let you know before proceeding.', 50),

  ('booking_pricing', 'How do I book a service?', 'Contact us with your postcode, the service you need, your preferred date and any relevant details or photos. We will then confirm availability and provide the appropriate pricing or quotation.', 10),
  ('booking_pricing', 'How is the price calculated?', 'Pricing depends on the service, the size and condition of the property, the estimated time required, the complexity of the handyman job and any additional materials required.', 20),
  ('booking_pricing', 'Are services charged hourly or at a fixed price?', 'For some services, we may provide an hourly rate, while more specific handyman or specialist jobs may be quoted as a fixed price.', 30),
  ('booking_pricing', 'Can I get an estimate or quotation before booking?', 'Yes. We can provide an estimate or quotation based on the information you provide. For some jobs, we may need photos or an in-person assessment before confirming the final price.', 40),
  ('booking_pricing', 'Is there a minimum booking time?', 'Minimum booking times may apply depending on the service. We will confirm the minimum duration when you make your booking.', 50),
  ('booking_pricing', 'Are products, materials or parts included in the price?', 'Not always. Standard cleaning supplies, specialist products and handyman materials may be treated differently depending on the service. We will explain any additional costs before the work is carried out.', 60),

  ('appointments', 'Can I choose my preferred date and time?', 'We will do our best to accommodate your preferred date and time. Availability depends on our schedule and the type of service required.', 10),
  ('appointments', 'Can I reschedule my appointment?', 'Yes. Please contact us as soon as possible if you need to change your appointment. Our cancellation and rescheduling policy may apply depending on how much notice is provided.', 20),
  ('appointments', 'What is your cancellation policy?', 'Please give us as much notice as possible. Cancellation charges may apply for late cancellations, particularly where a professional has already been allocated to your booking.', 30),
  ('appointments', 'What happens if the professional cannot access the property?', 'Please ensure we have safe and agreed access to the property. If we cannot gain access because the agreed arrangements were not followed, a cancellation or attendance charge may apply.', 40),

  ('quality', 'What should I do if I am unhappy with the service?', 'Your satisfaction is important to us. If something has been missed or you are unhappy with part of the service, contact us as soon as possible with details of the issue. Where appropriate, we will review the matter and work with you to find a reasonable solution.', 10),
  ('quality', 'Can I request the same professional again?', 'Yes, where availability allows. If you are happy with the service and would like the same professional for future appointments, let us know, and we will do our best to accommodate your request.', 20),
  ('quality', 'Are your professionals experienced?', 'We aim to work with reliable and experienced professionals who take pride in their work. The specific experience, qualifications or certifications required will depend on the type of service being provided.', 30),

  ('preparation_coverage', 'How should I prepare for a cleaning appointment?', 'Please make sure the areas you want cleaned are reasonably accessible and remove personal or valuable items. If there are particular areas you want us to prioritise, please tell us before the appointment.', 10),
  ('preparation_coverage', 'What information should I provide for a handyman quote?', E'Please provide as much information as possible, including:\n\n• A description of the job\n• Photos of the area\n• Measurements where relevant\n• The item or product being installed\n• The type of wall or surface\n• Any instructions supplied with the product\n\nThis helps us understand the job and provide a more accurate quote.', 20),
  ('preparation_coverage', 'Do you serve landlords, agents, offices and other property clients?', 'Yes. We provide cleaning and maintenance services for homeowners, tenants, landlords, letting agents, offices and other property clients.', 30),
  ('preparation_coverage', 'Which areas do you cover?', 'We currently serve selected areas. Please provide your postcode, and we will confirm whether your postcode is within our service area.', 40)
) as seed(category, question, answer, sort_order)
where not exists (
  select 1 from public.faqs existing where existing.question = seed.question
);

commit;
