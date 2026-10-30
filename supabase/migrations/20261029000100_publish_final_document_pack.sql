-- Client final pack. Old accepted snapshots and published revisions are immutable.
-- This supersedes the unshipped 20261003002100 legal patch; do not apply it.
begin;
alter table public.legal_documents add column if not exists effective_date date;
alter table public.legal_documents add column if not exists pdf_sha256 text;
alter table public.legal_documents add column if not exists pdf_path text;
alter table public.legal_document_revisions add column if not exists effective_date date;
alter table public.legal_document_revisions add column if not exists pdf_sha256 text;
alter table public.legal_document_revisions add column if not exists pdf_path text;
alter table public.legal_document_revisions add column if not exists original_updated_at timestamptz;
alter table public.legal_documents drop constraint if exists legal_documents_slug_check;
alter table public.legal_documents add constraint legal_documents_slug_check check (slug in ('terms','cancellation-refund','handyman-terms','business-terms','privacy','cookies','complaints','partner-programme','cleaner-cancellation','handyman-professional-terms','safeguarding','dbs-data','professional-partner-agreement','cleaner-terms'));
create or replace function public.archive_legal_document_revision()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.legal_document_revisions
    (document_slug,title,audience,content_html,version,published,changed_by,changed_at,effective_date,pdf_sha256,pdf_path,original_updated_at)
  values (old.slug,old.title,old.audience,old.content_html,old.version,old.published,new.updated_by,now(),old.effective_date,old.pdf_sha256,old.pdf_path,old.updated_at);
  return new;
end;
$fn$;
insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'terms',
  'Customer Terms and Conditions',
  'customers',
  '<div data-final-pack="2026-10-01"><p>CUSTOMER TERMS AND CONDITIONS Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 These terms are for households that book cleaning through our platform. Businesses sign a separate written agreement.</p>' ||
      '<h2>1. About us and these terms</h2>' ||
      '<p>1.1 These terms apply between Opulence Bliss Ltd (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) and the person who books our services (&quot;you&quot;). Please read them before you book.</p>' ||
      '<p>1.2 Our details: Opulence Bliss Ltd, a company registered in England and Wales, company number</p>' ||
      '<h2>15894675. Registered office: 128 City Road, London, United Kingdom, EC1V 2NX.</h2>' ||
      '<p>Registered with the Information Commissioner&#x27;s Office (ICO) under number ZC264981. Contact: hello@opulencebliss.com.</p>' ||
      '<p>1.3 In these terms:</p>' ||
      '<p>• Booking means a cleaning visit that you book through our platform.</p>' ||
      '<p>• Cleaner means the self-employed professional who carries out your Booking.</p>' ||
      '<p>• Standard Cleaning means regular household cleaning.</p>' ||
      '<p>• Deep Cleaning means deep cleaning and end of tenancy cleaning.</p>' ||
      '<p>• Products Add-on means the optional service described in clause 5.</p>' ||
      '<p>• Booking Credit means credit applied to a later Booking, as set out in clause 13.</p>' ||
      '<p>1.4 You must be at least 18 years old and be booking for a home. When you book, we send you a confirmation by email and a contract is formed between us for that Booking. We recommend that you keep a copy of these terms.</p>' ||
      '<h2>2. Our service</h2>' ||
      '<p>2.1 We provide cleaning services at your home. We use self-employed Cleaners to carry out the work. We are responsible to you for the service under this contract.</p>' ||
      '<p>2.2 Before a Cleaner takes bookings, we check their identity and right to work, require each Cleaner to hold a basic Disclosure and Barring Service (DBS) check and show us the certificate, and ask for proof of their own public liability insurance. We also hold public liability insurance for our business.</p>' ||
      '<p>2.3 We will provide the service with reasonable care and skill and in line with what we described to you when you booked.</p>' ||
      '<p>2.4 Before you book, we will tell you what is included in Standard Cleaning and Deep Cleaning. If you want anything extra, tell us when you book.</p>' ||
      '<p>2.5 We do not clean areas that are unsafe or unsanitary, biohazards or human or animal waste, areas that need specialist equipment or cannot be reached safely, or anything that would put a Cleaner at risk. The Cleaner can decline any task they believe is unsafe.</p>' ||
      '<h2>3. Booking</h2>' ||
      '<p>3.1 You book through our platform. The minimum Booking is 2 hours.</p>' ||
      '<p>3.2 You must give us accurate information about your home, including access, parking, pets, and anything that could affect the clean or a Cleaner&#x27;s safety.</p>' ||
      '<p>3.3 We will tell you who your Cleaner is. If your Cleaner cannot attend, we will offer the Booking to another Cleaner and tell you before the visit. You may choose to cancel instead, at no charge.</p>' ||
      '<p>3.4 Where possible, we will send the same Cleaner to your regular Bookings, but we cannot guarantee this.</p>' ||
      '<p>3.5 Our guarantee, our insurance, your loyalty rewards and any referral rewards apply only to Bookings made through our platform. They do not apply if you arrange cleaning directly with a Cleaner outside the platform.</p>' ||
      '<h2>4. Prices and payment</h2>' ||
      '<p>4.1 The price shown when you book is the total price you will pay, including every mandatory charge. Our current prices are:</p>' ||
      '<p>• Standard Cleaning (regular): £18.99 per hour</p>' ||
      '<p>• Standard Cleaning (one-off): £22.99 per hour</p>' ||
      '<p>• Deep Cleaning: £25.99 per hour</p>' ||
      '<p>• Products Add-on (optional): £5 per Booking</p>' ||
      '<p>4.2 We are not registered for VAT, so no VAT is added to our prices.</p>' ||
      '<p>4.3 We take payment by card through our payment provider, Stripe. Payment is taken when you book. If you cancel in line with these terms, or we cancel, we will refund what you are owed within 14 days.</p>' ||
      '<p>4.4 If the Cleaner thinks the job needs more time, they may offer you extra hours. They will only be added if you agree, at the same hourly price. You will not be charged for extra time you have not agreed to.</p>' ||
      '<p>4.5 If a payment fails, we will tell you and may ask you to pay another way before the Booking goes ahead.</p>' ||
      '<h2>5. Cleaning products</h2>' ||
      '<p>5.1 Unless you choose the Products Add-on, you provide the cleaning products and equipment for your Booking, or tell us in advance if the Cleaner should use yours.</p>' ||
      '<p>5.2 If you choose the Products Add-on, the Cleaner brings suitable cleaning products for your Booking. You pay £5 per Booking, not per hour.</p>' ||
      '<p>5.3 Please tell us about any allergies, sensitivities or surfaces that need special care. If you asked for products and your Cleaner does not bring them, we will refund the £5.</p>' ||
      '<h2>6. Tips</h2>' ||
      '<p>6.1 Tipping is optional and does not change the price of your Booking.</p>' ||
      '<p>6.2100% of your tip goes to your Cleaner. We do not take any part of it.</p>' ||
      '<p>6.3 Once a tip has been sent to the Cleaner, we cannot usually take it back, unless you sent it by mistake and tell us promptly.</p>' ||
      '<h2>7. Your right to cancel within 14 days</h2>' ||
      '<p>7.1 Under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013, you have the right to cancel a Booking within 14 days of the date we confirm it, without giving a reason.</p>' ||
      '<p>7.2 If you want a Booking to take place within that 14-day period, you must ask us to start the service when you book. If you then cancel after the service has started, you must pay for the part already provided, in proportion to the whole Booking.</p>' ||
      '<p>7.3 If the Booking has been fully carried out within the 14 days with your express request, you can no longer cancel it.</p>' ||
      '<p>7.4 To cancel, email hello@opulencebliss.com saying clearly that you want to cancel. We will refund any payment you have made within 14 days of receiving your notice.</p>' ||
      '<p>7.5 This clause is about your legal right to cancel in the first 14 days. If you are outside this period, clause 8 applies.</p>' ||
      '<h2>8. Changing or cancelling a Booking</h2>' ||
      '<p>8.1 If you cancel a Booking, what we refund depends on how much notice you give before it starts:</p>' ||
      '<p>• 48 hours or more: full refund</p>' ||
      '<p>• 24 to 48 hours: 75% refund (25% charged)</p>' ||
      '<p>• 12 to 24 hours: 50% refund (50% charged)</p>' ||
      '<p>• Less than 12 hours, or on the day of the visit: no refund</p>' ||
      '<p>8.2 We encourage you to reschedule a Booking rather than cancel it, and we encourage our Cleaners to do the same.</p>' ||
      '<p>8.3 The percentage applies to the total you paid for the Booking, not including any tip. We charge only the amount shown above and no other fee. The charge reflects the time your Cleaner kept free for you.</p>' ||
      '<p>8.4 If the Cleaner cannot get in, or no one is available to let them in, they will wait for 15 minutes and contact you. If they still cannot start, no refund is due.</p>' ||
      '<p>8.5 If we cancel a Booking for any reason, we will refund you in full and offer you another time.</p>' ||
      '<p>8.6 If something unavoidable happens, such as illness or an emergency, please tell us. We will consider each case fairly, and we will not charge you where it would be unreasonable to do so.</p>' ||
      '<p>8.7 If a Cleaner leaves because the home is unsafe or they are treated disrespectfully, no refund is due for the time already worked and we may keep the full Booking price.</p>' ||
      '<p>8.8 Our Cancellations, Payment and Refunds Policy sets out these rules in full, including how and when refunds are paid. It forms part of these terms.</p>' ||
      '<h2>9. Your responsibilities</h2>' ||
      '<p>9.1 You must give the Cleaner safe access to your home and the areas to be cleaned, and tell them about hazards such as broken fittings, wet floors, pets or unsafe areas.</p>' ||
      '<p>9.2 Please put away valuables, cash, fragile items and anything of sentimental value. Please keep pets secure if the Cleaner asks.</p>' ||
      '<p>9.3 You must treat our Cleaners with respect. We do not tolerate harassment, discrimination, threats or violence. We may refuse to provide the service to anyone who behaves in this way.</p>' ||
      '<h2>10. If something is not right (our guarantee)</h2>' ||
      '<p>10.1 If a Booking is not carried out with reasonable care and skill, or does not match what we agreed, tell us within 48 hours by email or through the platform. Photos help.</p>' ||
      '<p>10.2 We will arrange a re-clean of the affected areas at no extra charge. If we cannot do this, or the re-clean does not put things right, we will refund you for the affected part of the Booking, or the whole Booking if appropriate.</p>' ||
      '<p>10.3 This guarantee is in addition to your legal rights under the Consumer Rights Act 2015, including your right to have the service repeated, or to a price reduction. It does not affect them.</p>' ||
      '<h2>11. Damage and insurance</h2>' ||
      '<p>11.1 Please report any damage or loss within 48 hours of the Booking, with photos if you can. We will investigate fairly and quickly.</p>' ||
      '<p>11.2 If we or a Cleaner are legally responsible for damage or loss, we will put it right, or pay reasonable compensation through our insurance or ours and the Cleaner&#x27;s.</p>' ||
      '<p>11.3 We are not responsible for damage that was there before the visit, for normal wear and tear, for fragile or valuable items you did not tell us about, or for items that were not secured, unless the law says otherwise.</p>' ||
      '<h2>12. Loyalty rewards</h2>' ||
      '<p>12.1 Free hours. After you complete 10 paid Bookings within 12 calendar months, you earn 2 hours of Standard Cleaning free. The free hours must be used within 6 months of being earned. If you want a longer clean, you pay for the extra hours at our usual price. This is a one-off reward for each customer account.</p>' ||
      '<p>12.2 If you do not complete 10 Bookings within 12 calendar months, the count restarts from your next Booking.</p>' ||
      '<p>12.3 5% off. From your 11th completed Booking onwards, you receive 5% off the price of every later Booking, for as long as you keep booking with us. The 5% applies to the Booking price only, not to tips or the Products Add-on.</p>' ||
      '<p>12.4 Only completed and paid Bookings count. Cancelled, unpaid and refunded Bookings do not.</p>' ||
      '<p>12.5 Loyalty rewards cannot be combined with other offers, apart from the referral discount in clause</p>' ||
      '<h2>13. They have no cash value and cannot be transferred.</h2>' ||
      '<p>12.6 We may change or end the loyalty rewards by giving you at least 30 days&#x27; notice. Rewards you have already earned will be honoured.</p>' ||
      '<h2>13. Referring friends</h2>' ||
      '<p>13.1 If you refer a new household to us through your personal link or code, you both get £10. The reward is paid in two parts: £5 after your friend&#x27;s first Booking is completed and paid, and £5 after their second. Your friend receives £5 off their first booking and £5 off their second.</p>' ||
      '<p>13.2 If you are a customer and have not registered as a Partner, your reward is given as Booking Credit, applied to your next Booking on the platform. It is not paid in cash.</p>' ||
      '<p>13.3 Booking Credit has no cash value, cannot be transferred, and is lost if your account is closed. Booking Credit expires 12 months after it is issued.</p>' ||
      '<p>13.4 A new household is one that has never been booked with us. A referral must be made through your link or code before your friend books. You cannot refer yourself or someone who lives at your address. We do not pay a reward on a Booking that is cancelled, unpaid or refunded.</p>' ||
      '<p>13.5 If you would like to earn gift cards instead, you can register as a Partner and the Partner Programme terms will apply to you.</p>' ||
      '<h2>14. Complaints</h2>' ||
      '<p>14.1 If you are unhappy, please contact us at hello@opulencebliss.com. We will acknowledge your complaint within 3 working days and aim to reply in full within 14 days. Our Complaints Procedure explains each stage.</p>' ||
      '<p>14.2 If we cannot resolve your complaint, we will tell you in writing. We do not currently use an alternative dispute resolution (ADR) provider. You can take legal action in the courts, and you can get free advice about your rights from Citizens Advice.</p>' ||
      '<h2>15. Your information (data protection)</h2>' ||
      '<p>15.1 We are the controller of your personal information. We are registered with the ICO under number ZC264981. Our privacy notice explains what we collect, why, who we share it with and how long we keep it.</p>' ||
      '<p>15.2 We use your information to run your Bookings, take payment, keep you and our Cleaners safe, prevent fraud, meet our legal duties and, where you have agreed, send you offers.</p>' ||
      '<p>15.3 We share your name, address, access details and relevant notes with your Cleaner so they can carry out the Booking. We share payment details only with Stripe.</p>' ||
      '<p>15.4 You can ask to see, correct or delete your information, object to how we use it, withdraw your consent to marketing at any time, and complain to the ICO or any successor regulator. If you want to complain to us about how we handle your information, email hello@opulencebliss.com. We will acknowledge your complaint within 3 working days and reply without undue delay, and within 30 days in any case.</p>' ||
      '<h2>16. Our liability</h2>' ||
      '<p>16.1 Nothing in these terms excludes or limits our liability for death or personal injury caused by our negligence, for fraud, or for anything else that cannot be excluded by law. Nothing affects your legal rights as a consumer.</p>' ||
      '<p>16.2 Subject to clause 16.1, we are responsible for foreseeable loss or damage caused by our breach of these terms or by our failure to use reasonable care and skill. We are not responsible for loss that was not foreseeable, or for any business losses, because we provide the service for domestic use only.</p>' ||
      '<p>16.3 We are not responsible for delays or failures caused by events outside our reasonable control. We will tell you promptly if this affects a booking.</p>' ||
      '<h2>17. Changes to these terms</h2>' ||
      '<p>17.1 We may update these terms. We will give you at least 30 days&#x27; notice of changes that affect you. A change applies to Bookings made after it takes effect.</p>' ||
      '<h2>18. General</h2>' ||
      '<p>18.1 These terms are the whole agreement between us about our services and replace earlier discussions.</p>' ||
      '<p>18.2 If any part is found to be unenforceable, the rest continues to apply.</p>' ||
      '<p>18.3 If we delay in enforcing a right, we have not given it up.</p>' ||
      '<p>18.4 You may not transfer your Booking to someone else without our written consent. We may transfer our rights to another company if it carries on the business, and we will tell you.</p>' ||
      '<p>18.5 Only you and we have rights under these terms. Nobody else can enforce them under the Contracts (Rights of Third Parties) Act 1999.</p>' ||
      '<p>18.6 We may give you notices by email to the address on your account, and you may give us notices at hello@opulencebliss.com.</p>' ||
      '<p>18.7 These terms are governed by the law of England and Wales. If you live in England or Wales, the courts of England and Wales have jurisdiction. If you live in Scotland or Northern Ireland, you may also bring legal action in the courts of your home country.</p>' ||
      '<h2>19. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 ICO registration number: ZC264981 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  '1da1c96a64ea17322c3ba707d6a85022887fcf28f4fa88413b9254e8784a057f',
  '2026-10-01/terms.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'cancellation-refund',
  'Cancellations, Payment and Refunds Policy',
  'customers',
  '<div data-final-pack="2026-10-01"><p>CANCELLATIONS, PAYMENT AND REFUNDS POLICY Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 This policy is part of our Customer Terms and Conditions. It applies to households that book cleaning through our platform. Businesses are covered by their written agreement.</p>' ||
      '<h2>1. About this policy</h2>' ||
      '<p>1.1 This policy explains how payment works, how to change or cancel a Booking, and when you get a refund. It should be read with our Customer Terms and Conditions. If there is a conflict, this policy applies to payment, cancellation and refunds.</p>' ||
      '<p>1.2 In this policy, &quot;we&quot;, &quot;us&quot; and &quot;our&quot; mean Opulence Bliss Ltd, company number 15894675, registered office 128 City Road, London, United Kingdom, EC1V 2NX. &quot;Booking&quot;, &quot;Cleaner&quot;, &quot;Standard Cleaning&quot;, &quot;Deep Cleaning&quot;, &quot;Products Add-on&quot; and &quot;Booking Credit&quot; have the same meaning as in the Customer Terms.</p>' ||
      '<p>1.3 This policy does not affect your legal rights under the Consumer Rights Act 2015 or the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.</p>' ||
      '<h2>2. Prices and what you pay</h2>' ||
      '<p>2.1 The price shown when you book is the total price you pay, including every mandatory charge. We do not charge a booking fee.</p>' ||
      '<p>2.2 The minimum Booking is 2 hours. Our current prices are:</p>' ||
      '<p>• Standard Cleaning (regular): £18.99 per hour</p>' ||
      '<p>• Standard Cleaning (one-off): £22.99 per hour</p>' ||
      '<p>• Deep Cleaning: £25.99 per hour</p>' ||
      '<p>• Products Add-on (optional): £5 per Booking</p>' ||
      '<p>2.3 We are not registered for VAT, so no VAT is added.</p>' ||
      '<p>2.4 If the Cleaner thinks the job needs more time, they may offer extra hours. These are added only if you agree, at the same hourly price. You will not be charged for time you have not agreed to.</p>' ||
      '<p>2.5 If we change our prices, we will give you at least 30 days&#x27; notice for any regular Booking. The price you agreed when you booked does not change for that Booking.</p>' ||
      '<h2>3. How payment works</h2>' ||
      '<p>3.1 We take payment by debit or credit card through our payment provider, Stripe. We do not see or store your full card number.</p>' ||
      '<p>3.2 Payment is taken when you book. For regular Bookings, we take payment for each visit when it is booked or scheduled, and we will tell you before each payment is taken.</p>' ||
      '<p>3.3 When you book, you agree that we may store your card with Stripe and charge it for Bookings, extra hours you agree to, and any cancellation charge that applies under this policy. You can remove your card or stop a regular Booking at any time, subject to clause 5.</p>' ||
      '<p>3.4 We send you a confirmation and a receipt by email for every payment.</p>' ||
      '<p>3.5 If a payment fails, we will tell you and may ask you to pay another way. A Booking may not go ahead until payment is made. If payment is still not made, we will contact you before the visit and may have to cancel the Booking. If we cancel for this reason, we will tell you, and no cancellation charge applies.</p>' ||
      '<p>3.6 Tips are optional, are paid to your Cleaner in full and are not part of the Booking price (see clause 8).</p>' ||
      '<p>3.7 If you think a charge is wrong, contact us at hello@opulencebliss.com before you contact your bank. We will look into it promptly and correct any mistake. This does not affect any right you have to ask your bank for a refund.</p>' ||
      '<h2>4. Your 14-day right to cancel</h2>' ||
      '<p>4.1 You have the legal right to cancel a Booking within 14 days of the date we confirm it, without giving a reason, under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013.</p>' ||
      '<p>4.2 If you want a Booking to take place within those 14 days, you must ask us to start the service when you book. If you then cancel after the service has started, you must pay for the part already provided, in proportion to the whole Booking.</p>' ||
      '<p>4.3 If the Booking has been fully carried out within the 14 days at your express request, you can no longer cancel it. We will explain this to you when you book.</p>' ||
      '<p>4.4 To cancel, email hello@opulencebliss.com saying clearly that you want to cancel, or use the cancellation option in your account. You may use the model cancellation form on request, but you do not have to.</p>' ||
      '<p>4.5 We will refund what you have paid, less any amount due under clause 4.2, within 14 days of receiving your notice.</p>' ||
      '<p>4.6 This right is about your first 14 days. It does not remove your right to cancel under clause 5 after that.</p>' ||
      '<h2>5. Changing or cancelling a Booking</h2>' ||
      '<p>5.1 If you cancel a Booking, what we refund depends on how much notice you give before the Booking starts:</p>' ||
      '<p>• 48 hours or more: full refund (nothing is charged)</p>' ||
      '<p>• 24 to 48 hours: 75% refund (25% charged)</p>' ||
      '<p>• 12 to 24 hours: 50% refund (50% charged)</p>' ||
      '<p>• Less than 12 hours, or on the day of the visit: no refund</p>' ||
      '<p>5.2 We encourage you to reschedule your Booking rather than cancel it. If you move it to a new time with us or your Cleaner, the rules in clause 5.4 apply.</p>' ||
      '<p>5.3 The percentage applies to the total you paid for the Booking, not including any tip. We charge only the amount shown above and no other fee. The charge reflects the time your Cleaner kept free for you and the difficulty of finding them other work at short notice.</p>' ||
      '<p>5.4 Rescheduling. If you move a Booking to a new date, the same notice periods apply to the original time. You can reschedule free of charge if you give 48 hours or more notice. If you give less, the amounts in clause 5.1 apply to the original Booking.</p>' ||
      '<p>5.5 Cleaner cannot get in: if the Cleaner arrives and cannot get in, or no one is available to let them in, they will wait for 15 minutes and try to contact you. If they still cannot start, no refund is due.</p>' ||
      '<p>5.6 Cancelling during a visit: if you ask the Cleaner to stop part-way through, you pay for the time already worked, and for any time already agreed that the Cleaner cannot fill. This does not apply if the Cleaner is not doing the job with reasonable care and skill.</p>' ||
      '<p>5.7 Unavoidable events: if you cannot keep a Booking because of illness, bereavement, a medical or other emergency, or something else outside your control, please tell us as soon as you can. We will consider each case fairly and we will not charge you where it would be unreasonable to do so.</p>' ||
      '<p>5.8 Unsafe homes or poor behaviour: if a Cleaner leaves because the home is unsafe, or because they are treated disrespectfully or threatened, no refund is due for the time already worked and we may keep the full Booking price.</p>' ||
      '<p>5.9 Regular Bookings: you can pause or end a regular Booking at any time. Each visit is treated as a separate Booking for the rules in this clause 5. We do not charge you any fee for ending a regular Booking.</p>' ||
      '<p>5.10 A cancellation charge is a reasonable amount to cover the cost of a Cleaner holding their time. We will never charge you more than the price of the Booking.</p>' ||
      '<h2>6. If we cancel or change a Booking</h2>' ||
      '<p>6.1 If we cancel a Booking for any reason, we will tell you as soon as we can, refund you in full and offer you another time. You do not pay anything.</p>' ||
      '<p>6.2 If your Cleaner cannot attend, we will offer the Booking to another Cleaner and tell you before the visit. You can accept the new Cleaner, choose another time, or cancel and receive a full refund.</p>' ||
      '<p>6.3 If a Cleaner does not arrive and we have not told you, we will refund you in full, treat your rebooking as a priority, and consider what else we should do to put things right, for example a goodwill credit.</p>' ||
      '<p>6.4 If we need to change the time of a Booking, we will ask you first. You can choose another time or cancel for a full refund.</p>' ||
      '<h2>7. Refunds</h2>' ||
      '<p>7.1 Our guarantee. If a Booking is not carried out with reasonable care and skill, tell us within 48 hours by email or through the platform. Photos help. We will arrange a re-clean of the affected areas at no extra charge. If we cannot, or the re-clean does not put things right, we will refund you for the affected part of the Booking, or the whole Booking if appropriate.</p>' ||
      '<p>7.2 Products Add-on. If you chose the Products Add-on and your Cleaner did not bring the products, we will refund the £5.</p>' ||
      '<p>7.3 Wrong or duplicate charges. If we charge you more than we should, or twice, we will refund the difference.</p>' ||
      '<p>7.4 Cancellations. Refunds for cancellations are as set out in clauses 4, 5 and 6.</p>' ||
      '<p>7.5 Your legal rights. Nothing in this policy limits your right under the Consumer Rights Act 2015 to have a service repeated or to a price reduction if it is not carried out with reasonable care and skill, or does not match what we agreed.</p>' ||
      '<p>7.6 No refund is due for a Booking that has been carried out with reasonable care and skill, for a cancellation charge that applies under clause 5, or for time you chose to end early, except where clause 5.7 or your legal rights apply.</p>' ||
      '<p>7.7 Damage. Claims for damage or loss are dealt with under clause 11 of the Customer Terms and not as a refund. Please report any damage within 48 hours.</p>' ||
      '<h2>8. Tips</h2>' ||
      '<p>8.1 Tips are optional and do not change your Booking price.</p>' ||
      '<p>8.2100% of your tip goes to your Cleaner. We do not take any part of it.</p>' ||
      '<p>8.3 Once a tip has been sent, we cannot usually take it back, unless you sent it by mistake or sent the wrong amount and you tell us promptly. In that case we will ask your Cleaner and, where the tip has not been paid out, refund it.</p>' ||
      '<h2>9. How refunds are made</h2>' ||
      '<p>9.1 We refund you to the card you paid with, unless you ask for Booking Credit instead. We cannot refund to a different card or in cash.</p>' ||
      '<p>9.2 We will make the refund as soon as possible and within 14 days of the day we agree that you are owed it. For the 14-day cancellation right, the 14 days run from the day we receive your notice.</p>' ||
      '<p>9.3 Once we have sent the refund, your bank or card provider may take several working days to show it in your account. This is outside our control.</p>' ||
      '<p>9.4 If you choose Booking Credit instead of a refund to your card, it is applied to your next Booking and expires 12 months after it is issued. Booking Credit has no cash value and cannot be transferred.</p>' ||
      '<p>9.5 We do not charge you a fee for a refund.</p>' ||
      '<h2>10. Loyalty rewards and referral credit when you cancel or are refunded</h2>' ||
      '<p>10.1 Only completed and paid Bookings count towards loyalty rewards. A cancelled, unpaid or refunded Booking does not count.</p>' ||
      '<p>10.2 If we refund a Booking for which you used a free-hours reward or Booking Credit, we will return the free hours or the credit to your account. Free hours still expire 6 months after they were earned, and Booking Credit expires 12 months after it was issued.</p>' ||
      '<p>10.3 If a Booking that earned a referral reward is cancelled, unpaid or refunded, the reward for that Booking is not paid. If a reward has already been given, we may take it back from your future rewards.</p>' ||
      '<p>10.4 The 5% loyalty discount is taken off the Booking price. It is not refunded separately from the Booking.</p>' ||
      '<h2>11. Chargebacks and disputes with your card provider</h2>' ||
      '<p>11.1 We would like to put things right with you first. Please contact us before asking your bank for a chargeback.</p>' ||
      '<p>11.2 If you ask your bank to reverse a payment, we will give the bank the evidence it asks for, including your Booking, our messages and the Cleaner&#x27;s record of the visit.</p>' ||
      '<p>11.3 If a chargeback is upheld in your favour, we will accept the bank&#x27;s decision. We will not charge you more than the amount that is properly due under this policy. If you are refunded by your bank for a Booking, we will not also refund you for it.</p>' ||
      '<h2>12. Complaints</h2>' ||
      '<p>12.1 If you are unhappy about a cancellation charge, a payment or a refund, email hello@opulencebliss.com. We will acknowledge your complaint within 3 working days and aim to reply in full within 14 days. Our Complaints Procedure explains each stage.</p>' ||
      '<p>12.2 If we cannot resolve your complaint, we will tell you in writing. We do not currently use an alternative dispute resolution (ADR) provider. You can take legal action in the courts, and you can get free advice about your rights from Citizens Advice.</p>' ||
      '<h2>13. Changes to this policy</h2>' ||
      '<p>13.1 We may change this policy by giving you at least 30 days&#x27; notice of changes that affect you. A change applies to Bookings made after it takes effect. A Booking you have already made is not affected.</p>' ||
      '<p>13.2 We keep a record of earlier versions of this policy.</p>' ||
      '<h2>14. Governing law</h2>' ||
      '<p>14.1 This policy is governed by the law of England and Wales. If you live in England or Wales, the courts of England and Wales have jurisdiction. If you live in Scotland or Northern Ireland, you may also bring legal action in the courts of your home country.</p>' ||
      '<h2>15. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 ICO registration number: ZC264981 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  '8b643b1abf4a6bc8abbb7a5bf8763393a6b824fd18a4dd9e3cfd69678c2fc0fd',
  '2026-10-01/cancellation-refund.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'handyman-terms',
  'Handyman Services Terms for Customers',
  'customers',
  '<div data-final-pack="2026-10-01"><p>HANDYMAN SERVICES TERMS FOR CUSTOMERS Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 These terms apply when you book handyman, repair or installation work through our platform. They are in addition to our Customer Terms and Conditions and our Cancellations, Payment and Refunds Policy. If there is a conflict on handyman work, these terms apply.</p>' ||
      '<h2>1. About these terms</h2>' ||
      '<p>1.1 These terms apply between Opulence Bliss Ltd (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;), company number 15894675, registered office 128 City Road, London, United Kingdom, EC1V 2NX, and you, a household customer who books handyman work (&quot;Job&quot;). Contact: hello@opulencebliss.com.</p>' ||
      '<p>1.2 Jobs are carried out by self-employed handymen (&quot;Handyman&quot;) who meet our checks. We are responsible to you for the service under this contract.</p>' ||
      '<p>1.3 Before we confirm a Job, we check each Handyman&#x27;s identity, right to work, qualifications and registrations, basic DBS certificate and public liability insurance.</p>' ||
      '<h2>2. Quotes and booking</h2>' ||
      '<p>2.1 You describe the Job and send photos or videos if you can. A Handyman gives you a written Quote through the platform, showing the price for Labour (workmanship and time) and for Materials separately. The Quote shows the total you will pay. We do not charge a call-out fee or booking fee.</p>' ||
      '<p>2.2 A Quote is open for 30 days unless it says otherwise. A contract for the Job starts when you accept the Quote and book a date, and we confirm it by email.</p>' ||
      '<p>2.3 Some Jobs need the Handyman to see the work before quoting. We do not charge for a site visit to give a Quote. If you cancel an agreed site visit with less than 24 hours&#x27; notice, we may ask for a fair contribution towards the Handyman&#x27;s time, which we will tell you about first.</p>' ||
      '<p>2.4 If the Job turns out to need more time or materials than the Quote, the Handyman must tell you and get your agreement through the platform before doing any extra work. You will not be charged for anything you have not agreed to.</p>' ||
      '<h2>3. Materials</h2>' ||
      '<p>3.1 You can buy the Materials yourself, or pay us for them and the Handyman will buy them. If the Handyman buys them, you pay the cost shown on the receipt, at cost, with no mark-up from us.</p>' ||
      '<p>3.2 The Materials estimate in the Quote may change only with your agreement (clause 2.4). If the final cost is lower, we refund or credit the difference.</p>' ||
      '<p>3.3 Materials that have been bought and fitted, or specially ordered for you, are paid for in full. Materials that are unused and can be returned will be refunded.</p>' ||
      '<p>3.4 Where you choose the Materials against the Handyman&#x27;s advice, the Handyman is not responsible for faults caused by those Materials.</p>' ||
      '<h2>4. Payment</h2>' ||
      '<p>4.1 We take payment by card through Stripe when you accept the Quote and book. For larger Jobs, the Quote may split the Labour into stages. We will tell you before each payment is taken.</p>' ||
      '<p>4.2 We are not registered for VAT, so no VAT is added.</p>' ||
      '<p>4.3 Tips are optional and 100% goes to the Handyman.</p>' ||
      '<p>4.4 Refunds are made as set out in our Cancellations, Payment and Refunds Policy, within 14 days.</p>' ||
      '<h2>5. Gas, electrical and other regulated work</h2>' ||
      '<p>5.1 Gas work is carried out only by a Handyman on the Gas Safe Register for that work. Notifiable electrical work is carried out only by a Handyman registered with a competent person scheme, or the work is notified to Building Control as the law requires. You can ask to see the Handyman&#x27;s registration card or certificate.</p>' ||
      '<p>5.2 After gas or electrical work, we make sure you get the proper certificate (for example a gas safety record, an Electrical Installation Certificate or a Minor Works Certificate) and any building-regulations notification. Please keep them safe, because you may need them to sell or let your home.</p>' ||
      '<p>5.3 We do not carry out work involving asbestos or structural work. If the Handyman finds asbestos or an unsafe structure, they will stop and tell you.</p>' ||
      '<p>5.4 If you are a landlord, you remain responsible for your own legal duties, such as gas safety checks. Our certificate does not replace advice from your lettings agent or solicitor.</p>' ||
      '<h2>6. Your responsibilities</h2>' ||
      '<p>6.1 You must give safe access to the property and the work area, tell us about hazards, pets, shut-off points (water, gas, electricity) and anything that could affect the Job, and make sure you have permission from the owner or landlord for the work.</p>' ||
      '<p>6.2 Please protect valuables and clear the work area. Tell the Handyman if there is anything fragile or valuable nearby.</p>' ||
      '<p>6.3 You must treat our Handymen with respect. We do not tolerate harassment, discrimination, threats or violence.</p>' ||
      '<h2>7. Your right to cancel within 14 days</h2>' ||
      '<p>7.1 Under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013, you have the right to cancel within 14 days of the date we confirm the Job, without giving a reason.</p>' ||
      '<p>7.2 If you want the Job to start within the 14 days, you must ask us to start when you book. If you then cancel after work has started, you must pay for the work already done in proportion to the whole Job, and for Materials already bought.</p>' ||
      '<p>7.3 If the Job is fully carried out within the 14 days at your express request, you can no longer cancel it.</p>' ||
      '<p>7.4 Emergency repairs. If you ask us to attend urgently to deal with an emergency in your home, for example a burst pipe or a gas leak, and the work is done during the emergency, you cannot cancel that work, but you can cancel any other work you agree to on that visit.</p>' ||
      '<p>7.5 To cancel, email hello@opulencebliss.com. We will refund what you have paid, less any amount due under this clause, within 14 days.</p>' ||
      '<h2>8. Changing or cancelling a Job</h2>' ||
      '<p>8.1 If you cancel after the 14-day period, what we refund of the Labour depends on your notice before the start:</p>' ||
      '<p>• 48 hours or more: full refund</p>' ||
      '<p>• 24 to 48 hours: 75% refund (25% charged)</p>' ||
      '<p>• 12 to 24 hours: 50% refund (50% charged)</p>' ||
      '<p>• Less than 12 hours, or on the day of the visit: no refund</p>' ||
      '<p>8.2 We charge only the amount above, and no other fee. Materials are dealt with under clause 3.3.</p>' ||
      '<p>8.3 We encourage you to reschedule a Job rather than cancel it. We also encourage our Handymen to do so.</p>' ||
      '<p>8.4 If we or the Handyman cancel, we will refund you in full and offer you another time. If the Handyman does not attend and has not told us, we will refund you in full and treat your rebooking as a priority.</p>' ||
      '<p>8.5 If something unavoidable happens, such as illness or an emergency, please tell us. We will consider each case fairly and will not charge you where it would be unreasonable.</p>' ||
      '<h2>9. Workmanship guarantee</h2>' ||
      '<p>9.1 The Handyman will carry out the Job with reasonable care and skill. We guarantee the workmanship for 30 days from completion.</p>' ||
      '<p>9.2 If you find a defect in the workmanship in that time, tell us within 48 hours of noticing it if you can, with photos. We will arrange for it to be put right at no extra charge, usually within 7 days. If we cannot, we will refund you for the affected work.</p>' ||
      '<p>9.3 The guarantee does not cover faults in Materials you chose against the Handyman&#x27;s advice, damage caused by you or others after the Job, or normal wear and tear.</p>' ||
      '<p>9.4 This guarantee is in addition to your legal rights under the Consumer Rights Act 2015, including to have the service repeated or to a price reduction. It does not affect them.</p>' ||
      '<h2>10. Damage and insurance</h2>' ||
      '<p>10.1 Please report any damage or loss as soon as you notice it and within 48 hours of the Job, with photos if you can. We will investigate fairly and quickly.</p>' ||
      '<p>10.2 If we or a Handyman are legally responsible for damage or loss, we will put it right or pay reasonable compensation through our insurance or the Handyman&#x27;s.</p>' ||
      '<p>10.3 We are not responsible for damage that was there before the visit, for hidden faults in the property that could not reasonably have been seen, or for normal wear and tear, unless the law says otherwise.</p>' ||
      '<h2>11. Complaints and your information</h2>' ||
      '<p>11.1 If you are unhappy, contact us at hello@opulencebliss.com. We will acknowledge your complaint within 3 working days and aim to reply in full within 14 days. Our Complaints Procedure explains each stage. We do not currently use an alternative dispute resolution provider. You can take legal action in the courts, and get free advice from Citizens Advice.</p>' ||
      '<p>11.2 We are the controller of your personal information, as set out in our privacy notice, available on our website. We share your name, address and Job details with the Handyman so they can do the work.</p>' ||
      '<h2>12. Our liability and general</h2>' ||
      '<p>12.1 Nothing in these terms excludes or limits our liability for death or personal injury caused by negligence, for fraud or for anything that cannot be excluded by law. Nothing affects your legal rights as a consumer.</p>' ||
      '<p>12.2 We are responsible for foreseeable loss or damage caused by our breach or failure to use reasonable care and skill. We are not responsible for loss that was not foreseeable, or for any business losses, because we provide the service for domestic use.</p>' ||
      '<p>12.3 We may update these terms by giving you at least 30 days&#x27; notice of changes. A change applies to Jobs booked after it takes effect.</p>' ||
      '<p>12.4 These terms are governed by the law of England and Wales. If you live in England or Wales, its courts have jurisdiction. If you live in Scotland or Northern Ireland, you may also bring action in your home courts. Only you and we have rights under these terms under the Contracts (Rights of Third Parties) Act 1999.</p>' ||
      '<h2>13. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 ICO registration number: ZC264981 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  '1604794925e7af7dd70ee2d1b6f817a22c796a885cde260ba2cdb67d84d002a4',
  '2026-10-01/handyman-terms.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'business-terms',
  'Business Terms and Conditions',
  'customers',
  '<div data-final-pack="2026-10-01"><p>BUSINESS TERMS AND CONDITIONS Commercial Cleaning Services | Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 These terms apply to businesses that buy cleaning services from us. They are made up of three parts: Part 1 (Terms and Conditions), Part 2 (Cancellation and Payment Policy) and Part 3 (Privacy Notice). Together with our written quote, they form the agreement between us and the Client. Households are covered by our Customer Terms and Conditions. Part 1: Terms and Conditions</p>' ||
      '<h2>1. About us and these terms</h2>' ||
      '<p>1.1 Opulence Bliss Ltd (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;), a company registered in England and Wales, company number 15894675, registered office 128 City Road, London, United Kingdom, EC1V 2NX, provides commercial cleaning services to businesses (&quot;the Client&quot;, &quot;you&quot;). We are registered with the Information Commissioner&#x27;s Office (ICO) under number ZC264981.</p>' ||
      '<p>1.2 Contact: hello@opulencebliss.com, +44 7484 717935.</p>' ||
      '<p>1.3 In these terms:</p>' ||
      '<p>• Services means the cleaning services described in our written quote, including the agreed days, times, areas and tasks.</p>' ||
      '<p>• Contract means these terms together with our written quote.</p>' ||
      '<p>• Start Date means the date the Services begin, as we confirm in writing.</p>' ||
      '<p>• Trial Period means the first 4 weeks from the Start Date.</p>' ||
      '<p>• Minimum Term means the first 12 months from the Start Date, including the Trial Period.</p>' ||
      '<p>• Cleaner means a self-employed professional who carries out the Services on our behalf.</p>' ||
      '<p>1.4 These terms are for businesses. By accepting our quote, you confirm that you are buying the Services for the purposes of your business, and that the person accepting has authority to bind the Client.</p>' ||
      '<h2>2. The Services and how a Contract starts</h2>' ||
      '<p>2.1 We will provide the Services with reasonable skill and care.</p>' ||
      '<p>2.2 An enquiry form is not a contract. A Contract begins when the Client accepts our written quote and we confirm a Start Date in writing.</p>' ||
      '<p>2.3 Any change to the Services, such as extra hours, extra areas or one-off deep cleans, must be agreed in writing (email is sufficient) and may change the price.</p>' ||
      '<p>2.4 If the terms in our quote differ from these terms, the quote applies to the points it covers. Your own terms and conditions, or any purchase-order terms, do not apply unless we have agreed them in writing.</p>' ||
      '<h2>3. Prices and payment</h2>' ||
      '<p>3.1 Prices are as stated in our written quote.</p>' ||
      '<p>3.2 We are not registered for VAT, so no VAT is added to our prices. If we become registered for VAT during the Contract, we will tell you in writing and VAT will be added to our prices at the rate that applies from that date.</p>' ||
      '<p>3.3 The Client must provide all cleaning supplies and equipment needed for the Services, including cleaning products, consumables (such as soap, shampoo, toilet roll and refills) and equipment (such as vacuum cleaners, mops, buckets and cloths), and must keep them available at the premises. We do not supply them unless we agree otherwise in writing.</p>' ||
      '<p>3.4 We invoice at the frequency stated in our quote (weekly, fortnightly or monthly), in advance or in arrears as agreed. Invoices are payable within 14 days of the invoice date by bank transfer or another method agreed in writing. Invoices show the period covered, the number of visits and the price.</p>' ||
      '<p>3.5 If you dispute an invoice, tell us within 7 days of receiving it and pay the part that is not in dispute. We will work with you to resolve the dispute quickly.</p>' ||
      '<p>3.6 If an invoice is not paid on time, we may suspend the Services after giving 7 days&#x27; written notice. We may also charge interest and compensation under the Late Payment of Commercial Debts (Interest) Act 1998, which is interest at 8% above the Bank of England base rate and the fixed sum for recovery costs that the Act allows.</p>' ||
      '<p>3.7 We may review prices once every 12 months, or sooner if there is a change in law (for example the National Minimum Wage or the National Living Wage) that affects our costs. We will give at least 30 days&#x27; written notice of any increase. Prices in the quote do not change during the first 12 months, unless a change in law applies.</p>' ||
      '<h2>4. Trial Period, minimum term and ending the Contract</h2>' ||
      '<p>4.1 The first 4 weeks are a Trial Period. During the Trial Period, either of us may end the Contract by giving 7 days&#x27; written notice.</p>' ||
      '<p>4.2 After the Trial Period, the Contract continues for the rest of the Minimum Term of 12 months from the Start Date. After the Minimum Term, the Contract continues until either of us ends it by giving 30 days&#x27; written notice.</p>' ||
      '<p>4.3 During the Minimum Term (after the Trial Period) neither of us may end the Contract early, except as set out in clauses 4.4 and 4.5. If you want to end the Contract early for any other reason, you must pay an early termination fee of 25% of the fees that would have been due for the rest of the Minimum Term, up to a maximum of 3 months&#x27; fees. The parties agree this is a fair estimate of our loss from losing planned work, including the cost of the Cleaners and time we have set aside for you, and not a penalty.</p>' ||
      '<p>4.4 Either of us may end the Contract immediately by written notice if the other:</p>' ||
      '<p>• seriously breaches the Contract and does not fix the problem within 7 days of written notice; or</p>' ||
      '<p>• becomes insolvent, enters administration or liquidation, or stops trading.</p>' ||
      '<p>4.5 We may end the Contract immediately if you or your premises put our Cleaners at serious risk, or you or your staff abuse, threaten or discriminate against a Cleaner.</p>' ||
      '<p>4.6 Notice must be sent by email to hello@opulencebliss.com (or to the Client&#x27;s contact email on the quote) and takes effect from the day the other party confirms receipt.</p>' ||
      '<p>4.7 When the Contract ends, you must pay for Services provided up to the end date. We will return keys, codes and fobs promptly and delete access information (see Part 3).</p>' ||
      '<h2>5. Quality and complaints</h2>' ||
      '<p>5.1 We will carry out the Services using the agreed checklist for each visit.</p>' ||
      '<p>5.2 We will carry out supervisor spot checks once a month and, if you wish, hold a review meeting or call each month.</p>' ||
      '<p>5.3 If you are not satisfied with a visit, tell us within 24 hours by phone, WhatsApp or email. We will return to fix the problem free of charge within 48 hours where reasonably possible. If we cannot do so, we will credit the cost of the affected part of the visit to your next invoice.</p>' ||
      '<p>5.4 Both of us agree to raise concerns early and work together to resolve them.</p>' ||
      '<p>5.5 Complaints you wish to make formally can be sent to hello@opulencebliss.com. We will acknowledge within 3 working days and aim to reply in full within 14 days. Our Complaints Procedure explains each stage.</p>' ||
      '<h2>6. Access and security</h2>' ||
      '<p>6.1 You will give safe, agreed access to the premises, including keys, codes or fobs, and will tell us about alarms, restricted areas and hazards.</p>' ||
      '<p>6.2 We will keep keys, codes and fobs secure, will not copy them without your permission and will report any loss immediately. If a key, code or fob is lost because of us, we will pay the reasonable cost of replacing it or changing the lock, up to the limit in clause 9.</p>' ||
      '<p>6.3 You will provide a safe working environment, including any site induction or health and safety briefing needed, and will tell us of any risk you know about. You must comply with your legal duties for health and safety at your premises.</p>' ||
      '<p>6.4 You must keep confidential items, cash, valuables and sensitive documents secured. The Cleaner is not expected to clean or move anything that is unsafe, unhygienic or hazardous.</p>' ||
      '<h2>7. Our Cleaners</h2>' ||
      '<p>7.1 Our Cleaners are self-employed. Before a Cleaner works for the Client, we check their identity and right to work, take references, and require each Cleaner to hold a basic Disclosure and Barring Service (DBS) check and show us the certificate. We also check that they hold their own public liability insurance.</p>' ||
      '<p>7.2 We are responsible to you for the Services, including the work of our Cleaners. We may replace a Cleaner with a suitably trained Cleaner because of holidays, sickness or performance. We will tell you in advance where we can.</p>' ||
      '<p>7.3 Where we can, we will send the same Cleaner to your premises.</p>' ||
      '<p>7.4 Neither of us will directly hire the other&#x27;s Cleaners or staff, or encourage them to move, during the Contract and for 6 months afterwards, without the other&#x27;s written agreement. This does not stop either of us hiring someone who responds to a general public advertisement. If you breach this clause, you will pay us a reasonable amount to cover the cost of replacing the Cleaner, which the parties agree is £250. This is a fair estimate of our cost of vetting, training and replacing a Cleaner, and the disruption to other Clients, and is not a penalty.</p>' ||
      '<p>7.5 Cleaners are not your employees. You must not give them instructions beyond those in the agreed checklist and quote, and any change must be requested through us.</p>' ||
      '<h2>8. Insurance</h2>' ||
      '<p>8.1 We hold public liability insurance of £5,000,000. A copy of the certificate is available on request.</p>' ||
      '<p>8.2 We will keep this insurance, or equivalent insurance, throughout the Contract. We will tell you if it is cancelled or the limit changes.</p>' ||
      '<h2>9. Liability</h2>' ||
      '<p>9.1 Nothing in these terms limits or excludes liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot be limited or excluded by law.</p>' ||
      '<p>9.2 We are responsible for loss of or damage to your property caused by our negligence, or the negligence of our Cleaners, up to the limit of our insurance in clause 8.1 for any one claim.</p>' ||
      '<p>9.3 We are not responsible for loss or damage caused by faults already in the premises, normal wear and tear, items left in unsafe places, items not reported to us, or fragile or valuable items that you did not tell us about and secure.</p>' ||
      '<p>9.4 Subject to clause 9.1, we are not liable for loss of profit, loss of business, loss of goodwill or any indirect or consequential loss. Subject to clause 9.1 and 9.2, our total liability for any other loss arising from the Contract in any 12-month period is limited to the fees you paid to us in that period.</p>' ||
      '<p>9.5 You must tell us of any damage or loss within 7 days of discovering it, with photos where possible, so that we can investigate and make an insurance claim. We will deal with claims promptly and fairly.</p>' ||
      '<p>9.6 The parties agree that these limits are reasonable under the Unfair Contract Terms Act 1977.</p>' ||
      '<h2>10. Events outside our control</h2>' ||
      '<p>10.1 Neither party is responsible for delay or failure caused by events beyond their reasonable control, such as severe weather, emergencies, strikes (not involving their own staff), epidemics or utility failure. We will rearrange missed visits as soon as we reasonably can.</p>' ||
      '<p>10.2 If such an event continues for more than 4 weeks, either of us may end the Contract by written notice without liability, and you will pay only for Services already provided.</p>' ||
      '<h2>11. Confidentiality</h2>' ||
      '<p>11.1 We will keep your information, and anything we see at the premises, confidential, and will use it only to provide the Services.</p>' ||
      '<p>11.2 You will keep our prices, methods and other business information confidential.</p>' ||
      '<p>11.3 This clause does not apply to information that is public, that we are required to disclose by law, or that we must share with our insurers and professional advisers.</p>' ||
      '<h2>12. Data protection</h2>' ||
      '<p>12.1 We will handle personal data as set out in Part 3 (Privacy Notice).</p>' ||
      '<p>12.2 Each of us will comply with UK data protection law, including the UK GDPR and the Data Protection Act 2018, as it applies to the Contract.</p>' ||
      '<p>12.3 If you give us the personal data of your staff or other people, such as site contacts or access codes, you confirm that you are allowed to do so. We will use it only to provide the Services.</p>' ||
      '<h2>13. Referrals</h2>' ||
      '<p>13.1 If the Client was introduced to us by one of our Partners (see our Partner Programme), you agree that we may confirm to that Partner that the introduction led to a Contract. We will not share your prices, invoices or personal data with the Partner.</p>' ||
      '<p>13.2 Our Partners are independent and are not our agents. They have no authority to agree prices, terms or services for us. Only our written quote and these terms bind us.</p>' ||
      '<p>13.3 Our Partners&#x27; reward is a matter between us and the Partner and does not change the price you pay.</p>' ||
      '<h2>14. General</h2>' ||
      '<p>14.1 These terms and our written quote are the whole agreement between us on the Services. They replace earlier discussions and proposals, and neither of us relies on any statement that is not in them. Nothing in this clause limits liability for fraud.</p>' ||
      '<p>14.2 Changes must be agreed in writing by both parties.</p>' ||
      '<p>14.3 If any part is found to be unenforceable, the rest continues to apply.</p>' ||
      '<p>14.4 If either of us delays in enforcing a right, we have not given it up.</p>' ||
      '<p>14.5 You may not transfer the Contract without our written consent. We may transfer it to another company that carries on our business, and we will tell you.</p>' ||
      '<p>14.6 Only you and we have rights under the Contract. Nobody else can enforce it under the Contracts (Rights of Third Parties) Act 1999.</p>' ||
      '<p>14.7 Notices can be sent by email to the addresses on the quote and take effect when sent, unless the sender receives a message that it was not delivered.</p>' ||
      '<p>14.8 We do not currently use an alternative dispute resolution (ADR) provider. If we cannot resolve a dispute through our complaints process, either of us may suggest mediation before going to court.</p>' ||
      '<p>14.9 These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction. Part 2: Cancellation and Payment Policy</p>' ||
      '<h2>15. Ending the Contract</h2>' ||
      '<p>15.1 During the 4-week Trial Period: 7 days&#x27; written notice.</p>' ||
      '<p>15.2 After the Trial Period: the Contract continues for the 12-month Minimum Term and then until ended by 30 days&#x27; written notice, as set out in clause 4.</p>' ||
      '<p>15.3 Notice should be sent by email to hello@opulencebliss.com and takes effect from the day we confirm receipt.</p>' ||
      '<h2>16. Cancelling or rearranging a single visit</h2>' ||
      '<p>16.1 We encourage you to rearrange a visit rather than cancel it. If you move a visit to another day that we can cover, no cancellation charge applies, as long as you ask at least 48 hours before the original visit.</p>' ||
      '<p>16.248 hours&#x27; notice or more: no charge. We will rearrange where possible.</p>' ||
      '<p>16.3 Less than 48 hours&#x27; notice: a cancellation charge of up to 50% of the visit price may apply, taking into account the circumstances of the cancellation and the reasonable costs, losses and commitments arising from the late cancellation. The charge is intended to compensate us for the reasonable financial impact, including reserved staff time, preparation costs and the</p>' ||
      '<p>loss of a reasonable opportunity to accept alternative work. We will not seek to recover the same loss twice.</p>' ||
      '<p>16.4 Cleaner cannot access the premises on arrival: we may charge the full visit price. The Cleaner will wait 15 minutes and try to contact you.</p>' ||
      '<p>16.5 If we cancel or miss a visit: we will rearrange within 48 hours or credit the visit to your next invoice.</p>' ||
      '<p>16.6 You must give notice of cancellation in writing, including by email or the usual business messaging channel. The notice period runs from the time we receive the notice. We will tell you about any cancellation charge and apply it in accordance with these Terms and applicable law. We charge only the amounts shown in this clause and no other cancellation fee.</p>' ||
      '<h2>17. One-off and deep cleans: cancellations</h2>' ||
      '<p>17.1 The Client may cancel a one-off or deep-clean booking without charge by giving at least 72 hours&#x27; notice before the scheduled start time.</p>' ||
      '<p>17.2 If the Client cancels with less than 72 hours&#x27; notice, a cancellation charge of up to 50% of the quoted price may apply, taking into account the circumstances of the cancellation and the reasonable costs, losses and commitments arising from the late cancellation.</p>' ||
      '<p>17.3 The cancellation charge is intended to compensate the Business for the reasonable financial impact of the late cancellation, including reserved staff time, preparation costs and the loss of a reasonable opportunity to accept alternative work. The Business will not seek to recover the same loss twice.</p>' ||
      '<p>17.4 The Client must give notice of cancellation in writing, including by email or the usual business messaging channel. The notice period runs from the time the cancellation notice is received.</p>' ||
      '<p>17.5 Any cancellation charge will be notified to the Client and applied in accordance with these Terms and applicable law.</p>' ||
      '<h2>18. Emergencies</h2>' ||
      '<p>18.1 If you have to close the premises at short notice, for example because of a burst pipe or other emergency, please tell us as soon as you can. We will do our best to waive the charge.</p>' ||
      '<h2>19. Payment, credits and refunds</h2>' ||
      '<p>19.1 Invoices are payable within 14 days of the invoice date, as set out in clause 3.</p>' ||
      '<p>19.2 If you are owed a credit, for example for a missed visit or a visit we could not fix under clause</p>' ||
      '<p>5.3, we will take it off your next invoice. If there is no further invoice, we will refund you by bank transfer within 14 days of the end of the Contract.</p>' ||
      '<p>19.3 We will refund any money you have paid in advance for Services we have not provided within 14 days of the Contract ending, less any amount you owe us. Part 3: Privacy Notice</p>' ||
      '<h2>20. Who we are</h2>' ||
      '<p>20.1 Opulence Bliss Ltd is the data controller for the personal information you give us. Contact: hello@opulencebliss.com, +44 7484 717935. ICO registration number: ZC264981.</p>' ||
      '<h2>21. What information we collect</h2>' ||
      '<p>21.1 When you submit our enquiry form or work with us, we collect your name, job title, business name, telephone number, email address, premises address, access details (for example alarm information or key arrangements), your cleaning requirements, and invoicing and payment details.</p>' ||
      '<h2>22. Why we use it and our legal basis</h2>' ||
      '<p>22.1 We use your information:</p>' ||
      '<p>• to respond to your enquiry, arrange a site visit and prepare a quote (legitimate interests, and steps taken at your request before a contract);</p>' ||
      '<p>• to provide the Services, manage the Contract and issue invoices (performance of a contract);</p>' ||
      '<p>• to keep financial and tax records (legal obligation);</p>' ||
      '<p>• to prevent fraud and keep our Cleaners safe (legitimate interests); and</p>' ||
      '<p>• to send you offers and updates, only if you have agreed (consent). You can withdraw consent at any time.</p>' ||
      '<h2>23. Who we share it with</h2>' ||
      '<p>23.1 We share only what is needed with our self-employed Cleaners (for example the address and access details), and with providers that help us run the business, such as Google (Google Forms and email), our accountants and payment providers. We never sell your information.</p>' ||
      '<p>23.2 If you were referred by one of our Partners, we tell them only that the referral became a customer (see clause 13).</p>' ||
      '<h2>24. How long we keep it</h2>' ||
      '<p>24.1 We keep information for these periods:</p>' ||
      '<p>• Enquiries that do not go ahead: 12 months.</p>' ||
      '<p>• Customer records and contracts: for the length of the Contract and then 6 years, in line with tax and legal requirements.</p>' ||
      '<p>• Marketing contact details: until you unsubscribe.</p>' ||
      '<p>• Access codes and key information: only while the Contract is active, then deleted.</p>' ||
      '<h2>25. Your rights</h2>' ||
      '<p>25.1 You can ask to see, correct or delete your information, restrict or object to how we use it, or ask for a copy. Contact us at hello@opulencebliss.com.</p>' ||
      '<p>25.2 If you are unhappy with how we handle your information, please contact us first. We will acknowledge your complaint within 3 working days and reply without undue delay, and within 30 days in any case. You can also complain to the Information Commissioner&#x27;s Office (ICO) at ico.org.uk or on 0303 123 1113.</p>' ||
      '<h2>26. Changes to this notice</h2>' ||
      '<p>26.1 We may update this notice from time to time. The latest version will be available on our website. Our full Privacy Policy gives more detail.</p>' ||
      '<h2>27. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 ICO registration number: ZC264981 Telephone: +44 7484 717935 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  '92b323d710778dad375ef3955a8ab74ba60fb9ae915be1b486fe6e86722ac200',
  '2026-10-01/business-terms.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'privacy',
  'Privacy Policy',
  'everyone',
  '<div data-final-pack="2026-10-01"><p>PRIVACY POLICY Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 Peace within your walls.</p>' ||
      '<h2>1. Introduction</h2>' ||
      '<p>1.1 Opulence Bliss Ltd (&quot;Opulence Bliss&quot;, &quot;we&quot;, &quot;our&quot; or &quot;us&quot;) respects your privacy and is committed to protecting your personal information.</p>' ||
      '<p>1.2 This Privacy Policy explains how we collect, use, share, store and protect personal information when you:</p>' ||
      '<p>• book or use our cleaning services (a Customer);</p>' ||
      '<p>• apply to work with us or carry out bookings as a self-employed cleaner (a Cleaner) or handyman (a Handyman);</p>' ||
      '<p>• apply for a job with us or work for us as a member of our team (a Job applicant or Team member);</p>' ||
      '<p>• register as a Partner, or are referred to us by a Partner or another customer (a Partner or a Referred person);</p>' ||
      '<p>• contract with us on behalf of a business (a Business customer);</p>' ||
      '<p>• contact us, give feedback, make a complaint or otherwise deal with us.</p>' ||
      '<p>1.3 For the purposes of UK data protection law, including the UK General Data Protection Regulation (UK GDPR), the Data Protection Act 2018 and the Privacy and Electronic Communications Regulations 2003 (PECR), as amended by the Data (Use and Access) Act 2025, Opulence Bliss Ltd is the controller of the personal information described in this policy.</p>' ||
      '<p>1.4 This policy should be read with our Customer Terms and Conditions, our Cleaner Terms and Conditions, our Handyman Terms and Conditions, our Partner Programme Terms and Conditions, our Cookie and Similar Technologies Policy, our DBS and Criminal-Offence Data Policy and our Safeguarding, Lone Working and Incident Policy.</p>' ||
      '<p>1.5 In this policy, a reference to a Cleaner also applies to a Handyman unless we say otherwise. &quot;Professionals&quot; means Cleaners and Handymen.</p>' ||
      '<h2>2. Who we are and how to contact us</h2>' ||
      '<p>Opulence Bliss Ltd Company registration number: 15894675 (registered in England and Wales) Registered office: 128 City Road, London, United Kingdom, EC1V 2NX ICO registration number: ZC264981 Email: hello@opulencebliss.com Call, SMS or WhatsApp: +44 7484 717935 Website: www.opulencebliss.com If you have any questions about this policy or how we handle your personal information, please contact us using these details.</p>' ||
      '<h2>3. The systems we use</h2>' ||
      '<p>3.1 We run an online platform, website and mobile app that connect households and businesses with self-employed cleaners and handymen. We also manage our business using the following services:</p>' ||
      '<p>• Google Workspace, including Gmail, Google Forms, Google Sheets, Google Calendar and Google Drive</p>' ||
      '<p>• WhatsApp Business</p>' ||
      '<p>• Stripe, for payments and payouts</p>' ||
      '<p>• Supabase, for our back end: customer and cleaner accounts, bookings, chat, photos and reminders</p>' ||
      '<p>• Resend, for sending booking confirmations, reminders and password reset emails</p>' ||
      '<p>• Google, if you choose &quot;Sign in with Google&quot;</p>' ||
      '<p>• Google (Gemini), which powers the chat assistant built into our website and app</p>' ||
      '<p>• Accounting software</p>' ||
      '<p>• Gift card and voucher providers, for Partner rewards</p>' ||
      '<p>• A massage provider, Wellness by Anja, for an optional benefit for Professionals</p>' ||
      '<p>• Identity, right-to-work and criminal record checking providers</p>' ||
      '<p>3.2 These services help us manage bookings, communicate with customers, cleaners and Partners, keep business records and make payments.</p>' ||
      '<h2>4. Information we collect</h2>' ||
      '<p>The information we collect depends on how you deal with us. We aim to collect only what is reasonably necessary.</p>' ||
      '<p>4.1 Customers</p>' ||
      '<p>• Name, telephone number and email address</p>' ||
      '<p>• Property address, postcode and type of property, number of bedrooms and bathrooms</p>' ||
      '<p>• Cleaning requirements, preferred dates and times, and your instructions</p>' ||
      '<p>• Access arrangements, such as key-safe codes and entry instructions</p>' ||
      '<p>• Information about pets or anything that affects safety at your home</p>' ||
      '<p>• For handyman jobs, a description of the job and any photos or videos you send us, the Quote, and the Materials you choose to buy or pay for</p>' ||
      '<p>• Limited notes about your needs where they affect safety or how we serve you, for example &quot;needs extra time at the door&quot; (see section 4.7)</p>' ||
      '<p>• Whether you want cleaning products (the Products Add-on)</p>' ||
      '<p>• Booking history, cancellations, refunds, tips, loyalty rewards, referral rewards and Booking Credit</p>' ||
      '<p>• Payment information (processed by Stripe)</p>' ||
      '<p>• Reviews, feedback, complaints, damage reports and photos you send us, and messages you send through the app, including chat</p>' ||
      '<p>• Our communications with you, including messages you send through the chat assistant</p>' ||
      '<p>4.2 Cleaners and Handymen</p>' ||
      '<p>• Name, date of birth, contact details and address</p>' ||
      '<p>• Identity documents and right-to-work information</p>' ||
      '<p>• The outcome of a basic Disclosure and Barring Service (DBS) check</p>' ||
      '<p>• Self-employment and tax information, including your Unique Taxpayer Reference where you give it to us</p>' ||
      '<p>• Proof of your public liability insurance</p>' ||
      '<p>• For Handymen, your trade, qualifications and registrations, including your Gas Safe registration number and ID card details or your competent person scheme registration, where they apply</p>' ||
      '<p>• Your emergency contact: their name, relationship to you and telephone number. You must tell them that you have given us their details</p>' ||
      '<p>• When you check in, the time, and the distance between your phone&#x27;s location and the booking address, so that we can confirm you are at the property (within 500 metres). We keep the time, the distance and the result of the check, not your exact coordinates. If you report a problem getting in, we record the same information. When you check out, we record only the time. We do not track your location at any other time. We also keep any message you send us about running late or being unable to check in</p>' ||
      '<p>• References, experience, qualifications, availability and the areas you work in</p>' ||
      '<p>• Bank account and payout information (processed by Stripe)</p>' ||
      '<p>• Your bookings, hours, pay, tips, ratings and referral rewards</p>' ||
      '<p>• Information about complaints, incidents or service quality</p>' ||
      '<p>• Your choices about optional benefits, such as the massage benefit, and any amount taken from your referral rewards balance for it</p>' ||
      '<p>4.3 Partners</p>' ||
      '<p>• Name, email address and telephone number, and the details you give on the Partner sign-up form, including your consent</p>' ||
      '<p>• The description you choose for yourself, for example cleaner, freelancer or stay-at-home parent</p>' ||
      '<p>• Your personal referral link or code and your referral activity</p>' ||
      '<p>• Your reward balance and the Gift Cards we send you</p>' ||
      '<p>• Identity and email verification information</p>' ||
      '<p>4.4 Referred people If a Partner or a customer gives us your details, or you contact us through a referral link or code, we receive your name and contact details and the fact that you were referred. We use this to contact you only if you asked us to, and to credit the referral. Partners must have your permission before they pass on your details.</p>' ||
      '<p>4.5 Business customers The business name, the name, job title and contact details of the people we deal with, the property address, contract and invoice information, and payment details.</p>' ||
      '<p>4.6 Information from other sources We may receive information from Stripe, identity and criminal record checking providers, insurers, referees, official online registers (such as the Gas Safe Register) and the Partner or customer who referred you.</p>' ||
      '<p>4.7 Safeguarding, incident and safety records If a concern, accident, threat, theft allegation or other incident arises on a booking, we keep a record. It may include the names and contact details of the people involved, what happened, what was said, messages or photos relating to the incident, any notes about a person&#x27;s needs that affected safety, and what we did next. It can include information about a child or a vulnerable adult, and sometimes health information, but only what we need to keep people safe. The records are described in our Safeguarding, Lone Working and Incident Policy.</p>' ||
      '<p>4.8 Job applicants and our team If you apply for a job with us or work for us as a member of our team, we collect your name, contact details, application and CV, references, right-to-work and identity information, and, once you start, your employment and payment records. We give you a separate notice that explains this in full. Team members may see the information of Customers, Professionals and Partners, but only what they need to do their work.</p>' ||
      '<h2>5. How we use your information and our lawful bases</h2>' ||
      '<p>We must have a lawful basis under UK data protection law to use your personal information. Depending on the circumstances, we rely on the following.</p>' ||
      '<p>5.1 Contract Where it is necessary to arrange or carry out a contract with you, or to take steps at your request before a contract. For example, to confirm and manage a booking, take payment, pay a Cleaner, send you a Gift Card, give you Booking Credit or provide customer support.</p>' ||
      '<p>5.2 Legitimate interests Where it is reasonably necessary for our legitimate interests and these are not overridden by your rights. For example, to run and improve our services, match Customers with suitable Cleaners, keep records, investigate complaints and incidents, prevent fraud and misuse of referrals and rewards, protect Customers and Professionals (including through check-ins and emergency contacts), deal with safeguarding concerns and incidents, and recover amounts owed. You can object to this use. See section 17.</p>' ||
      '<p>5.3 Legal obligation Where we must do something by law. For example, keeping accounting and tax records, carrying out right-to-work checks, and sharing information with HMRC or other authorities.</p>' ||
      '<p>5.4 Consent Where the law requires it, we ask for your consent. For example, to send you marketing messages where PECR requires consent, or to share your details with the massage provider for the optional massage benefit. You can withdraw your consent at any time.</p>' ||
      '<p>5.5 Criminal offence information The outcome of a basic DBS check is criminal offence information. We use it only to protect Customers and the public, and to prevent unlawful acts, and only where UK data protection law allows. Professionals apply for and pay for their own check and show us the certificate. Only the owner and our authorised onboarding team may see it. We keep a record of the outcome and the date, and we do not keep a copy of the certificate for longer than 6 months. See our DBS and Criminal-Offence Data Policy.</p>' ||
      '<p>5.6 Special category information We do not ask for health information or other special category information. Please do not send us this unless it is necessary, for example if you tell us about an allergy that affects the cleaning products we use. If you or someone else gives it to us, we use it only to provide the service safely and, where relevant, to deal with a safeguarding concern or incident (see section 5.7).</p>' ||
      '<p>5.7 Safeguarding and incident records We use these records under our legal duties and our legitimate interests in keeping people safe. Where they include special category information or criminal offence information, we rely on the conditions in Schedule 1 of the Data Protection Act 2018 for safeguarding children and individuals at</p>' ||
      '<p>risk, and for preventing or detecting unlawful acts. We share them only where this is necessary to keep someone safe, or where the law requires or allows it.</p>' ||
      '<h2>6. Who we share your information with</h2>' ||
      '<p>6.1 Cleaners and Handymen. When a booking or job is accepted, we give the assigned Professional the information they need to do the job safely, such as your name, address, booking date and time, cleaning or job requirements, any job photos and access instructions.</p>' ||
      '<p>6.2 Customers. We give Customers their Cleaner&#x27;s or Handyman&#x27;s first name, photograph and rating, so that they know who is coming. For handyman jobs, they also see the Quote.</p>' ||
      '<p>6.3 Stripe. We use Stripe to take payments and pay Cleaners. Stripe may act as an independent controller for some purposes, such as verifying identity and preventing fraud, and its own privacy policy applies to that. We do not ask you for your online banking passwords or PINs, and you should never send them to us.</p>' ||
      '<p>6.4 Gift Card providers. To send a Partner their Gift Card, we share their first name, email address and the Gift Card value with the gift card provider, who may be a reseller of cards from retailers such as Amazon, Tesco, Asda and Marks &amp; Spencer. We delete Gift Card codes once they have been sent. The retailers are not connected with us, and their own gift card terms apply.</p>' ||
      '<p>6.5 Identity, right-to-work and DBS check providers. To check Cleaners and Handymen. We check Gas Safe and other registrations on the official online registers.</p>' ||
      '<p>6.6 Emergency contacts. If a Professional does not check in and we cannot reach them, we may contact their emergency contact, and, in a real emergency, the emergency services.</p>' ||
      '<p>6.7 Insurers and brokers. If a claim or incident involves you.</p>' ||
      '<p>6.8 The massage provider. If you are a Cleaner or Handyman and choose the optional massage benefit, we share your name, contact details, member reference and booking date with Wellness by Anja, an independent provider and a separate controller, with your consent. We pay the provider for each treatment from your referral rewards balance, with your agreement, and we keep a record of this. We do not collect or share health information about you. The provider is responsible for any information you give it directly, such as its intake form, and has its own privacy policy.</p>' ||
      '<p>6.9 Our advisers and service providers. Accountants, solicitors, other professional advisers, and technical and IT service providers, including Google, WhatsApp, Supabase and Resend. They act on our instructions or under their own legal obligations.</p>' ||
      '<p>6.10 Authorities. HMRC, the police, regulators and courts where the law requires, or where it is necessary to prevent or detect crime. UK rules on reporting by digital platforms may also require us to share information about Cleaners and their earnings with HMRC.</p>' ||
      '<p>6.11 Our team. Members of our team, including those who handle emails and carry out onboarding checks, see the information they need for their role. They work under written confidentiality and data protection terms, use only equipment and accounts we provide, and only the owner and authorised onboarding team may see DBS information.</p>' ||
      '<p>6.12 Business transfers. If we sell or reorganise our business, we may share information with the people involved, who must keep it protected.</p>' ||
      '<p>6.13 We do not sell your personal information.</p>' ||
      '<p>6.14 Our main providers and their roles. A controller decides why and how personal information is used. A processor uses it only on our instructions. The role depends on the service, as shown below. Each provider&#x27;s own terms and privacy notice also apply.</p>' ||
      '<table><thead><tr><th>Provider</th><th>What it does for us</th><th>Role</th></tr>' ||
      '</thead><tbody><tr><td>Supabase</td><td>Back end: customer and cleaner accounts, bookings, chat, photos and reminders</td><td>Processor. It uses the information only on our instructions</td></tr>' ||
      '<tr><td>Resend</td><td>Sends booking confirmations, reminders and password reset emails</td><td>Processor. It uses the information only on our instructions</td></tr>' ||
      '<tr><td>Stripe</td><td>Payments and payouts</td><td>Processor when it takes and processes payments on our instructions. Independent controller for its own purposes, such as verifying identity, preventing fraud and meeting its legal and regulatory duties, under its own privacy policy</td></tr>' ||
      '<tr><td>Google Gemini (chat assistant)</td><td>Chat messages and, for booking questions, relevant booking details and postcode</td><td>Processor. It uses the information to answer the question on our instructions. It may keep it for a short time to detect abuse</td></tr>' ||
      '<tr><td>Google Workspace</td><td>Email, forms, spreadsheets, calendar and documents</td><td>Processor for the information we store and process in Google Workspace. Controller for the limited purposes set out in its own terms</td></tr>' ||
      '<tr><td>Sign in with Google</td><td>An optional way to sign in</td><td>Independent controller of your Google account information. We receive only what you allow Google to share</td></tr>' ||
      '<tr><td>WhatsApp</td><td>Messages about bookings and support</td><td>Independent controller of its own technical and account information. We are the controller of the content of messages we send and receive</td></tr>' ||
      '<tr><td>Gift Card providers</td><td>Supply gift cards for Partner rewards</td><td>Set out in our written agreement with the provider</td></tr>' ||
      '</tbody></table><h2>7. Google Workspace and WhatsApp</h2>' ||
      '<p>7.1 We use Google Workspace to collect, store and organise information, including booking forms, spreadsheets, calendars and email. Access is restricted to authorised people who need it. Google&#x27;s own terms and data processing arrangements apply to its processing.</p>' ||
      '<p>7.2 We may use WhatsApp Business to talk to Customers, Cleaners and Partners about bookings, confirmations, changes, cancellations and support. Messages can include names, addresses and appointment details. WhatsApp is run by a third party and its own privacy terms apply. Please avoid sending sensitive information through WhatsApp unless necessary. Never send us identity documents, DBS certificates or health information by WhatsApp or personal email. Use the secure method we give you.</p>' ||
      '<p>7.3 Our website and app include a chat assistant. It does not use cookies. The assistant uses Google&#x27;s Gemini service, so Google processes the messages you send to it, on our behalf. We do not store the chat history on our website. When you ask about a booking, the relevant booking details and postcode may be shared with the assistant so that it can answer you. Google may process this information outside the UK, including in the United States, and may keep it for a short time to detect abuse. We use a paid service, and Google does not use your messages to train its models. Messages you send to the assistant are personal information,</p>' ||
      '<p>so please do not put sensitive information, such as health details or bank details, into the chat.</p>' ||
      '<p>7.4 Calendars and spreadsheets should contain only what we reasonably need to manage the booking.</p>' ||
      '<h2>8. Partner and referral information</h2>' ||
      '<p>8.1 We use your referral link or code to record referrals and decide who is owed a reward.</p>' ||
      '<p>8.2 If you are a Partner, you must not give us another person&#x27;s details unless they have agreed that you can. If you promote us, you must follow the law on marketing messages. If a Partner contacts you in breach of these rules, please let us know.</p>' ||
      '<p>8.3 We check referrals to prevent fraud, such as people referring themselves or creating fake accounts.</p>' ||
      '<h2>9. Marketing</h2>' ||
      '<p>9.1 We send you service messages about bookings, payments and your account because they are part of providing the service.</p>' ||
      '<p>9.2 We send you marketing by email or text only if you have agreed, or, where PECR allows, where you are an existing customer and we are offering similar services and you were given a clear chance to opt out. You can opt out at any time by using the unsubscribe link or emailing hello@opulencebliss.com.</p>' ||
      '<p>9.3 We may send marketing to businesses at their corporate email addresses where PECR allows, and we will always include an easy way to opt out.</p>' ||
      '<h2>10. Website, cookies and similar technologies</h2>' ||
      '<p>10.1 Our website and platform use essential cookies and similar technologies that are needed to run the service, such as keeping you signed in and keeping your booking secure. We do not need your consent for these.</p>' ||
      '<p>10.2 We use analytics, advertising or other non-essential cookies only where you have given your consent, unless the law allows an exemption. We will give you a clear choice and a way to change it at any time.</p>' ||
      '<p>10.3 Our Cookie and Similar Technologies Policy lists every cookie and similar technology we use, why we use it and how long it lasts. At the date of this policy we use only strictly necessary cookies and similar technologies, and we do not use analytics or advertising tools.</p>' ||
      '<h2>11. Automated decisions</h2>' ||
      '<p>We do not make decisions that have legal or similarly significant effects on you based solely on automated processing. We may use automated checks to spot possible fraud or misuse of rewards, and a person reviews the result before we take action.</p>' ||
      '<h2>12. International transfers</h2>' ||
      '<p>12.1 We use third-party service providers to support our business operations, including payment processing, communications, email, data storage and business administration. Our main providers are Google, WhatsApp, Stripe, Supabase and Resend. Depending on the services used, these providers may process personal information outside the United Kingdom,</p>' ||
      '<p>including in the United States or other countries. Resend sends our emails from the European Economic Area (Ireland), which is covered by UK adequacy regulations.</p>' ||
      '<p>12.2 Where UK data protection law requires, we make sure that transfers of personal information to separate organisations outside the UK are covered by UK adequacy regulations, appropriate safeguards or a valid legal exception. Appropriate safeguards may include the UK International Data Transfer Agreement (IDTA) or the UK International Data Transfer Addendum to the EU Standard Contractual Clauses, together with any required assessment of the risks of the transfer.</p>' ||
      '<p>12.3 Where we rely on the UK-US Data Bridge, we check that the receiving US organisation has an active certification and that the transfer falls within its scope.</p>' ||
      '<p>12.4 Some members of our team may work from outside the UK, including in Nigeria, and may need remote access to personal information to do their jobs. We restrict access according to job responsibilities and business need, and use appropriate technical and organisational security measures. Team members use only the equipment and accounts we provide. We limit access to sensitive records, including criminal record information obtained for Disclosure and Barring Service (DBS) purposes, to specifically authorised personnel who need it for their role.</p>' ||
      '<p>12.5 We review our international data access and transfer arrangements as necessary to make sure personal information continues to receive appropriate protection under UK data protection law.</p>' ||
      '<h2>13. How long we keep your information</h2>' ||
      '<p>We keep personal information only as long as we need it for the reasons we collected it, and for the periods below.</p>' ||
      '<p>• Customer booking and payment records: 6 years after the end of the financial year to which they relate, for accounting and tax.</p>' ||
      '<p>• Customer account information: until you close your account, then up to 12 months, unless we need it for a complaint, claim or legal reason.</p>' ||
      '<p>• Cleaner and Partner records: while you work with us and for 6 years afterwards for accounting, tax, claims and reward records.</p>' ||
      '<p>• Identity and right-to-work documents: while you work with us and for 2 years afterwards.</p>' ||
      '<p>• Handyman qualifications, registrations and insurance documents: while you work with us and for 2 years afterwards.</p>' ||
      '<p>• Emergency contact details: while you work with us and for 6 months afterwards.</p>' ||
      '<p>• Check-in and check-out records: 2 years from the booking, or longer if linked to a complaint, incident or claim.</p>' ||
      '<p>• Photos and videos of jobs: 12 months from the job, or longer if linked to a complaint or claim.</p>' ||
      '<p>• Safeguarding and incident records: 6 years from the date they are closed, or longer where the law, a court or an authority requires. Records about a child are kept for longer where official guidance says they should be.</p>' ||
      '<p>• Massage benefit records: 6 years, with our payment records.</p>' ||
      '<p>• Unsuccessful job applicants: 6 months from our decision.</p>' ||
      '<p>• DBS check: we keep the outcome and the date of the check while you work with us and for 6 months after your account closes, and we do not keep a copy of the certificate for longer than 6 months. See our DBS and criminal-offence data policy.</p>' ||
      '<p>• Records involved in an unresolved dispute or incident: until it is resolved, even where the period above has ended.</p>' ||
      '<p>• Complaints and damage claims: 6 years from the date they are closed.</p>' ||
      '<p>• Booking messages (email, WhatsApp, text): 2 years from the last message, or longer if linked to a complaint or claim.</p>' ||
      '<p>• Marketing: until you unsubscribe or withdraw consent, and then we keep a short record so that we do not contact you again.</p>' ||
      '<p>• Referral and reward records: 6 years, to deal with disputes and accounting. When we no longer need information, we securely delete or anonymise it, unless the law requires us to keep it.</p>' ||
      '<h2>14. Security</h2>' ||
      '<p>14.1 We take reasonable technical and organisational measures to protect personal information against unauthorised access, accidental loss, disclosure, destruction, misuse and alteration. Examples include password protection, restricted access to booking information, secure Google Workspace accounts, appropriate device security and keeping business information within authorised systems.</p>' ||
      '<p>14.2 Keys, key-safe codes and entry instructions are treated as confidential. Cleaners and Handymen must keep Customer information secure and must not sell it, share it unnecessarily, publish it online or use it for unrelated marketing.</p>' ||
      '<p>14.3 No electronic system can be guaranteed to be completely secure.</p>' ||
      '<h2>15. Personal data breaches</h2>' ||
      '<p>If we become aware of a personal data breach, we will assess it and act in line with data protection law. Where the law requires, we will tell the Information Commissioner&#x27;s Office within 72 hours of becoming aware of it, and we will tell the people affected without undue delay if there is a high risk to them.</p>' ||
      '<h2>16. Children</h2>' ||
      '<p>Our services are for adults. We do not knowingly collect personal information from anyone under 18. If you think we have, please contact us. If a safeguarding concern involves a child, we may need to record limited information about the child (see section 4.7).</p>' ||
      '<h2>17. Your rights</h2>' ||
      '<p>Under UK data protection law, you have the right to:</p>' ||
      '<p>• be told how we use your information (this policy);</p>' ||
      '<p>• access a copy of your personal information;</p>' ||
      '<p>• have inaccurate information corrected;</p>' ||
      '<p>• have your information deleted in some circumstances;</p>' ||
      '<p>• restrict how we use it in some circumstances;</p>' ||
      '<p>• object to our use of it, including for direct marketing, which we will always stop;</p>' ||
      '<p>• receive certain information in a portable format;</p>' ||
      '<p>• withdraw consent at any time, where we rely on it; and</p>' ||
      '<p>• not be subject to decisions based solely on automated processing that significantly affect you. These rights are subject to conditions and exemptions in the law.</p>' ||
      '<h2>18. How to use your rights</h2>' ||
      '<p>18.1 To use a right, email hello@opulencebliss.com or contact us using the details in section 2. We may need to verify your identity, and we may ask you to clarify your request so that we can find your information.</p>' ||
      '<p>18.2 We will respond within one month. If your request is complex, we may extend this by up to two further months, and we will tell you why. We do not normally charge a fee.</p>' ||
      '<h2>19. Complaints</h2>' ||
      '<p>19.1 If you have a concern about how we handle your personal information, please contact us first at hello@opulencebliss.com. We will acknowledge your complaint within 3 working days, investigate it and reply without undue delay, and within 30 days in any case.</p>' ||
      '<p>19.2 You can also complain to the Information Commissioner&#x27;s Office (ICO), the UK&#x27;s data protection regulator, at ico.org.uk or on 0303 123 1113. You do not have to contact us first.</p>' ||
      '<h2>20. Changes to this policy</h2>' ||
      '<p>We may update this policy when our business, systems, services or the law change, for example if we add new software, a new payment method or new features. We will show the latest version and the date it was last updated. If a change significantly affects how we use your information, we will tell you directly.</p>' ||
      '<h2>21. Our privacy commitment</h2>' ||
      '<p>Customers trust us with information about their homes, bookings and personal circumstances. Our Cleaners and Partners trust us with their personal and business information. We handle it with the same care, fairness and respect that we expect everyone on our platform to show one another. Happy Cleaners. Happier Homes. Your information. Your trust. Our responsibility.</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  'ca07e1697dbf73b4f2e27b401a9a6c5e39fac3734eb0dad5f37eaa3d12138869',
  '2026-10-01/privacy.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'cookies',
  'Cookie and Similar Technologies Policy',
  'everyone',
  '<div data-final-pack="2026-10-01"><p>COOKIE AND SIMILAR TECHNOLOGIES POLICY Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 This policy explains what cookies and similar technologies our website and app use, why, and how you can control them. It is part of our Privacy Policy.</p>' ||
      '<h2>1. About this policy</h2>' ||
      '<p>1.1&quot;We&quot;, &quot;us&quot; and &quot;our&quot; mean Opulence Bliss Ltd, company number 15894675, registered office 128 City Road, London, United Kingdom, EC1V 2NX. ICO registration number: ZC264981.</p>' ||
      '<p>1.2 A cookie is a small file that a website puts on your device. We also use similar technologies that store information on your device, such as session storage, local storage and an app cache. In this policy we call all of these &quot;cookies and similar technologies&quot;.</p>' ||
      '<p>1.3 This policy should be read with our Privacy Policy, which explains how we use personal information.</p>' ||
      '<h2>2. The short version</h2>' ||
      '<p>2.1 We use only strictly necessary cookies and similar technologies. They keep you signed in, protect your account and make your booking work.</p>' ||
      '<p>2.2 We do not use analytics, advertising or tracking tools. We do not use Facebook, TikTok or Google advertising tags, and we do not use a third-party chat widget.</p>' ||
      '<p>2.3 Because we use only strictly necessary storage, we do not show a cookie consent banner. The law does not require your consent for these.</p>' ||
      '<p>2.4 If we add analytics, advertising or other non-essential tools in future, we will ask for your consent first and update this policy before they start.</p>' ||
      '<h2>3. Cookies we set</h2>' ||
      '<table><thead><tr><th>Name</th><th>Purpose</th><th>Type</th><th>Set by</th><th>How long</th></tr>' ||
      '</thead><tbody><tr><td>sb-uiqcsihgqaktpjumyeap-auth-token (it may be split into .0, .1)</td><td>Keeps you signed in to your account</td><td>Strictly necessary</td><td>Opulence Bliss, through our sign-in provider Supabase</td><td>Until you sign out, or up to 400 days</td></tr>' ||
      '<tr><td>sb-uiqcsihgqaktpjumyeap-auth-token-code-verifier</td><td>Secures Google sign-in and password resets</td><td>Strictly necessary</td><td>Opulence Bliss, through Supabase</td><td>A few minutes. Removed once you are signed in</td></tr>' ||
      '</tbody></table><h2>4. Other storage on your device</h2>' ||
      '<table><thead><tr><th>Name</th><th>Type</th><th>Purpose</th><th>How long</th></tr>' ||
      '</thead><tbody><tr><td>Booking draft</td><td>Session storage</td><td>Saves your booking if you sign in part-way through</td><td>Until you close the tab or finish booking</td></tr>' ||
      '<tr><td>opulence-app-audience</td><td>Session storage</td><td>Shows the customer or professional version of our mobile app</td><td>Until you close the app or tab</td></tr>' ||
      '<tr><td>opulence-customer-nav and opulence-worker-nav</td><td>Local storage</td><td>Remembers whether you collapsed the account menu</td><td>Until you clear your browser data</td></tr>' ||
      '<tr><td>Offline page</td><td>App cache</td><td>Lets our app show a page when you are offline</td><td>Until the app is removed or updated</td></tr>' ||
      '</tbody></table><p>4.1 The account menu setting is a preference that you choose. It contains no personal information and is not used to track you.</p>' ||
      '<h2>5. Other sites you may visit from ours</h2>' ||
      '<p>5.1 These companies set their own cookies, under their own policies. They are not set on our site.</p>' ||
      '<p>• Stripe: our secure payment page, for payments and fraud prevention.</p>' ||
      '<p>• Google: if you choose &quot;Sign in with Google&quot;. Cleaners&#x27; directions links also open Google Maps.</p>' ||
      '<p>• Facebook, Instagram and TikTok: only if you click one of our social media links.</p>' ||
      '<p>5.2 We are not responsible for how other sites use cookies. Please read their policies.</p>' ||
      '<h2>6. How to control cookies</h2>' ||
      '<p>6.1 You can delete cookies and clear stored data in your browser settings at any time, and you can set your browser to block cookies. Look under &quot;Privacy&quot; or &quot;Settings&quot; in your browser&#x27;s help pages. Blocking strictly necessary storage means you may not be able to sign in or book.</p>' ||
      '<p>6.2 Clearing your data signs you out and removes your saved menu setting. Your account and bookings are not affected.</p>' ||
      '<p>6.3 To learn more about cookies, visit the Information Commissioner&#x27;s Office website at ico.org.uk and aboutcookies.org.</p>' ||
      '<h2>7. Changes to this policy</h2>' ||
      '<p>7.1 We will update this policy if we change the cookies or similar technologies we use. We will tell you before any non-essential tool starts and ask for your consent first. The date at the top shows the current version.</p>' ||
      '<h2>8. Contact us</h2>' ||
      '<p>8.1 If you have a question about this policy or your personal information, please contact us: Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675</p>' ||
      '<p>ICO registration number: ZC264981 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  'e1bbaefc998db02ab6c15b8a163b4b9edd653a72c3bac0420022149b67cefac3',
  '2026-10-01/cookies.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'complaints',
  'Complaints Procedure',
  'everyone',
  '<div data-final-pack="2026-10-01"><p>COMPLAINTS PROCEDURE For customers, business clients, cleaners, handymen and Partners | Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 This is the single complaints procedure that applies to everything we do. It is referred to in our Customer Terms, Business Terms, Cleaner Terms, Handyman Terms, Partner Programme Terms and policies. We want to hear when something is wrong, so we can put it right.</p>' ||
      '<h2>1. Our promise</h2>' ||
      '<p>1.1 We take every complaint seriously, we treat it fairly, and we deal with it in the same way whoever you are. Making a complaint will never affect how we treat you. Cleaners, handymen and Partners will not be penalised, suspended or lose work for raising a complaint in good faith.</p>' ||
      '<p>1.2 A complaint is any expression of dissatisfaction about our service, a booking, a cleaner or handyman, a payment, a refund, a reward, a price, our staff, or how we handle personal information.</p>' ||
      '<h2>2. Key response times</h2>' ||
      '<table><thead><tr><th>Stage</th><th>What happens and when</th></tr>' ||
      '</thead><tbody><tr><td>Acknowledgement</td><td>Within 3 working days of receiving your complaint</td></tr>' ||
      '<tr><td>Full reply</td><td>Within 14 days of receiving it, where we can</td></tr>' ||
      '<tr><td>Complex complaints</td><td>A full reply within 28 days, with an update to you by day 14</td></tr>' ||
      '<tr><td>Data protection complaints</td><td>Acknowledged within 3 working days, and a reply within 30 days at the latest</td></tr>' ||
      '<tr><td>Review of our reply</td><td>Requested within 14 days of our reply, and the outcome sent within 14 days of your request</td></tr>' ||
      '<tr><td>Urgent or safety matters</td><td>We contact you the same day (see clause 5)</td></tr>' ||
      '</tbody></table><h2>3. How to complain</h2>' ||
      '<p>3.1 Contact us in any of these ways:</p>' ||
      '<p>• Email: hello@opulencebliss.com</p>' ||
      '<p>• Phone or WhatsApp: +44 7484 717935</p>' ||
      '<p>• Through your account or the platform</p>' ||
      '<p>• By post: Opulence Bliss Ltd, 128 City Road, London, United Kingdom, EC1V 2NX</p>' ||
      '<p>3.2 Please tell us your name, your booking or account reference, what went wrong, what you would like us to do, and any photos or messages that help. If you cannot give all this, tell us what you can and we will ask for the rest.</p>' ||
      '<p>3.3 Please tell us as soon as you can, ideally within 30 days, so that we can find the facts. If a complaint is about the quality of a visit, tell us within the time in your terms (48 hours for household customers, 24 hours for business clients). We will still look at later complaints where we can.</p>' ||
      '<p>3.4 You can ask someone to complain for you, such as a family member or an adviser. We will ask for your written permission. We will make reasonable adjustments if you find it hard to complain in writing, for example by taking your complaint by phone.</p>' ||
      '<h2>4. How we deal with it</h2>' ||
      '<p>Stage 1: Acknowledgement. Within 3 working days, we confirm we have your complaint, give it a reference number, and tell you who is dealing with it and when to expect a reply. Stage 2: Investigation and reply. We look at the facts, speak to everyone involved including the cleaner, handyman or Partner, and check our records. We send you a full written reply within 14 days. It explains what we found, what we will do, and why. If we need longer, we write to you by day 14 to say why and when to expect the reply, which will be within 28 days. Stage 3: Review. If you are not happy with our reply, tell us within 14 days. Someone who was not involved in the first reply will review it where we can. Where the owner dealt with the first reply, we will offer a review by an independent person, for example a mediator, if you would like one. We will send our final reply within 14 days of your request. Stage 4: Outside help. If we still cannot agree, you can:</p>' ||
      '<p>• take legal action in the courts;</p>' ||
      '<p>• use mediation, which we will take part in if you ask for it;</p>' ||
      '<p>• get free advice from Citizens Advice (citizensadvice.org.uk or 0808 223 1133 in England); and</p>' ||
      '<p>• for personal data, complain to the Information Commissioner&#x27;s Office (ico.org.uk, 0303 123 1113). We do not currently use an alternative dispute resolution (ADR) provider. If this changes, we will tell you.</p>' ||
      '<h2>5. Urgent matters</h2>' ||
      '<p>5.1 Contact us immediately by phone for:</p>' ||
      '<p>• any danger, injury, assault, threat or harassment;</p>' ||
      '<p>• a safeguarding concern about a child or an adult at risk;</p>' ||
      '<p>• a theft allegation, lost or compromised keys or access codes; and</p>' ||
      '<p>• a data breach.</p>' ||
      '<p>5.2 We deal with these under our Safeguarding, Lone Working and Incident Reporting Policy and our data protection duties, and not only under this procedure. We will contact you the same day. If anyone is in immediate danger, call 999.</p>' ||
      '<h2>6. Complaints about people who work through us</h2>' ||
      '<p>6.1 If a complaint is about a cleaner or handyman, we will tell that person what has been said and give them the chance to respond, unless there is a safety reason not to. We may suspend them while we investigate. Suspension does not mean they are at fault.</p>' ||
      '<p>6.2 If a complaint shows a possible crime or serious risk, we will tell the police or the right authority.</p>' ||
      '<p>6.3 If a cleaner, handyman or Partner is the person complaining, for example about pay, rewards, cancellations or suspension, we will deal with it under this procedure and the same times apply. Cleaners and handymen can also ask for a review of a suspension decision within 14 days, as set out in their terms.</p>' ||
      '<h2>7. Complaints about personal information</h2>' ||
      '<p>7.1 If you are unhappy about how we use your personal information, tell us first. We will acknowledge your complaint within 3 working days, look into it, tell you the outcome without undue delay and within 30 days at the latest, and tell you if we need longer and why.</p>' ||
      '<p>7.2 We will tell you what we found, what we will do, and about your right to complain to the ICO. This does not affect your right to complain to the ICO at any time.</p>' ||
      '<h2>8. What we can do to put things right</h2>' ||
      '<p>8.1 Depending on the complaint, we may: say sorry, explain what happened, redo the work, arrange another cleaner or handyman, refund all or part of a payment, give Booking Credit or a goodwill credit, correct a record or payment, pay a reward that was missed, change how we work, or take action against the person responsible.</p>' ||
      '<p>8.2 We decide what is fair in each case. Any refund or credit follows our Cancellations, Payment and Refunds Policy and our terms, and this procedure does not reduce your legal rights.</p>' ||
      '<h2>9. Fairness, confidentiality and records</h2>' ||
      '<p>9.1 We keep complaints confidential and share them only with people who need to know, or where the law requires.</p>' ||
      '<p>9.2 We record every complaint, the date, who dealt with it, what we decided and when we closed it. We keep these records for 6 years, or longer where the law requires.</p>' ||
      '<p>9.3 We review the complaints log every 3 months, look for patterns and causes, and make changes to prevent the same problem happening again.</p>' ||
      '<p>9.4 Our owner is responsible for this procedure. We review it at least once a year.</p>' ||
      '<h2>10. Letters we send</h2>' ||
      '<p>Acknowledgement. &quot;Thank you for contacting Opulence Bliss. We have received your complaint (reference {number}) on {date}. {Name} is looking into it. We will reply in full by {date}. If you have more to tell us, please reply to this email.&quot; Reply. &quot;Thank you for your complaint (reference {number}). We looked at {what we checked}. We found {findings}. We will {action}. If you are not happy with this reply, you can ask us to review it by writing to hello@opulencebliss.com within 14 days. After that you can also take legal action or use mediation, and you can get free advice from Citizens Advice. If your complaint is about personal information, you can complain to the Information Commissioner&#x27;s Office at ico.org.uk.&quot;</p>' ||
      '<h2>11. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 ICO registration number: ZC264981 Telephone: +44 7484 717935 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  'c0bc08220cdb8e4cfe880301707e02bed25fa432fcf5cfd95d7d996a407d6560',
  '2026-10-01/complaints.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'partner-programme',
  'Partner Programme Terms',
  'everyone',
  '<div data-final-pack="2026-10-01"><p>PARTNER PROGRAMME TERMS AND CONDITIONS Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 These terms are for Partners who are not cleaners. Cleaners are covered by the separate Partner and Cleaner Terms and Conditions.</p>' ||
      '<h2>1. About us and these terms</h2>' ||
      '<p>1.1 These terms apply between Opulence Bliss Ltd (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) and each individual who registers as a Partner (&quot;you&quot;).</p>' ||
      '<p>1.2 Our details: Opulence Bliss Ltd, a company registered in England and Wales, company number</p>' ||
      '<h2>15894675. Registered office: 128 City Road, London, United Kingdom, EC1V 2NX.</h2>' ||
      '<p>Registered with the Information Commissioner&#x27;s Office (ICO) under number ZC264981. Contact: hello@opulencebliss.com.</p>' ||
      '<p>1.3 We run an online platform that connects households and businesses in London with self-employed cleaners and handymen. As a Partner, you recommend our services to other people and may earn rewards when they buy.</p>' ||
      '<p>1.4 In these terms:</p>' ||
      '<p>• Household means an individual who books our services for their home.</p>' ||
      '<p>• Business means a company, partnership, sole trader or other organisation that buys our services for business purposes, including offices, shops, landlords, lettings agents, serviced accommodation hosts and property managers.</p>' ||
      '<p>• New customer means a Household or Business that has never booked or contracted with us before and whom we have not already been in contact with about our services.</p>' ||
      '<p>• Referral means a new customer who contacts us or books through your personal link, code or referral form.</p>' ||
      '<p>• Booking Credit means credit applied to a customer&#x27;s next booking, as set out in clause 7.</p>' ||
      '<p>1.5 By registering as a Partner, you agree to these terms. If you do not agree, please do not register.</p>' ||
      '<h2>2. Becoming a Partner</h2>' ||
      '<p>2.1 Joining is free. There is no joining fee, no monthly fee and no charge for guidance, materials or support. You do not have to buy anything.</p>' ||
      '<p>2.2 You must be at least 18 years old and living in the United Kingdom and able to receive Gift Cards at an email address that you control.</p>' ||
      '<p>2.3 You apply by completing our registration form. Registering your interest does not guarantee that you will be accepted. We may accept or decline an application at our discretion, and we will tell you if we decline.</p>' ||
      '<p>2.4 You must give us accurate information and keep it up to date. You may hold only one Partner account.</p>' ||
      '<p>2.5 Before we give you a reward, we may need to verify your identity and email address. If you do not complete verification, we may delay your reward until you do.</p>' ||
      '<p>2.6 Cleaners on our platform may also be Partners. Rewards for referring other cleaners are covered by the cleaner terms and not by these terms.</p>' ||
      '<h2>3. Your status: independent</h2>' ||
      '<p>3.1 You are an independent individual. Nothing in these terms makes you our employee, worker, partner in a legal partnership, agent or franchisee, and you have no authority to bind us, to agree prices or terms for us, or to make promises on our behalf.</p>' ||
      '<p>3.2 You choose whether, when and how to promote us. We do not guarantee any number of customers or any level of reward, and there is no minimum amount of activity you must carry out.</p>' ||
      '<p>3.3 We do not require you to work exclusively for us, and you remain free to promote other businesses, provided you follow clause 10.</p>' ||
      '<h2>4. Your referral link</h2>' ||
      '<p>4.1 We will give you a personal link or code. We use it to identify your referrals. You must not share it in a way that breaches clause 10.</p>' ||
      '<p>4.2 A referral is counted only if it is made through your link, code or referral form before the person books or contracts with us. We cannot add referrals afterwards.</p>' ||
      '<p>4.3 If more than one Partner or customer claims the same referral, we will credit the first valid referral recorded on our systems.</p>' ||
      '<h2>5. Referring households: the £10 reward</h2>' ||
      '<p>5.1 If you refer a new Household, you earn £10, and the Household receives £10 off their bookings. This is a one-off reward for each new Household.</p>' ||
      '<p>5.2 The reward is paid in two parts. You earn £5 after the Household&#x27;s first booking is completed and paid, and a further £5 after their second booking is completed and paid. The Household receives £5 off their first booking and £5 off their second booking. If the second booking is not completed and paid, the second part is not paid.</p>' ||
      '<p>5.3 The reward does not apply to bookings made before the referral, to repeat bookings beyond the second, or to the same household more than once.</p>' ||
      '<p>5.4 We do not pay a reward on a booking that is cancelled, unpaid or refunded, or if we reasonably believe the referral is not genuine, for example where you are the customer or a member of the same household.</p>' ||
      '<h2>6. Referring businesses: the percentage reward</h2>' ||
      '<p>6.1 If you refer a Business that becomes a new customer, you may earn a one-off reward based on the Business&#x27;s first month&#x27;s fee, as follows:</p>' ||
      '<p>• 5% of the first month&#x27;s fee for each of your first three qualifying Business referrals; and</p>' ||
      '<p>• 10% of the first month&#x27;s fee for your fourth qualifying Business referral and each one after that.</p>' ||
      '<p>6.2 The higher rate applies only to your fourth and later qualifying referrals. It does not increase rewards for your first three.</p>' ||
      '<p>6.3 A Business referral is qualifying only if:</p>' ||
      '<p>• the Business is a new customer and you introduced it through your link, code or referral form before we had been in contact with it about our services;</p>' ||
      '<p>• we accept the Business as a customer, which we may decline at our discretion;</p>' ||
      '<p>• the Business signs a written service agreement with us that has a minimum term of 12 months;</p>' ||
      '<p>• the Business&#x27;s trial period (the first 4 weeks of the agreement) has ended without either party ending the agreement; and</p>' ||
      '<p>• the Business has paid its first month&#x27;s fee in cleared funds.</p>' ||
      '<p>6.4 The first month&#x27;s fee means the amount invoiced to the Business for the first month of services under its agreement, before VAT, and excluding tips, one-off add-ons, product charges, credits and discounts.</p>' ||
      '<p>6.5 Qualifying Business referrals are counted in the order in which the first month&#x27;s fee is paid, across the whole time you are a Partner.</p>' ||
      '<p>6.6 The reward is a one-off payment for each Business referral. It is not paid again when the agreement renews or the Business pays later invoices.</p>' ||
      '<p>6.7 A Business referral earns the reward in this clause 6. It does not also earn the household reward in clause 5.</p>' ||
      '<p>6.8 We decide whether to accept a Business, the price and the terms of its agreement. You must not negotiate or promise prices, services or terms on our behalf.</p>' ||
      '<p>6.9 If the Business&#x27;s first month&#x27;s fee is refunded, reversed or charged back, we may withhold the reward. If we have already paid it, we may deduct the amount from your future rewards. We will not ask you to repay it in cash, unless it was paid because of a breach of these terms or fraud.</p>' ||
      '<h2>7. Customers who refer: Booking Credit</h2>' ||
      '<p>7.1 If you are a customer who has not registered as a Partner and you refer a new customer, your reward is given as Booking Credit and not as cash.</p>' ||
      '<p>7.2 Booking Credit is applied automatically to your next booking. It has no cash value, cannot be transferred or exchanged, and is lost if your customer account is closed. Booking Credit expires 12 months after it is issued.</p>' ||
      '<p>7.3 If you are registered as a Partner, your rewards are given as Gift Cards under clause 8, even if you are also a customer.</p>' ||
      '<p>7.4 Clauses 5 and 6 apply to customer referrals in the same way, including the two-part payment for referring a household.</p>' ||
      '<h2>8. How rewards are given (Gift Cards)</h2>' ||
      '<p>8.1 Rewards are paid monthly in arrears. We convert each reward into a digital gift card or voucher (a &quot;Gift Card&quot;) of your choice from Amazon, Tesco, Asda or Marks &amp; Spencer (or other retailers we add, subject to availability), and send it to the email address on your account. We will convert the rewards that became payable in the previous month.</p>' ||
      '<p>8.2 Partner rewards are given only as Gift Cards. We do not offer a cash alternative, and a Gift Card cannot be exchanged for cash. If your rewards in a month are below the smallest value for which a Gift Card can be issued, we will add them to your reward for the next month.</p>' ||
      '<p>8.3 We pay the cost of issuing your Gift Card. The full value of your reward is given to you.</p>' ||
      '<p>8.4 We show each reward in your account with a clear breakdown of the referral, the date and the amount.</p>' ||
      '<p>8.5 You must make sure the email address on your account is correct. We are not responsible for Gift Cards sent to an incorrect address that you supplied. The retailer&#x27;s own gift card terms apply</p>' ||
      '<p>to your Gift Card, including any expiry date and how it can be used. These retailers are not connected with us, do not sponsor or endorse the Partner Programme, and are not responsible for it. The Gift Card provider&#x27;s own terms also apply, including any expiry date, and we are not responsible for the provider&#x27;s service or for a Gift Card that is lost or stolen after we have sent it.</p>' ||
      '<p>8.6 If we give you too much by mistake, we may deduct the value from your future rewards or ask you to repay it.</p>' ||
      '<h2>9. Tax and reporting</h2>' ||
      '<p>9.1 You are responsible for your own tax. We do not deduct tax or National Insurance from your rewards. A reward given as a Gift Card is still a reward, and you are responsible for declaring it where required.</p>' ||
      '<p>9.2 You should keep records of what you earn and declare it to HMRC where required. Please check gov.uk or take advice about your own position, including any allowances that may apply.</p>' ||
      '<p>9.3 Where UK law requires us to share information about you or your rewards with HMRC, you agree to give us the information we need.</p>' ||
      '<h2>10. How you must promote us</h2>' ||
      '<p>10.1 You must be honest, clear and fair. You must not make false or misleading claims about us, our cleaners, our prices or what other Partners earn.</p>' ||
      '<p>10.2 You must not promise or imply income, guarantee earnings or use the word &quot;guaranteed&quot; about rewards.</p>' ||
      '<p>10.3 You must make it clear that you may be rewarded for a recommendation. If you promote us online or on social media, you must label the post clearly, for example with &quot;ad&quot; or &quot;paid partnership&quot;, in line with Advertising Standards Authority (ASA), Committee of Advertising Practice (CAP) and Competition and Markets Authority (CMA) guidance.</p>' ||
      '<p>10.4 You must follow the unfair commercial practices rules in Part 4 of the Digital Markets, Competition and Consumers Act 2024. You must not post or ask for fake or misleading reviews, or hide that a review was rewarded.</p>' ||
      '<p>10.5 You must not send unsolicited marketing messages, spam or bulk messages on our behalf. You must follow the Privacy and Electronic Communications Regulations 2003 (PECR), including having the right permission before you send marketing by email, text or social media message, and respecting opt-outs and telephone preference registrations.</p>' ||
      '<p>10.6 You may use only our approved materials, name and logo, and only to promote our services. You must not impersonate us, pretend to be our employee or agent, or create websites, social media accounts or adverts that could be mistaken for ours.</p>' ||
      '<p>10.7 You must not bid on our name or brand terms in paid search, or use our name in a web address, without our written permission.</p>' ||
      '<p>10.8 You must not promote us in a way that is unlawful, discriminatory, harmful or likely to bring us into disrepute, and you must not direct promotion at children.</p>' ||
      '<p>10.9 If we ask you to remove or correct a post or advert that breaks these terms, you must do so promptly.</p>' ||
      '<h2>11. Rewards come from sales, not from recruitment</h2>' ||
      '<p>11.1 Rewards are paid only for customers and businesses that actually buy our services. We do not pay rewards for recruiting other Partners, and you do not earn from other Partners&#x27; referrals.</p>' ||
      '<p>11.2 You do not have to pay anything, buy any stock or meet any target to become or remain a Partner.</p>' ||
      '<h2>12. Your information and the information you share (data protection)</h2>' ||
      '<p>12.1 We are the controller of the personal information you give us as a Partner. We are registered with the ICO under number ZC264981.</p>' ||
      '<p>12.2 We use your information to assess your application, verify your identity, run the programme, pay you, prevent fraud, meet our legal duties and, where you have agreed, send you marketing. Our privacy notice explains this in more detail, including how long we keep information.</p>' ||
      '<p>12.3 We share your information only where needed, with Gift Card and identity providers, professional advisers, regulators and law enforcement where required by law.</p>' ||
      '<p>12.4 You must not give us another person&#x27;s contact details unless that person has agreed that you can pass them on and has been told that we will contact them. You must not share the personal information of people who have not agreed.</p>' ||
      '<p>12.5 You have rights over your information under UK data protection law, including to access, correct and delete it, to object to its use and to complain to the ICO or any successor regulator. If you want to complain to us about how we handle your information, please email hello@opulencebliss.com. We will acknowledge your complaint within 3 working days and reply without undue delay, and within 30 days in any case.</p>' ||
      '<p>12.6 We send marketing messages only if you have agreed, and you can withdraw consent at any time.</p>' ||
      '<h2>13. Fraud and misuse</h2>' ||
      '<p>13.1 You must not refer yourself or anyone who lives at your address or shares your email address, make or encourage fake bookings or accounts, offer cash or other payments to make people book, or misuse your link, code or any promotion.</p>' ||
      '<p>13.2 If we reasonably believe you have broken this clause, we may withhold rewards, deduct rewards already paid from future rewards, suspend or close your account and, where appropriate, report the matter to the authorities.</p>' ||
      '<h2>14. Changes to rewards and these terms</h2>' ||
      '<p>14.1 We may change these terms, the rewards, or the programme by giving you at least 30 days&#x27; written notice.</p>' ||
      '<p>14.2 A change does not reduce a reward on a referral that was already made before the date of the notice, as long as the customer books or the Business signs within 90 days of that date.</p>' ||
      '<p>14.3 If you keep promoting us after a change takes effect, you accept it. If you do not agree, you can close your account.</p>' ||
      '<h2>15. Suspension and ending your account</h2>' ||
      '<p>15.1 You can close your account at any time by emailing hello@opulencebliss.com. We can end this agreement by giving you 14 days&#x27; written notice.</p>' ||
      '<p>15.2 We may suspend or close your account immediately if you seriously break these terms, act dishonestly, or put us or others at risk.</p>' ||
      '<p>15.3 When your account ends, we will give you the rewards that you had already earned under clauses 5 and 6, subject to clauses 6.9, 8.6 and 13.2. Referrals made through your link after your account closes do not earn rewards.</p>' ||
      '<p>15.4 Clauses 6.9, 8.6, 9, 12, 13, 16, 17 and 19 continue to apply after your account ends.</p>' ||
      '<h2>16. Liability</h2>' ||
      '<p>16.1 Nothing in these terms excludes or limits liability for death or personal injury caused by negligence, for fraud or for anything else that cannot be excluded by law.</p>' ||
      '<p>16.2 Subject to clause 16.1, we are not liable for loss of earnings, loss of rewards that you expected but did not earn, or any indirect loss. Our total liability to you in connection with these terms is limited to the rewards we owe you.</p>' ||
      '<p>16.3 We do not promise that any person you refer will book, or that we will accept any Business. We are not responsible for your costs of promoting us.</p>' ||
      '<h2>17. Intellectual property</h2>' ||
      '<p>17.1 Our name, logo, website and materials belong to us. We give you a limited, revocable permission to use our approved materials only to promote our services as set out in these terms. This permission ends when your account ends.</p>' ||
      '<h2>18. Complaints and disputes</h2>' ||
      '<p>18.1 If you have a complaint, including about a reward, please email hello@opulencebliss.com within 30 days. We will acknowledge it within 3 working days and aim to reply in full within 14 days. Our Complaints Procedure explains each stage.</p>' ||
      '<p>18.2 If we cannot resolve a dispute, we will try mediation before either of us goes to court.</p>' ||
      '<h2>19. General</h2>' ||
      '<p>19.1 These terms are the whole agreement between us on this subject and replace earlier discussions.</p>' ||
      '<p>19.2 If any part is found to be unenforceable, the rest continues to apply.</p>' ||
      '<p>19.3 If we delay in enforcing a right, we have not given it up.</p>' ||
      '<p>19.4 You may not transfer your rights or duties under these terms without our written consent. We may transfer ours to another company if it carries on the business.</p>' ||
      '<p>19.5 Only you and we have rights under these terms. Nobody else can enforce them under the Contracts (Rights of Third Parties) Act 1999.</p>' ||
      '<p>19.6 We are not responsible for delay or failure caused by events outside our reasonable control.</p>' ||
      '<p>19.7 We may give you notices by email to the address on your account, and you may give us notices at hello@opulencebliss.com.</p>' ||
      '<p>19.8 These terms and any dispute arising from them are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.</p>' ||
      '<h2>20. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 ICO registration number: ZC264981 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  '7df08599d8d2f27758e13307364d44836059cae2df3e3b6feccff2893fc69ed1',
  '2026-10-01/partner-programme.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'cleaner-cancellation',
  'Cleaner Cancellation Policy',
  'professionals',
  '<div data-final-pack="2026-10-01"><p>CLEANER CANCELLATION POLICY Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 This policy forms part of the Cleaner Terms and Conditions. It applies to self-employed cleaners who accept Bookings through our platform.</p>' ||
      '<h2>1. Why this policy exists</h2>' ||
      '<p>1.1 When a Cleaner accepts a Booking, the customer and Opulence Bliss Ltd (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) rely on that Booking going ahead. A cancelled visit leaves a household without a clean at short notice and can cost us a refund, so we set out the rules clearly here.</p>' ||
      '<p>1.2 You are self-employed. You choose which Bookings to accept. This policy applies once you have accepted a Booking. Nothing in it requires you to accept any Booking or to work any minimum number of hours.</p>' ||
      '<p>1.3 Terms such as &quot;Booking&quot; and &quot;Cleaner&quot; have the same meaning as in the Cleaner Terms and Conditions and the Customer Terms and Conditions.</p>' ||
      '<h2>2. Cancelling a Booking you have accepted</h2>' ||
      '<p>2.1 If you cannot attend a Booking, tell us as soon as you can through the platform or by emailing hello@opulencebliss.com. The more notice you give, the easier it is for us to find another Cleaner for the customer.</p>' ||
      '<p>2.2 We encourage you to reschedule a Booking with the customer, rather than cancel it, wherever you can. A Booking moved to a new time that the customer agrees to is not a cancellation.</p>' ||
      '<p>2.3 You have 2 grace cancellations in each calendar month. A grace cancellation is a cancellation of an accepted Booking that has no consequence for your account. The grace cancellations do not carry over to the next month.</p>' ||
      '<p>2.4 We do not charge Cleaners for cancelling. If you cancel a third accepted Booking in the same calendar month, we may suspend your account under clause 5 instead.</p>' ||
      '<p>2.5 Cancellations made by us, or because the customer cancelled, do not count towards your two grace cancellations, and your account is not affected.</p>' ||
      '<h2>3. Cancellations that do not count</h2>' ||
      '<p>3.1 The cancellation does not count towards the monthly limit, where you cannot attend because of:</p>' ||
      '<p>• your own sudden illness or injury, an emergency involving you or a close family member, or a bereavement;</p>' ||
      '<p>• an unsafe home, unsafe conditions at the property or unacceptable behaviour by the customer, reported to us promptly;</p>' ||
      '<p>• transport disruption or severe weather that makes safe travel impossible; or</p>' ||
      '<p>• a reason beyond your reasonable control.</p>' ||
      '<p>3.2 Please tell us as soon as you can, and give us a short explanation. We may ask for reasonable evidence for repeated cases but will not ask for medical details beyond what is needed.</p>' ||
      '<h2>4. No-shows</h2>' ||
      '<p>4.1 A no-show means you do not attend an accepted Booking and do not tell us before it starts.</p>' ||
      '<p>4.2 A no-show may lead to suspension under clause 5, whether or not you have used your grace cancellations. We will contact you to understand what happened before we decide.</p>' ||
      '<p>4.3 If you cannot arrive on time, tell us and the customer as early as you can. Arriving late is not a cancellation, but repeated lateness may be dealt with under clause 5.</p>' ||
      '<h2>5. Repeated cancellations and suspension</h2>' ||
      '<p>5.1 We may suspend or close your account if there is a pattern of cancellations or no-shows, or a single serious incident, for example:</p>' ||
      '<p>• one no-show where you did not tell us before the visit;</p>' ||
      '<p>• three cancellations in the same calendar month; or</p>' ||
      '<p>• cancelling Bookings in order to take the work directly from the customer outside the platform.</p>' ||
      '<p>5.2 Before suspending your account, we will tell you why, give you the chance to explain, and take your explanation into account, unless there is a serious safety risk.</p>' ||
      '<p>5.3 We will give you a written decision and reasons. If you disagree, you can ask us to review it by emailing hello@opulencebliss.com within 14 days. We will reply within 14 days.</p>' ||
      '<p>5.4 Suspension or closure does not remove your right to be paid for work you have already done properly.</p>' ||
      '<h2>6. When the customer cancels</h2>' ||
      '<p>6.1 If a customer cancels late and we charge them under the Cancellations, Payment and Refunds Policy, you are paid your usual rate for the Booking in the same proportion. For example, if the customer is charged 50% of the Booking, you receive 50% of what you would have earned for it.</p>' ||
      '<p>6.2 You may decide to charge the customer less than the full amount, or nothing, for example to keep a good relationship. If you do, tell us before the Booking time or within 24 hours afterwards. We will then reduce your pay in line with your decision and refund the customer the difference.</p>' ||
      '<p>6.3 We encourage customers and Cleaners to reschedule a Booking rather than cancel it. If you agree a new time with the customer, no cancellation charge applies.</p>' ||
      '<p>6.4 If the customer cannot be reached or does not let you in, wait 15 minutes, try to contact them through the platform and tell us. We will confirm whether the Booking counts as completed.</p>' ||
      '<h2>7. Fairness, status and changes</h2>' ||
      '<p>7.1 Nothing in this policy makes you our employee or worker. You decide whether to accept or decline work. If you cannot attend, tell us as set out in clause 2.1. To protect customers, only Cleaners who have passed our identity, right-to-work and DBS checks may enter a customer&#x27;s home. You therefore cannot send a substitute. If you cannot attend, we will offer the Booking to another Cleaner who has already passed our checks.</p>' ||
      '<p>7.2 We may change this policy by giving you at least 30 days&#x27; written notice. A change applies to Bookings you accept after it takes effect.</p>' ||
      '<h2>8. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd</p>' ||
      '<p>128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  'f6dbb8e3b9a255a07e125c14514e8a8c888fc534568c1384c4e4436ec554c1e4',
  '2026-10-01/cleaner-cancellation.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'handyman-professional-terms',
  'Handyman Terms and Conditions',
  'professionals',
  '<div data-final-pack="2026-10-01"><p>HANDYMAN TERMS AND CONDITIONS Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 These terms are for self-employed handymen and trades who carry out repair, maintenance and installation work through our platform. They include our Cancellation and Suspension rules (clause 9).</p>' ||
      '<h2>1. About us and these terms</h2>' ||
      '<p>1.1 These terms apply between Opulence Bliss Ltd (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) and each person who joins our platform as a handyman (&quot;you&quot;). We are a company registered in England and Wales, company number 15894675, registered office 128 City Road, London, United Kingdom, EC1V 2NX. ICO registration number: ZC264981. Contact: hello@opulencebliss.com.</p>' ||
      '<p>1.2 We run an online platform that connects households and businesses in London with self-employed cleaners and handymen. Cleaners are covered by our Cleaner Terms and Conditions.</p>' ||
      '<p>1.3 In these terms:</p>' ||
      '<p>• Job means a piece of handyman work that a customer books through the platform.</p>' ||
      '<p>• Quote means the price you give a customer for a Job through the platform. It has two parts: Labour (your workmanship and time) and Materials.</p>' ||
      '<p>• Regulated Work means work that the law says only a registered or qualified person may do, including gas work and notifiable electrical work.</p>' ||
      '<p>1.4 You accept these terms by ticking the box and selecting &quot;I accept&quot; when you register, or by accepting your first Job. We keep a record of the date and the version you accepted. If you do not agree, please do not join.</p>' ||
      '<h2>2. Eligibility and checks</h2>' ||
      '<p>2.1 You must be at least 18 years old and have the legal right to work or to carry out self-employed work in the United Kingdom.</p>' ||
      '<p>2.2 Before you take Jobs, we will check your identity and right to work, review your experience, and ask for proof of your qualifications and registrations (see clause 3).</p>' ||
      '<p>2.3 You must have a current basic Disclosure and Barring Service (DBS) check, which you apply for yourself and pay for, at https://www.gov.uk/request-copy-criminal-record. You must show us your certificate before your first Job. We handle this information as set out in clause 14 and in our DBS and criminal-offence data policy.</p>' ||
      '<p>2.4 You must tell us promptly if anything you have told us changes, including any caution, conviction, restriction on your registration or loss of insurance.</p>' ||
      '<p>2.5 We may refuse an application or repeat any check at any time.</p>' ||
      '<h2>3. Qualifications, registration and Regulated Work</h2>' ||
      '<p>3.1 You may only accept Jobs that you are properly qualified, trained, insured and, where the law requires, registered to carry out. You must not take on or quote for work outside your competence.</p>' ||
      '<p>3.2 Gas work. You may carry out gas work only if you are on the Gas Safe Register for the type of work involved. You must show us your Gas Safe ID card and registration number, and keep</p>' ||
      '<p>your registration current. You must give the customer a gas safety record or certificate where the law requires.</p>' ||
      '<p>3.3 Electrical work. You may carry out notifiable electrical work (work covered by Part P of the Building Regulations) only if you are registered with a competent person scheme, or the work is notified to Building Control as the law requires. You must show us proof of your registration or qualification, and give the customer the right certificate (for example an Electrical Installation Certificate or Minor Works Certificate) and any building-regulations notification.</p>' ||
      '<p>3.4 Other regulated work. This includes, for example, certain water-fittings work, work on fire safety equipment, and work that needs building control or other approval. Where a registration or notification is needed, you must have it and keep it current.</p>' ||
      '<p>3.5 Without the right registration you must not carry out gas work or notifiable electrical work, however small it seems. If you do, we may close your account immediately.</p>' ||
      '<p>3.6 We do not allow Jobs involving asbestos, structural work or work at height beyond what you are trained and equipped for, and you must stop and tell us if you find asbestos or an unsafe structure.</p>' ||
      '<p>3.7 You must keep your documents current and send us renewed copies. We may suspend your account if a registration or certificate lapses.</p>' ||
      '<h2>4. Your status: self-employed</h2>' ||
      '<p>4.1 You are self-employed. Nothing in these terms makes you our employee, worker, partner or agent, and you have no authority to bind us.</p>' ||
      '<p>4.2 You choose which jobs to accept and when. We do not guarantee any minimum amount of work. You may work for other clients and other platforms, subject to clause 12.</p>' ||
      '<p>4.3 You use your own tools, equipment and vehicle, and you decide how to carry out each Job, within the standards in these terms and the law.</p>' ||
      '<p>4.4 You are responsible for your own tax and National Insurance, for registering with HMRC as self-employed where required, and for your own insurance and tools. We do not deduct tax from what we pay you.</p>' ||
      '<h2>5. Quotes and Jobs</h2>' ||
      '<p>5.1 Jobs are offered through the platform. You assess the Job (from the customer&#x27;s photos, video, description or a visit) and give a written Quote through the platform, showing Labour and Materials separately.</p>' ||
      '<p>5.2 The Quote must be fair and clear, and you must not exceed it without the customer&#x27;s agreement. If the Job changes or turns out to need more time or materials, you must tell us and the customer and get the customer&#x27;s agreement through the platform before you do the extra work.</p>' ||
      '<p>5.3 A Job is confirmed when the customer accepts your Quote and books a date. Quotes are open for 30 days unless they say otherwise.</p>' ||
      '<p>5.4 You must arrive on time, work safely and to a good standard, keep the area tidy and respect the customer&#x27;s home and belongings. You must photograph the work before and after, where reasonable, and keep records.</p>' ||
      '<p>5.5 You must keep to the agreed scope. You must not do work the customer has not agreed or leave the Job unfinished without good reason.</p>' ||
      '<h2>6. Pay and commission</h2>' ||
      '<p>6.1 Labour. We take 25% commission on the Labour part of each Quote. You receive 75% of the Labour. The commission is taken from the Labour only. For example, if the labour is £200, you receive £150.</p>' ||
      '<p>6.2 Materials. We take no commission and no mark-up on Materials. You receive back what you paid for the Materials, at cost, as set out in clause 7.</p>' ||
      '<p>6.3 We pay the payment-processing costs on payments to you. They are not deducted from your pay.</p>' ||
      '<p>6.4 You can choose to be paid weekly, every two weeks or monthly, by bank transfer through Stripe. There is no minimum payout. Each payment shows a breakdown of Labour, commission, Materials reimbursed, tips and any agreed deductions.</p>' ||
      '<p>6.5 You are paid for Jobs that are completed and paid for by the customer. We may withhold or reduce payment for a Job that was not completed, was cancelled by you without proper notice, or where the customer is refunded because of your breach or poor workmanship.</p>' ||
      '<p>6.6 We may change the commission or other terms by giving you at least 30 days&#x27; written notice. A change does not affect Quotes already accepted.</p>' ||
      '<h2>7. Materials</h2>' ||
      '<p>7.1 For each Job, the Quote states the Materials and their estimated cost. The customer may buy the materials themselves, or pay us for them, in which case you buy them.</p>' ||
      '<p>7.2 If you buy the Materials, you must keep the receipt and upload it to the platform. We pay you the amount on the receipt, up to the Materials amount in the accepted Quote, with your next payout. We may agree in writing to pay you in advance for larger orders.</p>' ||
      '<p>7.3 You must buy suitable materials of reasonable quality at a fair price. You must not buy more than the Job needs.</p>' ||
      '<p>7.4 If the Materials cost more than the Quote, you must get the customer&#x27;s agreement before you buy them. We pay you the extra only if the customer agrees.</p>' ||
      '<p>7.5 If Materials are unused, or the Job is cancelled before they are fitted, you must return them where possible and we will refund the customer. If they cannot be returned, we deal with the cost under the customer terms and your clause 9 rights.</p>' ||
      '<p>7.6 Materials you bought remain yours until the customer has paid for them.</p>' ||
      '<h2>8. Tips</h2>' ||
      '<p>8.1 Tips are voluntary. You keep 100% of tips. We take no share and deduct no fees. Tips are paid in your next payout and are your own income to declare to HMRC where required.</p>' ||
      '<h2>9. Cancellations, no-shows and suspension</h2>' ||
      '<p>9.1 We encourage you to reschedule a Job with the customer rather than cancel it. A Job moved to a new time that the customer agrees is not a cancellation.</p>' ||
      '<p>9.2 You have 2 grace cancellations in each calendar month. We do not charge you for cancelling, but if you cancel a third accepted Job in the same calendar month, we may suspend your account.</p>' ||
      '<p>9.3 A no-show, meaning you do not attend and do not tell us before the visit, may lead to suspension.</p>' ||
      '<p>9.4 These cancellations do not count towards the limit: your own sudden illness or injury, an emergency involving you or a close family member, a bereavement, an unsafe home or unacceptable behaviour by the customer (reported promptly), transport disruption or severe weather, or a reason beyond your control. Tell us as soon as you can.</p>' ||
      '<p>9.5 Before we suspend your account, we will tell you why and give you the chance to explain, unless there is a serious safety risk. We will give you written reasons, and you can ask for a review within 14 days.</p>' ||
      '<p>9.6 When a customer cancels late. If the customer cancels and is charged under our customer cancellation rules, you are paid your usual share of the Labour in the same proportion. You may choose to charge the customer less, or nothing. Tell us before the visit or within 24 hours afterwards, and we will adjust your pay and refund the customer.</p>' ||
      '<p>9.7 If the customer cancels after you have ordered special or non-returnable Materials, we reimburse you for them at cost, with receipts.</p>' ||
      '<h2>10. Standards of conduct and safety</h2>' ||
      '<p>10.1 You must act honestly, safely, lawfully and respectfully. Harassment, discrimination, violence, theft, working under the influence of drink or drugs and any breach of customer privacy are not tolerated.</p>' ||
      '<p>10.2 You must work safely and follow health and safety law, assess risks before each Job, use suitable personal protective equipment, and report accidents, damage and safeguarding concerns to us promptly. You must follow our Safeguarding, Lone Working and Incident Reporting Policy.</p>' ||
      '<p>10.3 You must keep customers&#x27; keys, access codes and personal information secure and use them only for the Job.</p>' ||
      '<p>10.4 You must not take away waste unless you hold a waste carrier registration. Otherwise, you must leave the waste with the customer or arrange legal disposal with them.</p>' ||
      '<h2>11. Workmanship guarantee</h2>' ||
      '<p>11.1 You must carry out each Job with reasonable care and skill. You guarantee your workmanship for 30 days from completion.</p>' ||
      '<p>11.2 If the customer reports a defect in your workmanship within that time, you must put it right at no extra charge within a reasonable time, usually within 7 days of being told.</p>' ||
      '<p>11.3 If you do not put it right, we may arrange another handyman to do so, and deduct their reasonable cost from your pay, up to the Labour you were paid for that Job. We will tell you in writing before we do this.</p>' ||
      '<p>11.4 The guarantee does not cover faults in Materials the customer insisted on against your advice, or damage caused by the customer or another person after the Job.</p>' ||
      '<p>11.5 This does not limit the customer&#x27;s legal rights, or yours.</p>' ||
      '<h2>12. Keeping customers on the platform</h2>' ||
      '<p>12.1 Customers introduced to you through the platform are customers of the platform. While you work with us and for 12 months after your account closes, you must not take, or offer to take, work from those customers outside the platform, ask or encourage them to stop using it, or accept payment from them other than through the platform for work arising from a platform Job.</p>' ||
      '<p>12.2 This does not apply to customers you served before joining us and told us about in writing when you applied, or to work a customer asks you to do after leaving the platform for reasons unconnected to you.</p>' ||
      '<p>12.3 If you break this clause, we may close your account, withhold unpaid amounts that arise from the breach, and take any other action the law allows.</p>' ||
      '<h2>13. Insurance and liability</h2>' ||
      '<p>13.1 We hold public liability insurance for our business. You must hold your own public liability insurance, with cover of at least £2,000,000 for any one claim, that covers the type of work you do (including any gas or electrical work), before your first Job and for as long as you work through the platform. You must send us a copy of your certificate when you apply and at each renewal, and tell us at once if it is cancelled or changed. If your cover lapses, we may suspend your account until you give us proof.</p>' ||
      '<p>13.2 Our insurance does not replace yours, and we do not promise that it covers any claim arising from your work. You must not do anything that invalidates your cover.</p>' ||
      '<p>13.3 You are responsible for loss or damage you cause by your own negligence or breach of these terms, and you must report any incident promptly.</p>' ||
      '<p>13.4 Nothing in these terms excludes or limits liability for death or personal injury caused by negligence, for fraud or for anything else that cannot be excluded by law.</p>' ||
      '<p>13.5 Subject to clause 13.4, we are not liable for loss of earnings, loss of Jobs or any indirect loss, and our total liability to you in connection with these terms is limited to the amounts we owe you.</p>' ||
      '<h2>14. Your information (data protection)</h2>' ||
      '<p>14.1 We are the controller of the personal information you give us. We are registered with the ICO under number ZC264981.</p>' ||
      '<p>14.2 We use your information to assess your application, check qualifications and registrations, run Jobs, pay you, prevent fraud, keep customers and handymen safe, meet our legal duties and, with your consent, send you marketing.</p>' ||
      '<p>14.3 We share it only where needed, with payment providers such as Stripe, checking and insurance providers, professional advisers and regulators. We share limited information with customers, such as your first name, photograph, registrations and rating.</p>' ||
      '<p>14.4 We keep your DBS outcome and certificate date as set out in our DBS and criminal-offence data policy, and do not keep a copy of the certificate for longer than the period in that policy.</p>' ||
      '<p>14.5 You have rights over your information under UK data protection law. Our privacy notice, available on our website, explains how to use them. If you want to complain to us about how we handle your information, email hello@opulencebliss.com. We will acknowledge your complaint within 3 working days and reply without undue delay, and within 30 days in any case. You may also complain to the ICO.</p>' ||
      '<h2>15. Tax and reporting</h2>' ||
      '<p>15.1 You are responsible for your own tax. UK rules on reporting by digital platforms may require us to share information about you and your earnings with HMRC. You agree to give us the information needed to do so.</p>' ||
      '<h2>16. Ending your account</h2>' ||
      '<p>16.1 You can close your account at any time by giving us 7 days&#x27; written notice. We can end this agreement by giving you 14 days&#x27; written notice.</p>' ||
      '<p>16.2 We may suspend or close your account immediately if you seriously breach these terms, work without a required registration, act dishonestly or unsafely, put a customer at risk, make false claims or commit fraud.</p>' ||
      '<p>16.3 When your account ends, we will pay you for Jobs completed and reimburse your Materials, subject to clauses 6.5, 11.3 and 12.3. Clauses 12, 13, 14 and 15 continue to apply.</p>' ||
      '<h2>17. Changes, complaints and general</h2>' ||
      '<p>17.1 We may update these terms by giving you at least 30 days&#x27; notice of changes that affect your pay. If you keep working with us after a change takes effect, you accept it. If you do not agree, you can close your account.</p>' ||
      '<p>17.2 If you have a complaint, including about a payment, contact hello@opulencebliss.com within 30 days. We will acknowledge it within 3 working days and aim to reply in full within 14 days. Our Complaints Procedure explains each stage. If we cannot resolve a dispute, we will try mediation before either of us goes to court.</p>' ||
      '<p>17.3 These terms are the whole agreement between us on this subject. If any part is unenforceable, the rest continues to apply. You may not transfer your rights without our consent. Only you and we have rights under these terms under the Contracts (Rights of Third Parties) Act 1999. They are governed by the law of England and Wales, and its courts have exclusive jurisdiction.</p>' ||
      '<h2>18. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 ICO registration number: ZC264981 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  '1a6b6c3670c9d237f2b95156e697755e22d4ca2a88729289ba00ebc9a62979d7',
  '2026-10-01/handyman-professional-terms.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'safeguarding',
  'Safeguarding, Lone Working and Incident Policy',
  'professionals',
  '<div data-final-pack="2026-10-01"><p>SAFEGUARDING, LONE WORKING AND INCIDENT REPORTING POLICY For cleaners and handymen | Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 This policy sets out how we keep customers, and the cleaners and handymen who work in their homes, safe. It forms part of the Cleaner Terms and Conditions and the Handyman Terms and Conditions. In this policy &quot;you&quot; means a cleaner or handyman working through our platform.</p>' ||
      '<h2>1. Why this policy matters</h2>' ||
      '<p>1.1 You work alone, inside people&#x27;s homes and businesses. That brings two kinds of risk: risk to your own safety, and risk to customers who may be vulnerable, such as older people, disabled people, people who are unwell and children.</p>' ||
      '<p>1.2 We take both seriously. This policy tells you what to expect from us, what we expect from you, and exactly what to do when something goes wrong.</p>' ||
      '<p>1.3 If anyone is in immediate danger, call 999 first. Then tell us.</p>' ||
      '<h2>2. Who is responsible</h2>' ||
      '<p>2.1 Our Safeguarding Lead is the owner of Opulence Bliss Ltd. They receive all safeguarding concerns and incident reports, decide what happens next, and keep the records. Contact: hello@opulencebliss.com or +44 7484 717935.</p>' ||
      '<p>2.2 Our onboarding team explains this policy to every new cleaner and handyman and keeps records of who has been briefed.</p>' ||
      '<p>2.3 Everyone who works through the platform is responsible for following this policy and for reporting concerns. You are not expected to investigate or to decide whether something is abuse. Your job is to notice, to keep people safe, and to tell us.</p>' ||
      '<h2>3. Who we mean by vulnerable</h2>' ||
      '<p>3.1 A child is anyone under 18.</p>' ||
      '<p>3.2 An adult at risk is an adult who needs care and support, and who is experiencing, or is at risk of, abuse or neglect, and is unable to protect themselves because of those needs. This can include people with dementia, a physical or learning disability, a mental health condition, or frailty, and people who are isolated.</p>' ||
      '<p>3.3 Vulnerability can be temporary, for example after an illness or bereavement. Treat everyone with respect, and take extra care where you notice signs that someone may need extra help.</p>' ||
      '<p>3.4 We do not ask customers about health conditions when they book. If a customer tells us, or you notice, we may note only what is needed to keep them safe, such as &quot;needs extra time at the door&quot; or &quot;hard of hearing&quot;.</p>' ||
      '<h2>4. Before a booking</h2>' ||
      '<p>4.1 Every cleaner and handyman has been through our checks: identity, right to work, a basic DBS certificate and insurance. A basic DBS check does not cover everything, so it does not replace your own vigilance.</p>' ||
      '<p>4.2 If a customer tells us before a booking that they are vulnerable or live with someone who is, we will, where we can send the same cleaner or handyman each time, and tell you any practical needs.</p>' ||
      '<p>4.3 You must give us an emergency contact when you register, and keep it up to date.</p>' ||
      '<p>4.4 You will receive the address, date, time and any access or safety notes through the platform. Do not accept a booking if you do not feel safe doing so.</p>' ||
      '<h2>5. Working with vulnerable customers</h2>' ||
      '<p>5.1 Always treat the customer with dignity and respect. Speak clearly and calmly, use their name, and give them time to answer.</p>' ||
      '<p>5.2 You are there to clean or to do repair work. Do not provide personal care, such as washing, dressing, toileting, feeding or giving medicines, and do not give medical advice. If a customer asks for this, politely decline and tell us.</p>' ||
      '<p>5.3 Do not take, handle or hold money, bank cards, PINs, cheque books or valuables. Do not accept gifts of value, loans or any request to be added to a will or given power of attorney. Do not offer or ask for personal favour. Tell us if anyone asks you to do any of these things.</p>' ||
      '<p>5.4 Do not take photographs of the customer, of other people in the home or of their personal belongings. Photograph the work only, where the terms allow, and keep other people out of the picture.</p>' ||
      '<p>5.5 Where children are present, you must never be alone with a child, never provide childcare, and never be in a child&#x27;s bedroom or bathroom while they are in it. Keep to the areas you have been asked to work in.</p>' ||
      '<p>5.6 Do not share a customer&#x27;s personal details, health or circumstances with anyone except us, or the emergency services if needed.</p>' ||
      '<p>5.7 Respect a customer&#x27;s choices. Do not move or touch medication, medical equipment, mobility aids or documents unless the customer asks and it is safe.</p>' ||
      '<p>5.8 If a customer seems confused, distressed or unwell, stay calm. If they need urgent medical help, call 999. Then tell us.</p>' ||
      '<h2>6. What to look for and what to do</h2>' ||
      '<p>6.1 Signs that a customer may be at risk include:</p>' ||
      '<p>• unexplained injuries, bruises or marks, or poor hygiene and neglect;</p>' ||
      '<p>• being very afraid of, or controlled by, another person;</p>' ||
      '<p>• missing money or belongings, or sudden changes to their finances;</p>' ||
      '<p>• no food, heating or care, or unsafe living conditions;</p>' ||
      '<p>• being locked in, or not allowed to speak for themselves;</p>' ||
      '<p>• a child who seems fearful, hungry, unsupervised or injured, or who tells you something worrying.</p>' ||
      '<p>6.2 If you see something that worries you:</p>' ||
      '<p>• Immediate danger: call 999.</p>' ||
      '<p>• Otherwise, tell the Safeguarding Lead the same day, and as soon as you safely can. Use the platform or call +44 7484 717935.</p>' ||
      '<p>• Write down what you saw or heard, with the date, time and place. Record facts and the person&#x27;s own words, not your opinions.</p>' ||
      '<p>• Do not confront anyone, investigate, promise to keep a secret, or tell other people. If someone tells you something serious, listen, stay calm, say you are glad they told you, and explain that you must pass it on to keep them safe.</p>' ||
      '<p>6.3 We will decide what to do, which may include contacting the local authority adult safeguarding team or children&#x27;s services, the police, or the customer&#x27;s family or doctor, depending on the situation. We will tell you what we need from you. You will not be punished for raising a concern in good faith, even if it turns out to be mistaken.</p>' ||
      '<p>6.4 Helpful national numbers: NSPCC helpline 0808 800 5000 (children); Action on Elder Abuse 080 8808 8141. The local authority safeguarding team for the customer&#x27;s borough can also be contacted.</p>' ||
      '<h2>7. Concerns about a cleaner or handyman</h2>' ||
      '<p>7.1 If a customer or anyone else raises a concern about a cleaner or handyman, we take it seriously and act promptly.</p>' ||
      '<p>7.2 We may suspend the person from bookings while we look into it, which is not a finding that they did anything wrong. We will tell them what is being said, give them the chance to respond, and decide fairly.</p>' ||
      '<p>7.3 Where the concern involves a possible crime or serious risk, we will tell the police or the right authority. Where needed, we will also tell the person&#x27;s customers.</p>' ||
      '<p>7.4 If you have a concern about how we or another cleaner or handyman is working, tell us. If you feel you cannot, you can contact the relevant local authority or the police.</p>' ||
      '<h2>8. Lone working: staying safe</h2>' ||
      '<p>8.1 Before you go. Check the booking details and any notes. Make sure your phone is charged and has the platform open. Tell us if you are running late.</p>' ||
      '<p>8.2 Check in and out. Check in on the platform when you arrive and check out when you leave. If your plans change, tell us.</p>' ||
      '<p>8.3 At the door. Trust your instincts. Do not go in if the customer seems drunk, aggressive or unsafe, if someone else at the property makes you uneasy, or if the situation is not as the booking said. You can leave at any time, and you will not be penalised. Tell us straight away.</p>' ||
      '<p>8.4 While you work. Know where the exits are and keep your route to the door clear. Keep your phone, keys and valuables with you. Do not let anyone stand between you and the exit. Do not work in a locked room, and do not go into areas you are not asked to work in. Handymen must follow safe-working rules for ladders, tools, electricity, gas and water, and must not work at height beyond their training.</p>' ||
      '<p>8.5 Pets and hazards. Ask the customer to secure pets. Report broken fittings, wet floors, mould, pests, needles and other hazards, and stop if you are not safe.</p>' ||
      '<p>8.6 Behaviour you must not tolerate. Harassment, unwanted touching, sexual comments, threats, discrimination or being asked to do anything that makes you uncomfortable. Leave if you need to and tell us. We will support you and, where appropriate, stop sending cleaners to that customer.</p>' ||
      '<p>8.7 Never put yourself at risk to protect property. Your safety comes first.</p>' ||
      '<h2>9. Our check-in procedure</h2>' ||
      '<p>9.1 We monitor check-ins during our operating hours (7am -8pm). If you do not check in within 30 minutes of the booking start time and we cannot reach you, we will:</p>' ||
      '<p>• phone and message you;</p>' ||
      '<p>• if there is no answer within 15 minutes, phone your emergency contact; and</p>' ||
      '<p>• If there is still no answer and we are worried, ask the police to carry out a welfare check at the booking address.</p>' ||
      '<p>9.2 If you cannot use the platform, tell us another way, by phone or email, and we will log it.</p>' ||
      '<h2>10. Reporting incidents</h2>' ||
      '<p>10.1 Report to us any of the following, however small:</p>' ||
      '<p>• an injury or illness at work, or a near miss;</p>' ||
      '<p>• a threat, harassment, abuse or assault, towards you or anyone else;</p>' ||
      '<p>• damage to property or an allegation of theft;</p>' ||
      '<p>• a safeguarding concern (section 6);</p>' ||
      '<p>• a data incident, such as a lost key or access code, or personal information sent to the wrong person; and</p>' ||
      '<p>• a vehicle accident or anything else that affected your work.</p>' ||
      '<p>10.2 How and when. For anything urgent, call +44 7484 717935. Otherwise report through the platform or by email to hello@opulencebliss.com. Report immediately if someone is hurt or in danger, the same day for safeguarding concerns and threats, and within 24 hours for everything else.</p>' ||
      '<p>10.3 What to tell us. What happened, when and where, who was involved, any injuries or damage, what you did, and whether anyone else saw it. Add photos if it is safe and appropriate.</p>' ||
      '<p>10.4 What we do. We will contact you within 24 hours (the same day for serious incidents). We will check you are safe, offer support, record the incident, decide on any action, and tell you the outcome where we can. We may need to tell our insurer, the police, the local authority, the Health and Safety Executive (including under RIDDOR where it applies), or the ICO within 72 hours for a personal data breach.</p>' ||
      '<p>10.5 We keep an incident log and review it at least every 6 months to find ways to make things safer.</p>' ||
      '<h2>11. Records, confidentiality and data protection</h2>' ||
      '<p>11.1 We keep safeguarding and incident records securely. Only the Safeguarding Lead and people who need them can see them. We share information only when we have to, to keep someone safe, or where the law requires or allows it. We do not promise absolute confidentiality when someone may be at risk.</p>' ||
      '<p>11.2 We keep these records for 6 years, or longer where the law, a court or an authority requires. Records about a child are kept for longer where guidance says they should be.</p>' ||
      '<p>11.3 We use this information under UK GDPR, relying on our legal duties, our legitimate interests in keeping people safe, and, where needed, the safeguarding conditions in Schedule 1 of the Data Protection Act 2018. See our Privacy Notice for more.</p>' ||
      '<h2>12. Training and review</h2>' ||
      '<p>12.1 Our onboarding team goes through this policy with every new cleaner and handyman, and you must confirm in writing (a tick box in the platform) that you have read it. We repeat a short refresher at least once a year.</p>' ||
      '<p>12.2 We review this policy at least once a year and after any serious incident, or when the law changes.</p>' ||
      '<h2>13. Quick reference</h2>' ||
      '<p>• Immediate danger: call 999, then tell us.</p>' ||
      '<p>• Worried about a customer: tell the Safeguarding Lead the same day. Write down facts. Do not investigate or promise secrecy.</p>' ||
      '<p>• Feeling unsafe at a booking: leave and tell us. You will not be penalised.</p>' ||
      '<p>• Running late or cannot check in: tell us.</p>' ||
      '<p>• Any incident: report it within 24 hours, and the same day for threats or safeguarding.</p>' ||
      '<h2>14. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 Telephone: +44 7484 717935 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  '36f9a39e473cb01fc7dfd587810affa68782708f03b3e063c70f04bd659f85e3',
  '2026-10-01/safeguarding.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

insert into public.legal_documents (
  slug, title, audience, content_html, version, effective_date,
  pdf_sha256, pdf_path, published, updated_at
) values (
  'dbs-data',
  'DBS and Criminal-Offence Data Policy',
  'professionals',
  '<div data-final-pack="2026-10-01"><p>DBS AND CRIMINAL-OFFENCE DATA POLICY Appropriate Policy Document and Retention Schedule | Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026 This policy explains how we handle the results of basic Disclosure and Barring Service (DBS) checks and any other information about criminal convictions. It is our &quot;appropriate policy document&quot; under Schedule 1 of the Data Protection Act 2018 and forms part of our data protection records.</p>' ||
      '<h2>1. Who we are and what this policy covers</h2>' ||
      '<p>1.1 Opulence Bliss Ltd (&quot;we&quot;, &quot;us&quot;), company number 15894675, 128 City Road, London, United Kingdom, EC1V 2NX, is the controller of the personal information described here. We are registered with the Information Commissioner&#x27;s Office (ICO) under number ZC264981. Contact: hello@opulencebliss.com.</p>' ||
      '<p>1.2 This policy covers the basic DBS certificates that cleaners and handymen show us before they take bookings, and any information about unspent criminal convictions that they or others tell us.</p>' ||
      '<p>1.3 Information about criminal convictions is called &quot;criminal offence data&quot; under Article 10 of the UK GDPR. It needs extra protection.</p>' ||
      '<h2>2. What we process</h2>' ||
      '<p>2.1 We ask each cleaner and handyman to apply for their own basic DBS check at https://www.gov.uk/request-copy-criminal-record and show us the certificate. A basic check shows only unspent convictions and conditional cautions.</p>' ||
      '<p>2.2 We record: the person&#x27;s name, the certificate number and date, whether it showed nothing or showed an unspent conviction, a short note of the decision we made and why, and the date we reviewed it.</p>' ||
      '<p>2.3 We may keep a copy of the certificate only for the short period set out in section 7. We do not ask for, or use, more information about convictions than we need.</p>' ||
      '<h2>3. Why we process it</h2>' ||
      '<p>3.1 Our cleaners and handymen work alone in customers&#x27; homes and businesses, sometimes with children, older people or other vulnerable people. We use DBS results to:</p>' ||
      '<p>• protect customers, their property and the public;</p>' ||
      '<p>• prevent and detect unlawful acts, such as theft, fraud and violence; and</p>' ||
      '<p>• decide whether a person is suitable to work through our platform.</p>' ||
      '<p>3.2 We use the information only for these purposes. We do not use it for marketing or any unrelated purpose.</p>' ||
      '<h2>4. Our legal basis</h2>' ||
      '<p>4.1 UK GDPR Article 6(1)(f), legitimate interests: our interest in keeping customers and our cleaners and handymen safe and preventing crime. We have balanced this against the privacy of the person checked.</p>' ||
      '<p>4.2 Article 10 and Schedule 1 of the Data Protection Act 2018. We rely on these conditions for processing criminal offence data:</p>' ||
      '<p>• Paragraph 10, preventing or detecting unlawful acts: where we need to carry out the check without the person&#x27;s consent in order to prevent or detect unlawful acts, and asking for consent would prejudice that purpose; and</p>' ||
      '<p>• Paragraph 11, protecting the public against dishonesty: where we need to decide whether a person is suitable to work in customers&#x27; homes.</p>' ||
      '<p>4.3 We also ask the person to confirm that they agree that we may see and record their certificate. A person who does not agree cannot take bookings through the platform.</p>' ||
      '<h2>5. How we follow the data protection principles</h2>' ||
      '<p>5.1 Lawfulness, fairness and transparency. We tell every applicant, in our terms and privacy notice, that we ask for a DBS check, why, and how we handle the result. A decision is never based on a conviction alone (see section 6).</p>' ||
      '<p>5.2 Purpose limitation. We use DBS information only for the purposes in section 3.</p>' ||
      '<p>5.3 Data minimisation. We ask only for a basic check, we look at the certificate, we record only the details in section 2.2, and we do not keep a long-term copy.</p>' ||
      '<p>5.4 Accuracy. The information comes directly from the person&#x27;s own certificate. If they tell us something has changed, we update our record. We ask for a fresh certificate where we need to.</p>' ||
      '<p>5.5 Storage limitation. We keep DBS information only for the periods in section 7, and then delete it securely.</p>' ||
      '<p>5.6 Security. Certificates and records are kept in a restricted, access-controlled and encrypted location. Only the people named in section 8 can see them. We do not share them with customers or other cleaners or handymen, and we do not send them by ordinary email where we can avoid it.</p>' ||
      '<p>5.7 Accountability. We keep a record of this processing, review this policy every 12 months, and keep a log of who has accessed DBS records.</p>' ||
      '<h2>6. How we make decisions</h2>' ||
      '<p>6.1 A conviction does not automatically stop someone working with us. We look at each case on its facts, including how serious and how relevant the offence is to the work, how long ago it was, what the person has done since, and the safety of customers.</p>' ||
      '<p>6.2 We give the person the chance to explain before we make a decision, and we make it ourselves, not by an automated system.</p>' ||
      '<p>6.3 We tell the person our decision in writing and explain it. They can ask us to review it.</p>' ||
      '<p>6.4 We follow the Rehabilitation of Offenders Act 1974. We do not ask about, or take into account, convictions that are spent, where the law says we must not.</p>' ||
      '<h2>7. Retention schedule</h2>' ||
      '<p>• Copy of the DBS certificate: we look at it and delete the copy within 6 months of the date we first saw it, unless we need it for a legal claim or investigation. It is then securely deleted.</p>' ||
      '<p>• Record of the check (name, certificate number and date, outcome, decision note): kept while the person works with us, and for 6 months after their account closes. It is then securely deleted.</p>' ||
      '<p>• Notes where we decided not to accept a person: kept for 6 months from our decision, in case the person challenges it. They are then securely deleted.</p>' ||
      '<p>• Anything needed for a legal claim, regulator or police request: kept only for as long as that matter needs, then reviewed and deleted.</p>' ||
      '<p>7.1 This policy is itself kept for at least 6 months after we stop processing this type of data, and is made available to the ICO on request.</p>' ||
      '<h2>8. Who can see it and who we share it with</h2>' ||
      '<p>8.1 Only the owner of the business and members of our onboarding team may see DBS information. The onboarding team carries out the checks. We authorise each team member in writing, keep a list of who they are, and tell each of them about this policy before they have access.</p>' ||
      '<p>8.2 We do not share DBS information with customers, other cleaners or handymen, or businesses.</p>' ||
      '<p>8.3 We share it only where the law requires or allows, for example with the police or another authority to prevent or detect crime, with a court, or with our insurers or advisers if needed for a claim. We do not sell it.</p>' ||
      '<h2>9. Your rights</h2>' ||
      '<p>9.1 You have the right to see your information, ask us to correct it, ask us to delete it, object to how we use it and ask us to restrict it, in line with UK data protection law. Some rights are limited where we must keep the information by law.</p>' ||
      '<p>9.2 To use your rights, or if you are unhappy with how we handle your information, email hello@opulencebliss.com. We will acknowledge your complaint within 3 working days and reply without undue delay, and within 30 days in any case. You can also complain to the ICO at ico.org.uk or on 0303 123 1113.</p>' ||
      '<h2>10. Reviewing this policy</h2>' ||
      '<p>10.1 We review this policy at least once a year, and whenever our processing or the law changes. The current version is available to cleaners and handymen on request.</p>' ||
      '<h2>11. Contact us</h2>' ||
      '<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 ICO registration number: ZC264981 Email: hello@opulencebliss.com</p>' ||
      '</div>',
  '1.0',
  date '2026-10-01',
  'adbb46b103f82aafce2f4857ff672804b34b52dfaf0956b03a49b4106356e5f1',
  '2026-10-01/dbs-data.pdf',
  true,
  now()
)
on conflict (slug) do update set
  title=excluded.title, audience=excluded.audience,
  content_html=excluded.content_html, version=excluded.version,
  effective_date=excluded.effective_date, pdf_sha256=excluded.pdf_sha256,
  pdf_path=excluded.pdf_path, published=true, updated_at=now();

-- The prototype professional agreement is not the missing approved Cleaner Terms.
update public.legal_documents set published=false,updated_at=now() where slug='professional-partner-agreement' and published;
drop policy if exists "published legal documents are public" on public.legal_documents;
create policy "published legal documents are public" on public.legal_documents
for select to anon,authenticated using (
  public.is_admin() or (published and (audience<>'professionals' or exists (
    select 1 from public.providers p where p.profile_id=auth.uid()
  )))
);
create function public.public_legal_revisions(p_slug text)
returns table (id bigint,title text,version text,content_html text,effective_date date,pdf_sha256 text,pdf_path text,archived_at timestamptz)
language sql stable security definer set search_path=public as $fn$
  select r.id,r.title,r.version,r.content_html,r.effective_date,r.pdf_sha256,r.pdf_path,r.changed_at
  from public.legal_document_revisions r where r.document_slug=p_slug and r.published
  and p_slug in ('terms','cancellation-refund','handyman-terms','business-terms','privacy','cookies','complaints','partner-programme') order by r.id desc;
$fn$;
revoke all on function public.public_legal_revisions(text) from public;
grant execute on function public.public_legal_revisions(text) to anon,authenticated,service_role;
create function public.protect_approved_legal_pack()
returns trigger language plpgsql set search_path=public as $fn$
begin
  if old.pdf_sha256 is not null
    and current_user not in ('postgres','supabase_admin')
    and (new.content_html,new.title,new.version,new.effective_date,new.pdf_sha256,new.pdf_path,new.published)
      is distinct from (old.content_html,old.title,old.version,old.effective_date,old.pdf_sha256,old.pdf_path,old.published) then
    raise exception 'Approved legal PDFs require a new client-approved release';
  end if;
  return new;
end;
$fn$;
revoke all on function public.protect_approved_legal_pack() from public,anon,authenticated,service_role;
create trigger approved_legal_pack_immutable before update on public.legal_documents
  for each row execute function public.protect_approved_legal_pack();
commit;
notify pgrst, 'reload schema';
