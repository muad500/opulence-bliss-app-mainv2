-- Legal document changes drafted for the client's approval. Apply only once
-- the client (and, where noted, their solicitor) has approved the wording.
--
-- Privacy Policy 1.1: replaces "No Website at Present" with how the website
-- actually uses data; names the providers the website uses and covers
-- transfers outside the UK; explains DBS checks and that the uploaded copy is
-- deleted after verification; says the assigned cleaner can phone the customer.
--
-- Cancellation & Refund Policy 1.1: adds the statutory 14-day right to cancel
-- and a model cancellation form (Consumer Contracts Regulations 2013). Without
-- this information the cancellation period extends by 12 months (reg. 31) and
-- a customer who cancels owes nothing for work already done (reg. 36(6)).
--
-- Review Policy 1.0: new document describing how reviews are collected,
-- published and moderated.
--
-- A document someone has edited in admin (updated_by is set) is never
-- overwritten; a notice is raised so the new sections can be merged by hand.
-- The previous wording is archived by archive_legal_document_revision.

begin;

alter table public.legal_documents
  drop constraint if exists legal_documents_slug_check;
alter table public.legal_documents
  add constraint legal_documents_slug_check check (
    slug in ('terms', 'privacy', 'cancellation-refund', 'handyman-terms', 'review-policy', 'professional-partner-agreement')
  );

update public.legal_documents
set content_html = $policy$
  <p><strong>Happy Cleaners. Happier Homes.</strong></p>
  <p><strong>Version:</strong> 1.1</p>
  <p><strong>Effective Date:</strong> August 2026</p>
  <p><strong>Last Updated:</strong> September 2026</p>
  <h2>1. Introduction</h2>
  <p>Opulence Bliss Ltd (&quot;Opulence Bliss&quot;, &quot;we&quot;, &quot;our&quot; or &quot;us&quot;) respects your privacy and is committed to protecting your personal information.</p>
  <p>This Privacy Policy explains how we collect, use, store and protect personal information when you:</p>
  <p>Submit a cleaning booking request;</p>
  <p>Contact us;</p>
  <p>Use our cleaning services;</p>
  <p>Apply to become a Cleaner Partner;</p>
  <p>Communicate with us about a booking;</p>
  <p>Make or receive payments;</p>
  <p>Provide feedback or make a complaint; or</p>
  <p>Otherwise interact with Opulence Bliss.</p>
  <p>For the purposes of applicable UK data protection law, including the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018, Opulence Bliss Ltd is responsible for deciding how and why your personal information is processed where we act as the data controller.</p>
  <h2>2. Who We Are</h2>
  <p>Opulence Bliss Ltd</p>
  <p><strong>Company Registration Number:</strong> 15894675</p>
  <p><strong>Call / SMS / WhatsApp:</strong> +44 7484 717935</p>
  <p><strong>Email:</strong> opulencebliss@gmail.com</p>
  <p><strong>Registered in:</strong> England and Wales</p>
  <p><strong>Registered office:</strong> 128 City Road, London, EC1V 2NX</p>
  <p>If you have questions about this Privacy Policy or how we handle your personal information, please contact us using the details above.</p>
  <h2>3. Our Privacy Approach</h2>
  <p>Our business operates through this website. We may also use the following tools for booking and administration:</p>
  <p>Google Forms / Google Workspace</p>
  <p>Google Sheets</p>
  <p>Google Calendar</p>
  <p>Gmail / Google Mail</p>
  <p>WhatsApp Business</p>
  <p>Accounting software</p>
  <p>Tide business banking</p>
  <p>These services help us manage bookings, communicate with customers and cleaners, maintain business records and manage payments.</p>
  <h2>4. Information We Collect</h2>
  <p>The information we collect depends on how you interact with Opulence Bliss.</p>
  <h3>4.1 Customer Information</h3>
  <p>When you submit a booking request or contact us, we may collect:</p>
  <p>Full name;</p>
  <p>Telephone number;</p>
  <p>Email address;</p>
  <p>Property address;</p>
  <p>Postcode;</p>
  <p>Property type;</p>
  <p>Number of bedrooms and bathrooms;</p>
  <p>Cleaning requirements;</p>
  <p>Preferred date and time;</p>
  <p>Access arrangements;</p>
  <p>Information about pets where relevant;</p>
  <p>Cleaning instructions;</p>
  <p>Information about products or equipment;</p>
  <p>Booking history;</p>
  <p>Payment information;</p>
  <p>Refund information;</p>
  <p>Communications with us;</p>
  <p>Complaints and feedback.</p>
  <p>We aim to collect only information that is reasonably necessary to provide and manage our services.</p>
  <h2>5. Cleaner Partner Information</h2>
  <p>When you apply to become a Cleaner Partner, we may collect:</p>
  <p>Full name;</p>
  <p>Telephone number;</p>
  <p>Email address;</p>
  <p>Address;</p>
  <p>Identity information;</p>
  <p>Right-to-work information;</p>
  <p>Self-employment information;</p>
  <p>References;</p>
  <p>Cleaning experience;</p>
  <p>Availability;</p>
  <p>Areas in which you are willing to work;</p>
  <p>Insurance information;</p>
  <p>Relevant qualifications or training;</p>
  <p>Payment information;</p>
  <p>Communications with Opulence Bliss;</p>
  <p>Information relating to complaints, incidents or service quality;</p>
  <p>Your DBS (Disclosure and Barring Service) certificate number, its issue date and the outcome of our check.</p>
  <p>Where we request information for verification or legal compliance, we will explain the purpose where appropriate.</p>
  <h3>DBS checks</h3>
  <p>Before we approve a Cleaner Partner, we ask for a copy of their DBS certificate so that we can check it. A DBS certificate contains criminal record information, which the law protects more strictly than other personal information. We use it only to decide whether we can approve you, and only authorised members of our team can see it.</p>
  <p>Once we have checked your certificate, we delete the copy you uploaded. We keep only the certificate number, its issue date and the outcome of our check.</p>
  <h2>6. How We Collect Your Information</h2>
  <p>We may collect personal information directly from you through:</p>
  <p>Google Forms</p>
  <p>Our customer booking form and Cleaner Partner application process may use Google Forms.</p>
  <p>Information submitted through these forms may be stored and managed within our Google Workspace environment.</p>
  <p>Email</p>
  <p>We use Gmail / Google Workspace to communicate with Customers, Cleaners and other relevant parties.</p>
  <p>WhatsApp Business</p>
  <p>We may use WhatsApp Business to communicate regarding:</p>
  <p>Booking requests;</p>
  <p>Booking confirmations;</p>
  <p>Changes;</p>
  <p>Cancellations;</p>
  <p>Customer support;</p>
  <p>Cleaner communication;</p>
  <p>General business enquiries.</p>
  <p>Telephone and SMS</p>
  <p>We may collect information provided during telephone calls or SMS conversations.</p>
  <p>Google Sheets</p>
  <p>We may use Google Sheets to organise and manage booking, customer and business information.</p>
  <p>Google Calendar</p>
  <p>We may use Google Calendar to manage appointment dates, times and cleaner availability.</p>
  <p>Accounting Software</p>
  <p>We may use accounting software to maintain financial records, invoices, payments, refunds and other accounting information.</p>
  <p>Tide</p>
  <p>Customer payments and business transactions may be processed through our Tide business banking account.</p>
  <p>Tide's own privacy arrangements apply to information processed directly by Tide. Tide states that it may act as a data controller or, for certain services, as a data processor depending on the service being used.</p>
  <h2>7. How We Use Personal Information</h2>
  <p>We may use personal information to:</p>
  <p>Receive and manage booking requests;</p>
  <p>Match Customers with suitable Cleaners;</p>
  <p>Confirm bookings;</p>
  <p>Communicate with Customers;</p>
  <p>Communicate with Cleaners;</p>
  <p>Manage appointment schedules;</p>
  <p>Provide customer support;</p>
  <p>Process payments;</p>
  <p>Process refunds;</p>
  <p>Manage cancellations;</p>
  <p>Manage rescheduling;</p>
  <p>Maintain financial and accounting records;</p>
  <p>Investigate complaints;</p>
  <p>Investigate alleged damage or incidents;</p>
  <p>Maintain service quality;</p>
  <p>Verify Cleaner information;</p>
  <p>Protect Customers and Cleaners;</p>
  <p>Prevent fraud or misuse;</p>
  <p>Comply with legal obligations;</p>
  <p>Maintain appropriate business records;</p>
  <p>Improve our services.</p>
  <h2>8. Lawful Bases for Processing</h2>
  <p>Depending on the circumstances, we may rely on one or more of the following lawful bases under applicable data protection law.</p>
  <p>Contract</p>
  <p>We may process information where this is necessary to arrange or perform a cleaning service.</p>
  <p>For example, we need your address and contact details to arrange a cleaning appointment.</p>
  <p>Legitimate Interests</p>
  <p>We may process information where this is reasonably necessary for our legitimate business interests and those interests are not overridden by your rights.</p>
  <p>Examples may include:</p>
  <p>Managing our business;</p>
  <p>Responding to enquiries;</p>
  <p>Managing customer relationships;</p>
  <p>Preventing fraud;</p>
  <p>Protecting Customers and Cleaners;</p>
  <p>Investigating complaints;</p>
  <p>Improving our services;</p>
  <p>Maintaining business records.</p>
  <p>Legal Obligation</p>
  <p>We may process information where necessary to comply with a legal or regulatory obligation.</p>
  <p>This may include accounting, tax, financial or legal requirements.</p>
  <p>Consent</p>
  <p>Where consent is required, we will ask for it.</p>
  <p>For example, certain marketing activities may require consent.</p>
  <p>Where processing is based on consent, you may withdraw your consent.</p>
  <h2>9. Google Workspace and Google Services</h2>
  <p>Opulence Bliss uses Google Workspace services including:</p>
  <p>Gmail;</p>
  <p>Google Forms;</p>
  <p>Google Sheets;</p>
  <p>Google Calendar;</p>
  <p>Google Drive and related Workspace functionality where applicable.</p>
  <p>These services may be used to collect, store, organise and communicate information relating to Customers, Cleaners and bookings.</p>
  <p>Access to our Google Workspace should be restricted to authorised individuals who need the information to perform legitimate business functions.</p>
  <p>We will take reasonable steps to configure and use these services securely.</p>
  <p>Google's own terms, privacy information and data processing arrangements may also apply to Google's processing of information.</p>
  <h2>10. WhatsApp Business</h2>
  <p>Opulence Bliss may use WhatsApp Business for customer and Cleaner communications.</p>
  <p>Messages may contain personal information relating to bookings, including names, addresses, appointment times and instructions.</p>
  <p>Customers and Cleaners should avoid sending unnecessary sensitive information through WhatsApp.</p>
  <p>WhatsApp is operated by a third-party provider and its own privacy terms and policies may apply to information processed through the service.</p>
  <p>Opulence Bliss will use information received through WhatsApp only for legitimate business purposes.</p>
  <h2>11. Google Sheets and Booking Records</h2>
  <p>Booking information may be recorded in Google Sheets for administrative purposes.</p>
  <p>This may include:</p>
  <p>Customer name;</p>
  <p>Contact details;</p>
  <p>Booking date;</p>
  <p>Booking time;</p>
  <p>Property address;</p>
  <p>Cleaner assigned;</p>
  <p>Booking value;</p>
  <p>Payment status;</p>
  <p>Cancellation information;</p>
  <p>Notes necessary to manage the booking.</p>
  <p>Access should be limited to authorised persons who need the information for legitimate business purposes.</p>
  <h2>12. Google Calendar</h2>
  <p>We may use Google Calendar to manage:</p>
  <p>Customer appointments;</p>
  <p>Cleaner assignments;</p>
  <p>Booking times;</p>
  <p>Rescheduled appointments;</p>
  <p>Business availability.</p>
  <p>Calendar information should contain only information reasonably necessary to manage the appointment.</p>
  <h2>13. Accounting and Financial Information</h2>
  <p>Our accounting software may be used to maintain:</p>
  <p>Customer payment records;</p>
  <p>Cleaner payment records;</p>
  <p>Invoices;</p>
  <p>Refunds;</p>
  <p>Expenses;</p>
  <p>Commission records;</p>
  <p>Tax and accounting information.</p>
  <p>We may retain financial records for periods required by applicable law.</p>
  <h2>14. Tide Business Banking</h2>
  <p>Opulence Bliss currently uses Tide for business banking.</p>
  <p>Banking information may include:</p>
  <p>Transaction information;</p>
  <p>Payment amounts;</p>
  <p>Payment dates;</p>
  <p>Bank account information;</p>
  <p>Transaction references;</p>
  <p>Refund information.</p>
  <p>We do not ask customers to provide their online banking passwords, PINs or security credentials to Opulence Bliss.</p>
  <p>Customers should never send this information to us.</p>
  <p>Tide's privacy policy explains that it processes transactional and banking information and may process personal information in the UK, EEA and, in certain circumstances, other countries using applicable safeguards.</p>
  <h2>15. Sharing Customer Information with Cleaners</h2>
  <p>When a booking is accepted, we may provide the assigned Cleaner with information reasonably necessary to complete the booking.</p>
  <p>This may include:</p>
  <p>Customer name;</p>
  <p>Property address;</p>
  <p>Booking date and time;</p>
  <p>Cleaning requirements;</p>
  <p>Relevant access instructions;</p>
  <p>Telephone number, so that your Cleaner can contact you about the booking on the day, for example if they cannot get in. Your Cleaner can see it only while the booking is upcoming or in progress;</p>
  <p>Information necessary to carry out the service safely.</p>
  <p>We aim to share only information reasonably necessary for the booking.</p>
  <h2>16. Cleaner Responsibilities for Customer Information</h2>
  <p>Cleaners who receive Customer information through Opulence Bliss are expected to treat that information responsibly.</p>
  <p>Customer information must not be:</p>
  <p>Sold;</p>
  <p>Shared unnecessarily;</p>
  <p>Used for unrelated marketing;</p>
  <p>Published online;</p>
  <p>Used for inappropriate purposes.</p>
  <p>Access information such as keys, key-safe codes and entry instructions should be treated as confidential.</p>
  <h2>17. Sharing Information with Other Service Providers</h2>
  <p>We may use third-party service providers to help operate our business.</p>
  <p>Depending on our requirements, these may include:</p>
  <p>Google Workspace and related Google services;</p>
  <p>WhatsApp Business;</p>
  <p>Accounting software providers;</p>
  <p>Banking/payment providers such as Tide;</p>
  <p>Professional advisers;</p>
  <p>Accountants;</p>
  <p>Solicitors;</p>
  <p>Insurance providers;</p>
  <p>IT or technical service providers;</p>
  <p>Supabase, which stores our website's accounts, bookings, messages and files;</p>
  <p>Vercel, which hosts our website;</p>
  <p>Stripe, which processes card payments and pays our Cleaners. We never see or store your full card details;</p>
  <p>Resend, which sends our booking emails;</p>
  <p>Google, whose Gemini service powers the chat assistant on our website.</p>
  <p>Some of these providers may process personal information outside the United Kingdom, including in the United States. Where that happens, we rely on UK adequacy regulations or on appropriate safeguards, such as the International Data Transfer Agreement or Addendum approved in the UK.</p>
  <p>Where another organisation processes personal information on our behalf, we will take reasonable steps to ensure appropriate contractual and data protection arrangements are in place where required.</p>
  <h2>18. We Do Not Sell Personal Information</h2>
  <p>Opulence Bliss does not sell Customer or Cleaner personal information.</p>
  <p>We use personal information to operate and develop our business and provide our services.</p>
  <h2>19. Marketing</h2>
  <p>At present, our primary communications relate to bookings, customer service and the operation of our business.</p>
  <p>If we introduce marketing communications, we will ensure that these are carried out in accordance with applicable privacy and electronic marketing laws.</p>
  <p>You may opt out of marketing communications where applicable.</p>
  <h2>20. Our Website</h2>
  <p>When you use our website, we collect the information you give us to create an account, book, pay, message your Cleaner and leave reviews. This includes your name, email address, telephone number, address, details of your home and booking, and any photos or files you share in a booking chat.</p>
  <p><strong>Booking chat.</strong> Messages and files you share in a booking chat can be seen by you, the other person on the booking and our team. We automatically check messages for offensive language so that our team can review them.</p>
  <p><strong>Chat assistant.</strong> If you use the chat assistant on our website, what you type is sent to Google to generate a reply. Please do not share sensitive personal information with it.</p>
  <p><strong>Reviews.</strong> After a visit you can leave a review and choose whether it is public or private, whatever your rating. Public reviews can be seen by anyone. Private reviews are seen only by the person you reviewed and our team. Every star rating, public or private, counts towards the ratings we show publicly, but the text of a private review is never published. Our Review Policy explains more.</p>
  <p><strong>Cookies.</strong> Our website uses only cookies that are strictly necessary for it to work, such as keeping you signed in, keeping your account secure and taking payments. We do not use analytics or advertising cookies. If that changes, we will ask for your consent first.</p>
  <h2>21. How Long We Keep Personal Information</h2>
  <p>We will retain personal information only for as long as reasonably necessary for the purposes for which it was collected.</p>
  <p>We may retain information for:</p>
  <p>Booking administration;</p>
  <p>Customer service;</p>
  <p>Accounting;</p>
  <p>Tax purposes;</p>
  <p>Legal compliance;</p>
  <p>Complaint handling;</p>
  <p>Fraud prevention;</p>
  <p>Establishing or defending legal claims;</p>
  <p>Maintaining appropriate business records.</p>
  <p>Different types of information may need to be retained for different periods.</p>
  <p>For DBS checks, we delete the uploaded certificate once we have checked it, and keep only the certificate number, its issue date and the outcome.</p>
  <p>When information is no longer required, we will take reasonable steps to securely delete or dispose of it, subject to applicable legal retention requirements.</p>
  <h2>22. Security</h2>
  <p>We take reasonable technical and organisational measures to protect personal information against:</p>
  <p>Unauthorised access;</p>
  <p>Accidental loss;</p>
  <p>Unauthorised disclosure;</p>
  <p>Destruction;</p>
  <p>Misuse;</p>
  <p>Unauthorised alteration.</p>
  <p>Examples may include:</p>
  <p>Password protection;</p>
  <p>Restricted access;</p>
  <p>Secure Google Workspace accounts;</p>
  <p>Appropriate device security;</p>
  <p>Limiting access to booking information;</p>
  <p>Keeping business information within authorised systems.</p>
  <p>No electronic system can be guaranteed to be completely secure.</p>
  <h2>23. Personal Data Breaches</h2>
  <p>If we become aware of a personal data breach, we will assess the incident and take appropriate steps in accordance with applicable data protection law.</p>
  <p>Where legally required, we will notify the Information Commissioner's Office and/or affected individuals.</p>
  <h2>24. Your Data Protection Rights</h2>
  <p>Depending on the circumstances, you may have rights under applicable data protection law, including rights to:</p>
  <p>Request access to your personal information;</p>
  <p>Request correction of inaccurate information;</p>
  <p>Request deletion of personal information;</p>
  <p>Request restriction of processing;</p>
  <p>Object to certain processing;</p>
  <p>Request data portability;</p>
  <p>Withdraw consent where processing is based on consent.</p>
  <p>These rights are subject to legal conditions and exemptions.</p>
  <h2>25. How to Exercise Your Rights</h2>
  <p>To exercise a data protection right, contact:</p>
  <p>Opulence Bliss Ltd</p>
  <p><strong>Email:</strong> opulencebliss@gmail.com</p>
  <p><strong>Call / SMS / WhatsApp:</strong> +44 7484 717935</p>
  <p>We may need to verify your identity before responding to certain requests.</p>
  <p>We will respond within the timescales required by applicable law.</p>
  <h2>26. Complaints</h2>
  <p>If you have concerns about how Opulence Bliss has handled your personal information, please contact us first.</p>
  <p>We will make reasonable efforts to investigate and resolve your concern.</p>
  <p>You may also complain directly to the Information Commissioner's Office (ICO) if you believe your personal information has been handled unlawfully.</p>
  <p>The ICO is the UK's independent data protection regulator.</p>
  <h2>27. Changes to This Privacy Policy</h2>
  <p>We may update this Privacy Policy when our business, technology, services or legal obligations change.</p>
  <p>For example, we may update this policy if we introduce:</p>
  <p>A website;</p>
  <p>Online payments;</p>
  <p>A customer booking platform;</p>
  <p>New software;</p>
  <p>Advertising systems;</p>
  <p>Analytics;</p>
  <p>Additional communication platforms.</p>
  <p>The latest version will show the applicable Last Updated date.</p>
  <h2>28. Contact Details</h2>
  <p>Opulence Bliss Ltd</p>
  <p><strong>Company Registration Number:</strong> 15894675</p>
  <p><strong>Call / SMS / WhatsApp:</strong> +44 7484 717935</p>
  <p><strong>Email:</strong> opulencebliss@gmail.com</p>
  <p><strong>Registered in:</strong> England and Wales</p>
  <p><strong>Happy Cleaners. Happier Homes.</strong></p>
  <h2>Our Privacy Commitment</h2>
  <p>At Opulence Bliss, we understand that customers are trusting us with information about their homes, bookings and personal circumstances.</p>
  <p>We also understand that our Cleaners trust us with their personal and business information.</p>
  <p>We therefore aim to handle personal information with the same care, fairness and respect that we expect our Customers and Cleaners to show one another.</p>
  <p>Your information. Your trust. Our responsibility.</p>
$policy$,
    version = '1.1',
    updated_at = now()
where slug = 'privacy'
  and updated_by is null;

update public.legal_documents
set content_html = $policy$
  <p><strong>Happy Cleaners. Happier Homes.</strong></p>
  <p><strong>Version:</strong> 1.1</p>
  <p><strong>Effective Date:</strong> August 2026</p>
  <p><strong>Last Updated:</strong> September 2026</p>
  <h2>1. Purpose</h2>
  <p>At Opulence Bliss Ltd, we understand that plans can change.</p>
  <p>This Cancellation &amp; Refund Policy explains what happens when a customer needs to cancel or change a cleaning booking, when a cleaner is unable to attend, and when a refund may be available.</p>
  <p>Our aim is to operate a policy that is fair to customers and fair to our self-employed cleaning professionals.</p>
  <p>This policy should be read together with our Customer Terms &amp; Conditions.</p>
  <h2>Your Legal Right to Cancel</h2>
  <p>Because you book online, you have a legal right to cancel your booking within 14 days, without giving a reason. This right comes from the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 and applies alongside this policy.</p>
  <p><strong>How long you have.</strong> The 14 days start on the day you make your booking and end at the end of the 14th day after that day.</p>
  <p><strong>If your service starts within the 14 days.</strong> We will only start your service within the 14 days if you ask us to, which you do by ticking the box when you book. You can still cancel during the 14 days. If you cancel after your service has started, you pay for the part already provided, in proportion to the full price. Once your service has been fully provided, you can no longer cancel it under this right.</p>
  <p><strong>How to cancel.</strong> Cancel through your Opulence Bliss account, or tell us by email at opulencebliss@gmail.com, or by phone, SMS or WhatsApp on +44 7484 717935. You can use the model form below, but you do not have to.</p>
  <p><strong>Your refund.</strong> We will refund any money due within 14 days of the day you tell us, using the payment method you used to book.</p>
  <p>Where this legal right applies, it takes precedence over the notice periods and charges in section 3.</p>
  <h3>Model cancellation form</h3>
  <p>To: Opulence Bliss Ltd, 128 City Road, London, EC1V 2NX, opulencebliss@gmail.com, +44 7484 717935</p>
  <p>I give notice that I cancel my contract for the supply of the following service:</p>
  <p>Booked on:</p>
  <p>Name:</p>
  <p>Address:</p>
  <p>Date:</p>
  <h2>2. Booking Cancellation</h2>
  <p>A customer may request cancellation of a booking by contacting Opulence Bliss Ltd as soon as possible.</p>
  <p>Cancellation requests can be made by:</p>
  <p>Your Opulence Bliss account;</p>
  <p>WhatsApp;</p>
  <p>Telephone;</p>
  <p>SMS; or</p>
  <p>Email.</p>
  <p>A cancellation is only considered received once Opulence Bliss Ltd has received the customer's notification.</p>
  <p>Customers should provide:</p>
  <p>Name;</p>
  <p>Booking date;</p>
  <p>Property address; and</p>
  <p>Any other information needed to identify the booking.</p>
  <h2>3. Cancellation Notice Period</h2>
  <p>The applicable cancellation charge depends on how much notice is provided.</p>
  <p>More than 48 hours before the booking</p>
  <p>Where a customer cancels more than 48 hours before the scheduled cleaning appointment, no cancellation charge will normally apply.</p>
  <p>Where payment has already been received, the customer will normally be entitled to a refund, subject to any lawful deductions that may apply.</p>
  <p>Between 24 and 48 hours before the booking</p>
  <p>Where a customer cancels between 24 and 48 hours before the scheduled appointment, Opulence Bliss may apply a cancellation charge of up to 25% of the booking price.</p>
  <p>Any remaining balance will be refunded where applicable.</p>
  <p>Less than 24 hours before the booking</p>
  <p>Where a customer cancels less than 24 hours before the scheduled appointment, Opulence Bliss may apply a cancellation charge of up to 50% of the booking price.</p>
  <p>Any remaining balance will be refunded where applicable.</p>
  <p>Same-day cancellation or failure to attend</p>
  <p>Where a customer:</p>
  <p>Cancels on the day of the booking;</p>
  <p>Fails to provide access;</p>
  <p>Is unavailable when the cleaner arrives; or</p>
  <p>Prevents the cleaner from carrying out the agreed service,</p>
  <p>Opulence Bliss may charge up to 100% of the booking price.</p>
  <p>The actual charge will be considered in light of the circumstances.</p>
  <h2>4. Rescheduling</h2>
  <p>Customers are encouraged to reschedule rather than cancel where possible.</p>
  <p>Requests to reschedule should be made as early as possible.</p>
  <p>We will make reasonable efforts to accommodate the new date and time, subject to cleaner availability.</p>
  <p>Where a customer provides sufficient notice, we will normally try to reschedule the booking without a cancellation charge.</p>
  <p>Repeated changes or very late requests may be treated as cancellations.</p>
  <h2>5. Cleaner Cancellation</h2>
  <p>We understand that unexpected circumstances can affect a cleaner's ability to attend a booking.</p>
  <p>Where a cleaner cannot attend, they must notify Opulence Bliss as soon as reasonably possible.</p>
  <p>Examples of circumstances that may justify a cancellation include:</p>
  <p>Sudden illness;</p>
  <p>Emergency;</p>
  <p>Accident;</p>
  <p>Severe travel disruption;</p>
  <p>Unsafe working conditions;</p>
  <p>Family emergency; or</p>
  <p>Other circumstances beyond the cleaner's reasonable control.</p>
  <p>Where a cleaner cancels, Opulence Bliss will make reasonable efforts to:</p>
  <p>Find another suitable cleaner;</p>
  <p>Reschedule the booking; or</p>
  <p>Provide an appropriate refund where the service cannot be provided.</p>
  <p>Customers will not be charged a cancellation fee because a cleaner has cancelled.</p>
  <h2>6. Opulence Bliss Cancellation</h2>
  <p>In exceptional circumstances, Opulence Bliss may need to cancel a booking.</p>
  <p>Where we cancel a booking before the service has been provided, customers will normally receive either:</p>
  <p>An alternative booking date;</p>
  <p>An alternative cleaner; or</p>
  <p>A refund for the affected service.</p>
  <p>We will communicate the available options as soon as reasonably possible.</p>
  <h2>7. Customer Access Failure</h2>
  <p>Customers are responsible for ensuring that the cleaner can access the property at the agreed time.</p>
  <p>If a cleaner arrives at the agreed location but cannot gain access because:</p>
  <p>Nobody is present;</p>
  <p>Keys do not work;</p>
  <p>The key-safe code is incorrect;</p>
  <p>Access instructions are incorrect; or</p>
  <p>Another issue prevents entry,</p>
  <p>the booking may be treated as a customer cancellation or failed appointment.</p>
  <p>Where appropriate, the cleaner may be asked to wait for a reasonable period.</p>
  <p>If access cannot be provided within that period, a cancellation charge may apply.</p>
  <h2>8. Refunds</h2>
  <p>Where a refund is approved, Opulence Bliss will normally return the applicable amount to the original payment method where reasonably possible.</p>
  <p>Because we currently accept payment by bank transfer, refunds will normally be made by bank transfer.</p>
  <p>Customers may be asked to provide the bank details required to process the refund.</p>
  <p>Customers should not send bank details by unsecured or inappropriate means.</p>
  <h2>9. Cleaning Quality and Refund Requests</h2>
  <p>A customer should not automatically cancel a booking or request a full refund because they are dissatisfied with part of the cleaning service.</p>
  <p>Where there is an issue with the service, customers should contact us as soon as possible.</p>
  <p>We may ask for:</p>
  <p>Photographs;</p>
  <p>Details of the areas affected;</p>
  <p>The booking information; and</p>
  <p>Any other information reasonably required to investigate the matter.</p>
  <p>Depending on the circumstances, we may offer:</p>
  <p>A correction or re-clean;</p>
  <p>A partial refund;</p>
  <p>A full refund; or</p>
  <p>Another reasonable solution.</p>
  <p>The appropriate remedy will depend on the individual circumstances.</p>
  <h2>10. No Refund for Unused Time</h2>
  <p>Where a customer has booked a fixed amount of cleaning time, the cleaner will work within that agreed period.</p>
  <p>A customer generally will not be entitled to a refund simply because the cleaner completes the agreed cleaning tasks before the full booked period has elapsed.</p>
  <p>Similarly, where the customer requests additional work during the appointment, additional time or charges may apply.</p>
  <h2>11. Additional Cleaning Requests</h2>
  <p>If a customer requests additional services that were not included in the original booking, the cleaner should confirm with the customer and, where necessary, Opulence Bliss before additional charges are incurred.</p>
  <p>Additional services may include:</p>
  <p>Oven cleaning;</p>
  <p>Fridge cleaning;</p>
  <p>Interior window cleaning;</p>
  <p>Cabinet cleaning;</p>
  <p>Ironing;</p>
  <p>Laundry;</p>
  <p>Other specialist or additional cleaning.</p>
  <h2>12. Exceptional Circumstances</h2>
  <p>We understand that circumstances may arise that make it unreasonable to apply a standard cancellation charge.</p>
  <p>Examples may include:</p>
  <p>Serious illness;</p>
  <p>Bereavement;</p>
  <p>Emergency hospitalisation;</p>
  <p>Major property damage;</p>
  <p>Fire;</p>
  <p>Flood;</p>
  <p>Serious security incident;</p>
  <p>Other exceptional circumstances.</p>
  <p>Opulence Bliss may exercise reasonable discretion in such cases.</p>
  <p>Any decision will be considered on an individual basis.</p>
  <h2>13. Refund Processing Time</h2>
  <p>Once a refund has been approved, Opulence Bliss will aim to process it as soon as reasonably practicable.</p>
  <p>The time taken for funds to appear in the customer's account may depend on the banking system and the customer's bank.</p>
  <h2>14. Disputing a Cancellation Charge</h2>
  <p>If you believe a cancellation charge has been applied incorrectly, please contact us.</p>
  <p>Please provide:</p>
  <p>Your name;</p>
  <p>Booking details;</p>
  <p>Date of cancellation;</p>
  <p>Reason for cancellation; and</p>
  <p>Any supporting information.</p>
  <p>We will review the circumstances and respond fairly.</p>
  <h2>15. Fairness to Customers and Cleaners</h2>
  <p>Our cancellation policy exists to protect both sides of the booking.</p>
  <p>When a customer cancels at short notice, the cleaner may have:</p>
  <p>Travelled to the property;</p>
  <p>Turned down another booking;</p>
  <p>Reserved the time exclusively for the customer; or</p>
  <p>Incurred travel or other expenses.</p>
  <p>At the same time, we recognise that customers may sometimes experience genuine emergencies.</p>
  <p>Our approach is therefore based on reasonable notice, fairness and individual circumstances.</p>
  <h2>16. Changes to This Policy</h2>
  <p>We may update this Cancellation &amp; Refund Policy from time to time.</p>
  <p>The latest version will be made available to customers through our website or booking process.</p>
  <p>Any material changes will be communicated where reasonably necessary.</p>
  <h2>17. Contact Us</h2>
  <p>Opulence Bliss Ltd</p>
  <p><strong>Company Registration Number:</strong> 15894675</p>
  <p><strong>Call / SMS / WhatsApp:</strong> +44 7484 717935</p>
  <p><strong>Email:</strong> opulencebliss@gmail.com</p>
  <p><strong>Happy Cleaners. Happier Homes.</strong></p>
$policy$,
    version = '1.1',
    updated_at = now()
where slug = 'cancellation-refund'
  and updated_by is null;

insert into public.legal_documents (
  slug, title, audience, content_html, version, published, updated_by, created_at, updated_at
) values (
  'review-policy',
  'Review Policy',
  'everyone',
  $policy$
  <p><strong>Version:</strong> 1.0</p>
  <p><strong>Effective Date:</strong> September 2026</p>
  <h2>1. Why This Policy Exists</h2>
  <p>Reviews help customers choose and help our professionals improve. This policy explains how Opulence Bliss Ltd collects, publishes and moderates reviews, so that you can trust what you read.</p>
  <h2>2. Who Can Leave a Review</h2>
  <p>Reviews are left through your Opulence Bliss account after a visit. Customers can review their professional, and professionals can review their customer.</p>
  <h2>3. Public or Private: the Reviewer Decides</h2>
  <p>When you leave a review, you choose whether it is public or private, whatever your rating.</p>
  <p>Public reviews can be seen by anyone. Private reviews are seen only by the person you reviewed and our team.</p>
  <p>Every star rating counts towards the ratings we show publicly, including private ones. The text of a private review is never published.</p>
  <h2>4. What We Never Do</h2>
  <p>We never:</p>
  <p>Hide, remove or delay a review because it is negative;</p>
  <p>Show only positive reviews, or leave negative ones out of our ratings;</p>
  <p>Write reviews ourselves, or ask anyone to write a fake review;</p>
  <p>Pay for or reward reviews;</p>
  <p>Publish example or sample reviews as if they were real.</p>
  <h2>5. When We May Remove a Review</h2>
  <p>We may remove or edit a review, whatever its rating, if it:</p>
  <p>Is abusive, threatening, discriminatory or offensive;</p>
  <p>Includes someone's personal information, such as a phone number or address;</p>
  <p>Is not about the service;</p>
  <p>Is one we reasonably believe to be fake, or not written by the person on the booking;</p>
  <p>Breaks the law.</p>
  <p>Where we can, we will tell the reviewer why.</p>
  <h2>6. Customer Testimonials</h2>
  <p>Testimonials on our website come from real customers. We keep a record of where each one came from.</p>
  <h2>7. Replies</h2>
  <p>We or the professional may reply publicly to a review.</p>
  <h2>8. Reporting a Review</h2>
  <p>If you think a review breaks this policy, contact us by email at opulencebliss@gmail.com, or by phone, SMS or WhatsApp on +44 7484 717935.</p>
$policy$,
  '1.0',
  true,
  null,
  now(),
  now()
)
on conflict (slug) do nothing;

do $notice$
declare
  v_slug text;
begin
  for v_slug in
    select slug from public.legal_documents
    where slug in ('privacy', 'cancellation-refund') and updated_by is not null
  loop
    raise notice '% was edited in admin and was not overwritten. Merge the new sections by hand.', v_slug;
  end loop;
end
$notice$;

commit;
