begin;

-- A client-approved initial publication has no staff actor. Staff-authored
-- announcements still record auth.uid() in announce_document_change().
alter table public.document_change_plans alter column announced_by drop not null;

do $publish_cleaner_terms$
declare
  snapshot constant text :=
    '<div data-final-pack="2026-10-01">' ||
    '<p><strong>CLEANER TERMS AND CONDITIONS</strong></p>' ||
    '<p>Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026</p>' ||
    '<p>These terms are for cleaners. Handymen have separate Handyman Terms, and people who only refer customers are covered by the Partner Programme Terms.</p>' ||
    '<h2>1. About us and these terms</h2>' ||
    '<p>1.1 These terms apply between Opulence Bliss Ltd (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) and each person who joins our platform as a cleaner (&quot;you&quot;).</p>' ||
    '<p>1.2 Our details: Opulence Bliss Ltd, a company registered in England and Wales, company number 15894675. Registered office: 128 City Road, London, United Kingdom, EC1V 2NX. Registered with the Information Commissioner&#x27;s Office under number ZC264981. Contact: hello@opulencebliss.com.</p>' ||
    '<p>1.3 We run an online platform that connects households and businesses in London with self-employed cleaners and handymen. These terms cover Cleaners, who carry out cleaning bookings. Handymen are covered by our Handyman Terms. If you also refer customers as a Partner, our Partner Programme Terms apply to that activity, as well as clause 12 of these terms.</p>' ||
    '<p>1.4 These terms include our Cleaner Cancellation Policy, which sets out how cancellations, no-shows and suspension work. If there is a conflict, the Cleaner Cancellation Policy applies to cancellations and suspension and these terms apply to everything else.</p>' ||
    '<p>1.5 You accept these terms by ticking the box and selecting &quot;I accept&quot; when you register, or by accepting your first booking. We keep a record of the date and the version you accepted. If you do not agree, please do not join.</p>' ||
    '<h2>2. Eligibility and checks</h2>' ||
    '<p>2.1 You must be at least 18 years old and have the legal right to work or to carry out self-employed work in the United Kingdom.</p>' ||
    '<p>2.2 Before you take bookings, we will check your identity and your right to work, and review your experience. You must also have a current basic Disclosure and Barring Service (DBS) check, which you apply for yourself and pay for. You can apply at https://www.gov.uk/request-copy-criminal-record. You must show us your certificate before your first booking, and we check it with the applicant&#x27;s consent. We may ask you to renew it, and we will tell you if we do. You agree to give us accurate information and to tell us promptly if anything changes.</p>' ||
    '<p>2.3 We may refuse an application or repeat any check at any time. We will handle the information you give us, including the result of your DBS check, as set out in clause 17 and in our DBS and criminal-offence data policy.</p>' ||
    '<h2>3. Joining is free</h2>' ||
    '<p>3.1 There is no joining fee, no monthly fee and no charge for training or support. You pay your own costs of working, including your DBS check and your own insurance. Nothing is deducted from your pay except as set out in these terms and only with your agreement where these terms say so.</p>' ||
    '<h2>4. Your status: self-employed</h2>' ||
    '<p>4.1 Cleaners are self-employed. Nothing in these terms makes you our employee, worker, partner or agent, and you have no authority to bind us.</p>' ||
    '<p>4.2 You choose when and whether to accept bookings. You may also work for other clients and other platforms, subject to clause 15. We do not guarantee any minimum amount of work, and availability varies by area and demand.</p>' ||
    '<p>4.3 You are responsible for your own tax and National Insurance, for registering with HMRC as self-employed where required, and for any insurance you need. We do not deduct tax from what we pay you.</p>' ||
    '<p>4.4 You decide how to carry out each booking within the standards in clause 6. If you cannot attend a booking, you must tell us as early as you can. To protect customers, only Cleaners who have passed our identity, right-to-work and DBS checks may enter a customer&#x27;s home. You therefore cannot send a substitute. If you cannot attend, we will offer the Booking to another Cleaner who has already passed our checks.</p>' ||
    '<h2>5. Bookings and cancellations</h2>' ||
    '<p>5.1 Bookings are offered through the platform. A booking is confirmed when you accept it.</p>' ||
    '<p>5.2 We encourage you to reschedule a booking with the customer rather than cancel it where you can. A booking moved to a new time that the customer agrees is not a cancellation.</p>' ||
    '<p>5.3 If you cannot attend, tell us as early as you can and we will offer the booking to another cleaner. You have 2 grace cancellations in each calendar month. We do not charge cleaners for cancelling, but if you cancel a third accepted booking in the same calendar month we may suspend your account. A no-show, meaning you do not attend and do not tell us before the visit, may also lead to suspension. The full rules, including cancellations that do not count, are in the Cleaner Cancellation Policy.</p>' ||
    '<p>5.4 If a customer cancels late and we charge them under our Cancellations, Payment and Refunds Policy, you are paid your usual rate for the booking in the same proportion. You may choose to charge the customer less, or nothing, as set out in the Cleaner Cancellation Policy.</p>' ||
    '<p>5.5 You must arrive on time, complete the agreed work to a good standard and respect the customer&#x27;s home and belongings.</p>' ||
    '<h2>6. Standards of conduct</h2>' ||
    '<p>6.1 You must act honestly, safely, lawfully and respectfully, and treat customers and colleagues with dignity. Harassment, discrimination, violence, theft, working under the influence of drink or drugs and any breach of customer privacy are not tolerated.</p>' ||
    '<p>6.2 You must follow reasonable health and safety instructions, use equipment safely and report accidents, damage and safeguarding concerns to us promptly. You must follow our Safeguarding, Lone Working and Incident Reporting Policy.</p>' ||
    '<p>6.3 You must keep customers&#x27; keys, access codes and personal information secure and use them only for the booking.</p>' ||
    '<h2>7. Pay</h2>' ||
    '<p>7.1 For each completed booking we pay you at these hourly rates:</p>' ||
    '<p>• Standard cleaning, from your first completed booking to the end of month 5: £15.00 per hour</p>' ||
    '<p>• Standard cleaning, from the start of month 6: £15.25 per hour</p>' ||
    '<p>• Standard cleaning, from the start of month 13: £15.50 per hour</p>' ||
    '<p>• Deep cleaning and end of tenancy cleaning: £17.50 per hour, which does not increase with time on the platform</p>' ||
    '<p>7.2 Months are counted from the date of your first completed booking. If you take no bookings for more than 90 days, your standard cleaning rate returns to the starting rate of £15.00 per hour, and months are counted again from your next completed booking. If you know you will be inactive for longer than 90 days, you must write to us before the 90 days end and explain why. We will consider each request fairly and will not unreasonably refuse it, for example where the reason is illness, caring responsibilities or travel, and we will tell you our decision in writing. The deep cleaning and end of tenancy rate is not affected.</p>' ||
    '<p>7.3 We pay Stripe&#x27;s processing costs on payments to you. They are not deducted from your pay.</p>' ||
    '<p>7.4 You will be paid for completed and paid bookings. We may withhold or reduce payment for a booking that was not completed, was cancelled by you without proper notice, or where the customer is refunded because of your breach.</p>' ||
    '<p>7.5 We may change our rates, add-ons or reward schemes by giving you at least 30 days&#x27; written notice. Changes will not reduce amounts you have already earned.</p>' ||
    '<h2>8. Payouts</h2>' ||
    '<p>8.1 You can choose to be paid weekly, every two weeks or monthly. Payments are made by bank transfer through Stripe, and your payout choice and schedule appear in your account.</p>' ||
    '<p>8.2 There is no minimum payout amount.</p>' ||
    '<p>8.3 We show each payment in your account with a clear breakdown of hourly pay, add-ons, tips, rewards and any agreed deductions.</p>' ||
    '<p>8.4 You must check your payment details are correct. We are not responsible for payments sent to incorrect details you supplied.</p>' ||
    '<h2>9. Cleaning products add-on</h2>' ||
    '<p>9.1 A customer may ask for cleaning products to be provided when they book. They pay £5 for this add-on.</p>' ||
    '<p>9.2 If the customer asks for products and you bring suitable products of your own, you earn £4 per booking in addition to your hourly pay. The payment is per booking, not per hour.</p>' ||
    '<p>9.3 The £4 is paid only where the customer requested products when booking, you supplied them and the booking was completed. If you do not bring suitable products, you will not be paid the £4 and we may refund the customer.</p>' ||
    '<p>9.4 You are responsible for the safety and suitability of your products and for using them in line with the manufacturer&#x27;s instructions.</p>' ||
    '<h2>10. Tips</h2>' ||
    '<p>10.1 Customers may tip you at the time of booking or afterwards. Tips are voluntary.</p>' ||
    '<p>10.2 You keep 100% of tips. We do not take any share and we do not deduct payment processing fees from them.</p>' ||
    '<p>10.3 Tips are paid in your next payout and shown separately in your account. They are not counted towards hourly pay, pay rises or referral rewards.</p>' ||
    '<p>10.4 Tips are your income. You are responsible for declaring them to HMRC where required.</p>' ||
    '<h2>11. Referring a cleaner (Cleaner referral rewards)</h2>' ||
    '<p>11.1 If you refer another cleaner to us and they join and complete bookings, you (&quot;Cleaner A&quot;) may earn rewards on the work of the cleaner you referred (&quot;Cleaner B&quot;):</p>' ||
    '<p>• £5 once Cleaner B completes their first booking</p>' ||
    '<p>• 20p for every hour Cleaner B works in each of their first five months</p>' ||
    '<p>• 30p for every hour Cleaner B works from the start of their sixth month, for as long as Cleaner B continues to work through the platform</p>' ||
    '<p>11.2 Cleaner B receives a £5 welcome bonus once they complete their first booking. Cleaner B receives the same pay rises as any other cleaner, measured from their own first completed booking, and may refer other cleaners and earn the same rewards.</p>' ||
    '<p>11.3 There is no limit on the number of cleaners you can refer. You earn only on the hours Cleaner B works, and not on the hours worked by cleaners that Cleaner B refers.</p>' ||
    '<p>11.4 Rewards apply to cleaning hours, including deep cleaning and end of tenancy hours, that are completed and paid. They are not paid on cancelled, unpaid or refunded bookings.</p>' ||
    '<p>11.5 To qualify, Cleaner B must give your referral details when they apply and must not already have an account with us. You cannot refer yourself, or someone who lives at your address or shares your bank account, without our written agreement.</p>' ||
    '<p>11.6 If Cleaner B stops working through the platform or their account is closed, your rewards on their hours stop. If your account is closed, you will not earn further referral rewards. Rewards already paid will not be taken back unless they were obtained by breach of these terms.</p>' ||
    '<h2>12. Referring a customer (Customer referral reward)</h2>' ||
    '<p>12.1 If you refer a new customer to us, you earn £10 and the new customer receives £10 off their first two bookings. This is a one-off reward for each new customer.</p>' ||
    '<p>12.2 A new customer is a person that has never booked through our platform. The reward is paid in two parts. You receive £5 after the new customer&#x27;s first booking is completed and paid, and a further £5 after their second booking is completed and paid. The new customer receives £5 off their first booking and £5 off their second booking. If the second booking is not completed and paid, the second part is not paid.</p>' ||
    '<p>12.3 The referral must be made through your personal link or code. It does not apply to bookings made before the referral, to repeat bookings or to the same household more than once.</p>' ||
    '<p>12.4 We do not pay a reward if the booking is cancelled or refunded, or if we reasonably believe the referral is not genuine, for example where you are the customer or a member of your household.</p>' ||
    '<p>12.5 Rewards are credited to your account and paid with your next payout, subject to clause 8.</p>' ||
    '<h2>13. Partner Programme</h2>' ||
    '<p>13.1 If you also want to earn by recommending us to customers or businesses, you can register as a Partner. Our Partner Programme Terms then apply to that activity, including how you must promote us honestly, label paid recommendations and follow marketing law.</p>' ||
    '<p>13.2 You must not post fake reviews or ask others to do so. We may remove rewards and close your account if you do.</p>' ||
    '<h2>14. Optional wellbeing benefit: monthly massage</h2>' ||
    '<p>14.1 We have arranged a discount agreement with an independent massage provider Wellness by Anja. It is optional. You choose whether to take part, and you do not have to take part to work with us.</p>' ||
    '<p>14.2 The provider&#x27;s standard price for the massage is currently £77. Under the discount agreement the price to you is £50. We do not add any money of our own to the price, and we receive no payment from the provider. The difference is a discount agreed between the provider and us for our cleaners. If the provider&#x27;s standard price changes, the £50 price to you stays the same for at least 12 months.</p>' ||
    '<p>14.3 You can have one massage each month. If you choose to take part, you agree to us deducting £50 each month from your referral rewards balance (cleaner referral rewards and customer referral rewards) and paying it to the provider.</p>' ||
    '<p>14.4 Deductions are taken only from your referral rewards balance. We will never deduct them from your hourly pay, tips or the £4 products payment, and we will never take your balance below zero. If your balance is less than £50, we will not book the massage and you will not be charged.</p>' ||
    '<p>14.5 You can opt in by confirming in your account and can opt out at any time. Opting out takes effect before the next monthly deduction. We will remind you before each deduction.</p>' ||
    '<p>14.6 The massage is provided by the provider, under the provider&#x27;s own terms, including their cancellation policy. We are not responsible for the treatment. You should tell the provider about any health conditions, and ask your GP if you are unsure that a massage is suitable for you.</p>' ||
    '<p>14.7 We will share only the information needed to book, which is your name, contact details and booking date. We do not collect or share health information about you. Further details are in our privacy notice.</p>' ||
    '<p>14.8 We may change or end this benefit by giving you 30 days&#x27; notice.</p>' ||
    '<h2>15. Keeping customers on the platform</h2>' ||
    '<p>15.1 Customers introduced to you through our platform are customers of the platform. While you work with us and for 12 months after your account closes, you must not:</p>' ||
    '<p>• take, or offer to take, bookings from those customers outside the platform;</p>' ||
    '<p>• ask or encourage them to stop using the platform; or</p>' ||
    '<p>• accept payment from them other than through the platform for work arising from a platform booking.</p>' ||
    '<p>15.2 This does not apply to customers you served before joining us and told us about in writing when you applied, or to work a customer asks you to do after leaving the platform for reasons unconnected to you.</p>' ||
    '<p>15.3 If you break this clause, we may close your account, withhold unpaid referral rewards and take any other action the law allows.</p>' ||
    '<h2>16. Insurance and liability</h2>' ||
    '<p>16.1 We hold public liability insurance for our business. You must hold your own public liability insurance, with cover of at least £1,000,000 for any one claim, before you take your first booking and for as long as you work through the platform. You must send us a copy of your certificate when you apply and each time your policy renews, and you must tell us at once if it is cancelled or changes. If your cover lapses, we may suspend your account until you give us valid proof of cover. Our insurance does not replace yours, and we do not promise that it will cover any claim arising from your work. Any cover is subject to the policy terms, and you must not do anything that invalidates it.</p>' ||
    '<p>16.2 You are responsible for loss or damage you cause by your own negligence or breach of these terms, and you must report any incident promptly.</p>' ||
    '<p>16.3 Nothing in these terms excludes or limits liability for death or personal injury caused by negligence, for fraud or for anything else that cannot be excluded by law.</p>' ||
    '<p>16.4 Subject to clause 16.3, we are not liable for loss of earnings, loss of bookings or any indirect loss, and our total liability to you in connection with these terms is limited to the amounts we owe you.</p>' ||
    '<h2>17. Your information (data protection)</h2>' ||
    '<p>17.1 We are the controller of the personal information you give us. We are registered with the Information Commissioner&#x27;s Office, number ZC264981.</p>' ||
    '<p>17.2 We use your information to assess your application, carry out checks, run bookings, pay you, prevent fraud, keep customers and cleaners safe, meet our legal duties and, with your consent, send you marketing.</p>' ||
    '<p>17.3 We share it only where needed with payment providers such as Stripe, checking and insurance providers, professional advisers, regulators and, for the wellbeing benefit, the massage provider with your agreement. We share limited information with customers, such as your first name, photograph and rating, so they know who is coming.</p>' ||
    '<p>17.4 You have rights over your information under UK data protection law, including to access, correct and delete it, to object to its use and to complain to the Information Commissioner&#x27;s Office. Our privacy notice, available on our website, explains how to use them and how long we keep information. If you want to complain to us about how we handle your information, email hello@opulencebliss.com. We will acknowledge your complaint within 3 working days and reply without undue delay, and within 30 days in any case.</p>' ||
    '<p>17.5 We keep the result of your DBS check only as long as we need it and only as set out in our DBS and criminal-offence data policy. We record that the check was seen, the certificate date and its outcome. We do not keep a copy of the certificate beyond the period in that policy.</p>' ||
    '<p>17.6 Marketing messages are sent only if you have agreed, and you can withdraw consent at any time.</p>' ||
    '<h2>18. Tax and reporting</h2>' ||
    '<p>18.1 You are responsible for your own tax. UK rules on reporting by digital platforms may require us to share information about you and your earnings with HMRC. You agree to give us the information needed to do so.</p>' ||
    '<h2>19. Suspension and ending your account</h2>' ||
    '<p>19.1 You can close your account at any time by giving us 7 days&#x27; written notice. We can end this agreement by giving you 14 days&#x27; written notice.</p>' ||
    '<p>19.2 We may suspend or close your account immediately if you seriously breach these terms, act dishonestly or unsafely, put a customer at risk, make false claims or commit fraud.</p>' ||
    '<p>19.3 When your account ends, we will pay you what you have earned for completed bookings, subject to clauses 7.4 and 15.3. Referral rewards stop in line with clauses 11.6 and 12.4. Suspension is handled under the Cleaner Cancellation Policy where it applies. Clauses 15, 16, 17 and 18 continue to apply.</p>' ||
    '<h2>20. Changes to these terms</h2>' ||
    '<p>20.1 We may update these terms. We will give you at least 30 days&#x27; notice of changes that affect your pay or rewards. If you keep working with us after the change takes effect, you accept it. If you do not agree, you can close your account.</p>' ||
    '<h2>21. Complaints and disputes</h2>' ||
    '<p>21.1 If you have a complaint, including about a payment or reward, please contact us at hello@opulencebliss.com within 30 days. We will acknowledge it within 3 working days and aim to reply in full within 14 days. Our Complaints Procedure explains each stage.</p>' ||
    '<p>21.2 If we cannot resolve a dispute, we will try mediation before either of us goes to court.</p>' ||
    '<h2>22. General</h2>' ||
    '<p>22.1 These terms are the whole agreement between us on this subject and replace earlier discussions.</p>' ||
    '<p>22.2 If any part is found to be unenforceable, the rest continues to apply.</p>' ||
    '<p>22.3 If we delay in enforcing a right, we have not given it up.</p>' ||
    '<p>22.4 You may not transfer your rights or duties under these terms without our written consent. We may transfer ours to another company if it carries on the business.</p>' ||
    '<p>22.5 Only you and we have rights under these terms. Nobody else can enforce them under the Contracts (Rights of Third Parties) Act 1999.</p>' ||
    '<p>22.6 We are not responsible for delay or failure caused by events outside our reasonable control.</p>' ||
    '<p>22.7 These terms and any dispute arising from them are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.</p>' ||
    '<h2>23. Contact us Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 ICO registration number: ZC264981 Email: hello@opulencebliss.com</h2>' ||
    '</div>';
  fingerprint constant text := 'ca8941c30c9640c592bc2ad2ec12fa646ab31e5a42b1975e2dbe8944ec8a17b8';
  file_path constant text := '2026-10-01/cleaner-terms.pdf';
  terms_title constant text := 'Cleaner Terms and Conditions';
begin
  -- Store the exact version before publication, so the existing notice gate,
  -- protected PDF route and next-sign-in workflow use the same snapshot.
  insert into public.document_change_plans (
    document_slug, version, title, summary, source_content_html,
    content_hash, pdf_path, pdf_sha256, effective_at
  ) values (
    'cleaner-terms', '1.0', terms_title,
    'The Cleaner Terms and Conditions v1.0 replace the previous cleaner agreement. They cover eligibility and checks, bookings and cancellations, pay and payouts, conduct, insurance, and use of your information. Please read the full document before accepting.',
    snapshot, md5(snapshot), file_path, fingerprint,
    timestamp '2026-10-01 00:00:00' at time zone 'Europe/London'
  );

  insert into public.legal_documents (
    slug, title, audience, content_html, version, effective_date,
    pdf_sha256, pdf_path, published
  ) values (
    'cleaner-terms', terms_title, 'professionals', snapshot, '1.0',
    date '2026-10-01', fingerprint, file_path, true
  );

  -- The revision trigger retains any formerly published agreement and
  -- earlier acceptance evidence stays intact.
  update public.legal_documents
  set published = false, updated_at = now()
  where slug = 'professional-partner-agreement' and published;
end;
$publish_cleaner_terms$;

insert into public.site_social_links (platform, url) values
  ('facebook', 'https://www.facebook.com/share/17reTP9fFQ/'),
  ('instagram', 'https://www.instagram.com/opulenceblissltd'),
  ('tiktok', 'https://www.tiktok.com/@opulence.bliss')
on conflict (platform) do update
set url = excluded.url, updated_at = now()
where site_social_links.url is distinct from excluded.url;

commit;
