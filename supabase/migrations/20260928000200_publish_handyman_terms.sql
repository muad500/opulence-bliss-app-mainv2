-- Publish the client's Handyman Services Terms (development checklist item 59).
-- The wording is the client's latest version, with two factual corrections:
-- the company is named "Opulence Bliss Ltd" and its registered office is
-- given. The paper signature fields are omitted, as a web page cannot be
-- signed; the acknowledgement paragraph is kept. The quote form now asks
-- customers to accept these Terms.
--
-- The allowed document types also include review-policy, which the
-- legal-documents patch awaiting approval will publish.

begin;

alter table public.legal_documents
  drop constraint if exists legal_documents_slug_check;
alter table public.legal_documents
  add constraint legal_documents_slug_check check (
    slug in ('terms', 'privacy', 'cancellation-refund', 'handyman-terms', 'review-policy', 'professional-partner-agreement')
  );

insert into public.legal_documents (
  slug, title, audience, content_html, version, published, updated_by, created_at, updated_at
) values (
  'handyman-terms',
  'Handyman Services Terms',
  'customers',
  $policy$
  <p><strong>Effective Date:</strong> September 2026</p>
  <p><strong>Version:</strong> 1.0</p>
  <h2>1. About This Agreement</h2>
  <p>These Handyman Services Terms and Conditions (“Terms”) apply to handyman, property maintenance, assembly, installation, repair and related services provided by Opulence Bliss Ltd (“Opulence”, “we”, “us” or “our”) to a customer (“Customer”, “you” or “your”).</p>
  <p>By requesting, accepting or allowing Opulence to commence a Handyman Service, you agree to these Terms together with the specific quotation, booking confirmation, work description or other written agreement issued for your job.</p>
  <p>Where a quotation or booking confirmation contains specific terms that apply to your particular job, those terms will apply alongside these Terms. If there is a conflict, the specific written quotation will take precedence to the extent of that conflict.</p>
  <p>These Terms are intended to apply to customers in England and Wales and will be interpreted in accordance with applicable UK law.</p>
  <h2>2. Our Handyman Services</h2>
  <p>Opulence provides general handyman and property maintenance services, which may include, where agreed:</p>
  <p>Furniture assembly</p>
  <p>Flat-pack assembly</p>
  <p>Shelving and storage installation</p>
  <p>Picture and mirror hanging</p>
  <p>Curtain and blind installation</p>
  <p>Minor repairs</p>
  <p>Door and handle adjustments</p>
  <p>Locks and fittings</p>
  <p>Fixtures and fittings</p>
  <p>Wall mounting</p>
  <p>Minor carpentry</p>
  <p>Caulking and sealant work</p>
  <p>Minor decorating and touch-up work</p>
  <p>Basic property maintenance</p>
  <p>General household repairs</p>
  <p>Removal or replacement of minor fixtures</p>
  <p>Other handyman services specifically agreed with the Customer.</p>
  <p>The precise work to be completed will be described in the quotation, booking confirmation or agreed scope of works.</p>
  <p>Opulence is not required to undertake work that is outside the agreed scope unless additional work is agreed in accordance with these Terms.</p>
  <h2>3. Work We Do Not Normally Undertake</h2>
  <p>Unless specifically agreed and appropriately qualified/licensed, Opulence does not undertake work that requires specialist certification, specialist qualifications or statutory registration.</p>
  <p>This may include, without limitation:</p>
  <p>Gas installation, alteration or repair</p>
  <p>Gas appliance work</p>
  <p>Major electrical installation work</p>
  <p>Work requiring certification under applicable electrical regulations</p>
  <p>Structural alterations</p>
  <p>Major roofing work</p>
  <p>Major plumbing installations</p>
  <p>Asbestos removal or disturbance</p>
  <p>Work involving hazardous substances</p>
  <p>Major building or demolition work</p>
  <p>Work requiring specialist engineering certification</p>
  <p>Work requiring planning permission or building control approval</p>
  <p>Work that would be unsafe to undertake</p>
  <p>Work outside the competence or authorisation of the person assigned to the job.</p>
  <p>Where appropriate, Opulence may advise the Customer that a suitably qualified specialist should be appointed.</p>
  <p>The Customer must not ask or instruct an Opulence operative to undertake work that they are not authorised, qualified or insured to perform.</p>
  <h2>4. Quotations and Estimates</h2>
  <p>Where a quotation is provided, it will normally describe:</p>
  <p>The agreed work;</p>
  <p>The estimated or fixed price;</p>
  <p>Labour charges;</p>
  <p>Materials, where applicable;</p>
  <p>Any applicable call-out or minimum service charge;</p>
  <p>Any assumptions made when preparing the quotation; and</p>
  <p>Any exclusions or limitations.</p>
  <p>A quotation is based on the information available to Opulence at the time it is prepared.</p>
  <p>Where the actual condition of the property, fixture, wall, furniture, appliance or other item differs materially from the information provided, additional work or costs may be necessary.</p>
  <p>Opulence will explain the issue and, where reasonably practicable, obtain Customer approval before carrying out additional chargeable work.</p>
  <h2>5. Fixed Price and Time-Based Work</h2>
  <p>Where a fixed price has been agreed, the price covers only the work specifically described in the quotation.</p>
  <p>Where a job is charged by time, the applicable hourly rate and any minimum booking period will be communicated before the work begins.</p>
  <p>Unless expressly included in the agreed price, the Customer may be responsible for:</p>
  <p>Materials;</p>
  <p>Replacement parts;</p>
  <p>Specialist equipment;</p>
  <p>Parking or access charges;</p>
  <p>Disposal charges;</p>
  <p>Additional labour caused by unforeseen conditions; and</p>
  <p>Additional work requested by the Customer.</p>
  <p>Any additional charges will be communicated as clearly as reasonably practicable before they are incurred.</p>
  <h2>6. Additional Work and Variations</h2>
  <p>A Customer may request additional work during an appointment.</p>
  <p>Additional work is not automatically included in the original quotation.</p>
  <p>Where additional work changes the price or duration of the job, Opulence will explain the additional charge or revised estimate before proceeding, where reasonably practicable.</p>
  <p>The Customer may decline additional work.</p>
  <p>If an unforeseen issue prevents the originally agreed work from being completed safely or properly, Opulence may pause the work and discuss the available options with the Customer.</p>
  <h2>7. Materials and Parts</h2>
  <p>Unless otherwise agreed, the Customer is responsible for ensuring that any Customer-supplied materials, fixtures or parts are suitable for the intended work.</p>
  <p>Opulence may purchase materials on behalf of the Customer where this has been agreed.</p>
  <p>The Customer may be charged for:</p>
  <p>Materials;</p>
  <p>Parts;</p>
  <p>Delivery charges;</p>
  <p>Collection charges; and</p>
  <p>Reasonable expenses incurred in obtaining agreed materials.</p>
  <p>Where the Customer supplies a defective, unsuitable, incomplete or incompatible product, Opulence will not be responsible for defects or delays caused solely by that product.</p>
  <p>If an unsuitable product is identified before installation, Opulence may refuse to install it until an appropriate replacement is provided.</p>
  <h2>8. Customer Responsibilities</h2>
  <p>The Customer must:</p>
  <p>Provide accurate information about the work required.</p>
  <p>Ensure Opulence has reasonable access to the property and work area.</p>
  <p>Remove or secure personal belongings where reasonably necessary.</p>
  <p>Identify fragile, valuable or delicate items before work begins.</p>
  <p>Inform Opulence of known hazards, defects or unusual conditions.</p>
  <p>Ensure any required permissions have been obtained.</p>
  <p>Ensure the property is reasonably safe for the work to be carried out.</p>
  <p>Provide access to electricity, water or other facilities where reasonably required.</p>
  <p>Ensure pets are appropriately secured where necessary.</p>
  <p>Provide any agreed materials or products at the agreed time.</p>
  <p>Obtain permission from the property owner where the Customer is not the owner.</p>
  <p>The Customer must not knowingly provide false or misleading information about the condition of the property or the work required.</p>
  <h2>9. Access to the Property</h2>
  <p>The Customer must provide reasonable access at the agreed appointment time.</p>
  <p>If Opulence is unable to access the property because:</p>
  <p>Nobody is available;</p>
  <p>Keys or access codes do not work;</p>
  <p>The Customer provides incorrect access information;</p>
  <p>The property is unsafe;</p>
  <p>The Customer is not authorised to provide access; or</p>
  <p>Access is otherwise prevented by circumstances within the Customer’s control,</p>
  <p>Opulence may treat the appointment as a failed visit and may charge reasonable costs that were clearly disclosed to the Customer in advance.</p>
  <p>Any cancellation or failed-appointment charge must remain proportionate and will not affect the Customer’s statutory rights.</p>
  <h2>10. Parking and Access Costs</h2>
  <p>Where parking is not reasonably available at the property, the Customer may be responsible for agreed parking, congestion, toll or similar charges incurred in carrying out the service.</p>
  <p>Where possible, such charges will be communicated before they are incurred.</p>
  <h2>11. Condition of the Property</h2>
  <p>The Customer acknowledges that existing defects, deterioration, poor installation, weak surfaces, hidden damage or unsuitable materials may affect the work.</p>
  <p>Examples include:</p>
  <p>Weak plaster;</p>
  <p>Damaged walls;</p>
  <p>Hollow or unsuitable surfaces;</p>
  <p>Hidden pipes or cables;</p>
  <p>Rotten timber;</p>
  <p>Loose fixtures;</p>
  <p>Previous poor workmanship;</p>
  <p>Water damage;</p>
  <p>Structural movement;</p>
  <p>Defective furniture;</p>
  <p>Missing components.</p>
  <p>Where Opulence reasonably identifies a condition that could make the proposed work unsafe or likely to cause damage, Opulence may recommend an alternative method or decline to proceed.</p>
  <h2>12. Hidden Pipes, Cables and Services</h2>
  <p>Before drilling, fixing, cutting or penetrating a surface, reasonable care will be taken to identify potential hidden services where practicable.</p>
  <p>However, no non-invasive checking method can guarantee the identification of every concealed pipe, cable, structural element or other service.</p>
  <p>The Customer must disclose any known information regarding concealed services.</p>
  <p>Where information has not been provided, and a concealed service is damaged despite reasonable care being taken, liability will be assessed according to the circumstances and applicable law.</p>
  <h2>13. Furniture Assembly and Customer-Supplied Products</h2>
  <p>Where Opulence assembles furniture or installs a product supplied by the Customer:</p>
  <p>The product must be complete and suitable for assembly;</p>
  <p>All necessary components should be supplied;</p>
  <p>Instructions should be available where applicable; and</p>
  <p>The Customer remains responsible for the product manufacturer’s design and instructions.</p>
  <p>Opulence is responsible for carrying out the agreed assembly service with reasonable care and skill.</p>
  <p>Opulence does not become the manufacturer of any product it assembles or installs.</p>
  <h2>14. Wall Mounting and Fixings</h2>
  <p>For shelves, televisions, mirrors, cabinets, pictures and similar items, the Customer must disclose any known information about the wall or surface.</p>
  <p>The suitability of a fixing depends on the wall construction, the weight and the fixing used.</p>
  <p>Where the wall or surface is unsuitable, damaged or materially different from what was reasonably expected, Opulence may recommend an alternative fixing or decline the work.</p>
  <p>The Customer should provide the weight and dimensions of items where relevant.</p>
  <h2>15. Electrical, Gas and Specialist Work</h2>
  <p>Opulence will only undertake electrical, gas, plumbing or other specialist work where the work is within the competence, authorisation and legal requirements applicable to the person carrying it out.</p>
  <p>Where specialist certification or registration is legally required, Opulence will not represent that general handyman services satisfy that requirement.</p>
  <p>Customers may be advised to appoint an appropriately qualified or registered specialist where required.</p>
  <h2>16. Health and Safety</h2>
  <p>Opulence reserves the right to stop or refuse work where the working environment presents a serious or unreasonable health and safety risk.</p>
  <p>Examples may include:</p>
  <p>Exposed live electrical components;</p>
  <p>Gas leaks or suspected gas leaks;</p>
  <p>Structural instability;</p>
  <p>Severe infestation;</p>
  <p>Hazardous substances;</p>
  <p>Asbestos or suspected asbestos;</p>
  <p>Unsafe access;</p>
  <p>Dangerous animals;</p>
  <p>Excessive clutter preventing safe access;</p>
  <p>Severe water damage;</p>
  <p>Unsafe working-at-height conditions; or</p>
  <p>Threatening, abusive or violent behaviour.</p>
  <p>Where work cannot safely proceed, Opulence will explain the reason where reasonably practicable.</p>
  <h2>17. Customer Conduct</h2>
  <p>Customers must treat Opulence employees, contractors and representatives respectfully.</p>
  <p>Opulence will not tolerate:</p>
  <p>Threatening behaviour;</p>
  <p>Violence;</p>
  <p>Harassment;</p>
  <p>Discrimination;</p>
  <p>Abusive language;</p>
  <p>Intimidation;</p>
  <p>Unlawful conduct; or</p>
  <p>Deliberate attempts to place an operative in an unsafe situation.</p>
  <p>Where such conduct occurs, Opulence may stop the service and leave the property.</p>
  <p>Any resulting cancellation or termination will be handled in accordance with applicable law and the circumstances of the individual case.</p>
  <h2>18. Pets and Animals</h2>
  <p>Customers must inform Opulence about animals at the property.</p>
  <p>Where an animal presents a safety risk, the Customer may be required to secure the animal before work begins.</p>
  <p>Opulence may decline to enter or remain at a property where an animal presents a genuine safety concern.</p>
  <h2>19. Appointment Times and Delays</h2>
  <p>Opulence will make reasonable efforts to attend at the agreed appointment time.</p>
  <p>Appointment times may occasionally be affected by:</p>
  <p>Traffic;</p>
  <p>Weather;</p>
  <p>Previous jobs taking longer than expected;</p>
  <p>Emergencies;</p>
  <p>Vehicle or equipment problems;</p>
  <p>Staff illness;</p>
  <p>Access issues; or</p>
  <p>Other circumstances outside reasonable control.</p>
  <p>Where reasonably practicable, Opulence will notify the Customer of significant delays.</p>
  <p>An appointment time is not a guarantee of completion by a particular time unless expressly agreed in writing.</p>
  <h2>20. Cancellation and Rescheduling by the Customer</h2>
  <p>Customers may cancel or request to reschedule an appointment by contacting Opulence through the designated communication channel.</p>
  <p>Any cancellation charge will be communicated to the Customer before booking and will be proportionate to the circumstances and any genuine costs reasonably incurred.</p>
  <p>Nothing in this section removes or restricts any cancellation or other rights that the Customer has under applicable consumer law.</p>
  <p>Where a consumer has a statutory cancellation right, those rights will apply.</p>
  <h2>21. Consumer Cancellation Rights</h2>
  <p>Where applicable, consumers entering into a distance or off-premises service contract may have a statutory cancellation period.</p>
  <p>For qualifying contracts, this may include a 14-day cancellation period under the Consumer Contracts Regulations 2013.</p>
  <p>If the Customer expressly requests that work begins during the cancellation period, Opulence may begin the service before the cancellation period expires where legally permitted.</p>
  <p>Where applicable, the Customer may be required to pay a proportionate amount for services supplied before cancellation.</p>
  <p>Where a service has been fully performed following the Customer’s valid request and acknowledgement in accordance with applicable law, the statutory right to cancel may cease.</p>
  <p>These provisions do not remove any rights that cannot legally be excluded.</p>
  <h2>22. Cancellation by Opulence</h2>
  <p>Opulence may cancel or terminate a booking where:</p>
  <p>The requested work is unsafe;</p>
  <p>The work is outside the services Opulence can lawfully or safely provide;</p>
  <p>The Customer materially misrepresented the work required;</p>
  <p>Access cannot reasonably be provided;</p>
  <p>The Customer engages in threatening or abusive conduct;</p>
  <p>Required materials or information are not provided;</p>
  <p>The property is unsuitable for the agreed work; or</p>
  <p>Circumstances outside Opulence’s reasonable control prevent the service.</p>
  <p>Where Opulence cancels a service for reasons that are not the Customer’s fault, Opulence will, where appropriate, refund any payment made for services not provided.</p>
  <h2>23. Payment</h2>
  <p>Payment must be made using the payment method and within the timeframe stated in the quotation, booking confirmation or invoice.</p>
  <p>Opulence may require:</p>
  <p>Full payment in advance;</p>
  <p>A deposit;</p>
  <p>Payment on completion; or</p>
  <p>Payment following invoicing,</p>
  <p>depending on the type and value of the work.</p>
  <p>The Customer will be informed of the applicable payment arrangement before the service begins.</p>
  <h2>24. Failure to Pay</h2>
  <p>Where an amount remains unpaid after it becomes due, Opulence may request payment and may suspend further work or services until outstanding amounts are resolved.</p>
  <p>Nothing in this section limits the Customer’s statutory rights concerning a genuine dispute about the quality or performance of services.</p>
  <h2>25. Completion of Work</h2>
  <p>A job will normally be considered complete when the agreed work has been carried out, subject to any agreed outstanding items.</p>
  <p>Where practical, the Customer may inspect the completed work before the operative leaves.</p>
  <p>If the Customer identifies an issue with the agreed work, they should notify Opulence as soon as reasonably practicable.</p>
  <h2>26. Workmanship and Remedial Work</h2>
  <p>Opulence aims to provide services with reasonable care and skill.</p>
  <p>Where the service does not conform to the agreed requirements or applicable statutory standards, the Customer may have rights to require repeat performance or a price reduction under applicable law.</p>
  <p>Where appropriate, Opulence will have a reasonable opportunity to inspect and, where appropriate, remedy an issue arising from its workmanship.</p>
  <p>Any separate workmanship guarantee offered by Opulence will be stated in writing and will operate in addition to, and not in place of, the Customer’s statutory rights.</p>
  <h2>27. Damage and Breakages</h2>
  <p>Opulence will take reasonable care when carrying out services.</p>
  <p>If property is damaged as a result of Opulence’s negligence or failure to exercise reasonable care and skill, Opulence will address the matter in accordance with applicable law and any applicable insurance arrangements.</p>
  <p>The Customer should notify Opulence of any alleged damage as soon as reasonably practicable and provide reasonable supporting information, including photographs where appropriate.</p>
  <p>Opulence will not accept responsibility for:</p>
  <p>Pre-existing damage;</p>
  <p>Normal wear and tear;</p>
  <p>Defects in Customer-supplied products;</p>
  <p>Damage caused by concealed defects;</p>
  <p>Damage caused by information withheld by the Customer;</p>
  <p>Damage resulting from unsafe or unsuitable surfaces;</p>
  <p>Damage caused by third parties; or</p>
  <p>Damage outside Opulence’s reasonable control,</p>
  <p>except where applicable law provides otherwise.</p>
  <h2>28. Valuables and Personal Property</h2>
  <p>Customers should secure cash, jewellery, confidential documents, collectables and other valuable or sensitive property before work begins.</p>
  <p>Opulence should be informed of any particularly fragile or valuable item that could reasonably be affected by the work.</p>
  <p>This does not remove any liability that Opulence cannot lawfully exclude.</p>
  <h2>29. Photographs and Job Records</h2>
  <p>Opulence may take photographs of the work area or completed work where reasonably necessary for:</p>
  <p>Assessing the scope of work;</p>
  <p>Recording pre-existing conditions;</p>
  <p>Quality control;</p>
  <p>Recording completed work;</p>
  <p>Investigating complaints;</p>
  <p>Insurance purposes; or</p>
  <p>Resolving disputes.</p>
  <p>Where photographs contain identifiable personal information or are intended for marketing purposes, Opulence will handle them in accordance with its privacy policy and applicable data protection law.</p>
  <p>Photographs will not be used for public marketing without the appropriate permission where required.</p>
  <h2>30. Complaints</h2>
  <p>If you are dissatisfied with a service, contact Opulence as soon as reasonably practicable.</p>
  <p>The Customer should provide:</p>
  <p>The booking reference, if available;</p>
  <p>A description of the issue;</p>
  <p>Photographs where relevant;</p>
  <p>The date the work was completed; and</p>
  <p>Any other information reasonably required to investigate the complaint.</p>
  <p>Opulence will review complaints fairly and will seek to resolve legitimate issues appropriately.</p>
  <p>Where remedial work is appropriate, Opulence may offer an opportunity to inspect and correct the issue.</p>
  <h2>31. Limitation of Liability</h2>
  <p>Nothing in these Terms excludes or limits liability that cannot legally be excluded or limited.</p>
  <p>In particular, nothing in these Terms excludes or restricts liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, or any other liability that cannot lawfully be excluded.</p>
  <p>Subject to the above, Opulence will not be responsible for losses that are not reasonably foreseeable or are outside the scope of the service agreed with the Customer.</p>
  <p>Nothing in these Terms removes or restricts the Customer’s statutory rights.</p>
  <p>Any limitation of liability in a consumer contract will be applied only to the extent permitted by applicable law.</p>
  <h2>32. Insurance</h2>
  <p>Opulence will maintain such insurance as it considers appropriate for the services it provides and as may be required by law or contract.</p>
  <p>Insurance does not replace the Customer’s statutory rights or automatically determine whether a claim is valid.</p>
  <h2>33. Subcontractors and Additional Operatives</h2>
  <p>Opulence may use appropriately selected employees, contractors or subcontractors to perform services where reasonably necessary.</p>
  <p>Opulence remains responsible for the service it has contracted to provide to the extent required by applicable law.</p>
  <p>The Customer must not engage an Opulence operative privately to undertake additional work outside the agreed booking without Opulence’s knowledge and agreement.</p>
  <h2>34. No Unauthorised Additional Work</h2>
  <p>An Opulence operative must not undertake chargeable additional work without appropriate Customer authorisation.</p>
  <p>Similarly, Customers must not instruct an operative to perform work that is outside their competence, authorisation or the scope of Opulence’s services.</p>
  <p>Where there is uncertainty about additional work, the Customer should contact Opulence directly.</p>
  <h2>35. Direct Arrangements with Operatives</h2>
  <p>Where an Opulence operative introduces or performs a service through Opulence, the Customer should make payments through the agreed Opulence payment process.</p>
  <p>Customers should not make undisclosed cash or private arrangements with an operative for work that forms part of an Opulence booking.</p>
  <p>This provision does not prevent a Customer from freely engaging another business in the future where there is no contractual restriction preventing that arrangement.</p>
  <h2>36. Reviews and Feedback</h2>
  <p>Customers are encouraged to provide honest and genuine feedback about their experience.</p>
  <p>Opulence may invite Customers to leave reviews on third-party platforms.</p>
  <p>Customers should ensure that reviews accurately reflect their genuine experience.</p>
  <p>Opulence will not require a Customer to provide a positive review as a condition of receiving a service.</p>
  <h2>37. Personal Data</h2>
  <p>Opulence will collect and process Customer information in accordance with its Privacy Policy and applicable data protection legislation.</p>
  <p>Information may be used where necessary to:</p>
  <p>Process bookings;</p>
  <p>Communicate with Customers;</p>
  <p>Provide services;</p>
  <p>Process payments;</p>
  <p>Manage complaints;</p>
  <p>Maintain service records;</p>
  <p>Meet legal obligations; and</p>
  <p>Protect the legitimate interests of Opulence and its Customers.</p>
  <h2>38. Force Majeure</h2>
  <p>Opulence will not be responsible for delay or failure to perform a service where the cause is outside its reasonable control, including serious weather events, major transport disruption, emergencies, utility failures, government restrictions, natural disasters or other circumstances that could not reasonably have been prevented.</p>
  <p>Where such an event affects a booking, Opulence will seek to communicate with the Customer and rearrange the service where reasonably possible.</p>
  <h2>39. Changes to These Terms</h2>
  <p>Opulence may update these Terms from time to time.</p>
  <p>The version applicable to a particular booking will normally be the version provided or made available to the Customer when the booking is accepted.</p>
  <p>Changes will not retrospectively remove rights that the Customer has already acquired under applicable law.</p>
  <h2>40. Severability</h2>
  <p>If any provision of these Terms is found to be invalid, unlawful or unenforceable, that provision will be treated as modified or removed to the minimum extent necessary.</p>
  <p>The remaining provisions will continue to apply.</p>
  <h2>41. No Waiver</h2>
  <p>If Opulence does not immediately enforce a provision of these Terms, this does not mean that Opulence has permanently waived its right to enforce that provision later.</p>
  <h2>42. Entire Agreement</h2>
  <p>The agreement between Opulence and the Customer consists of:</p>
  <p>These Handyman Services Terms;</p>
  <p>The applicable quotation or estimate;</p>
  <p>The booking confirmation;</p>
  <p>Any agreed scope of works; and</p>
  <p>Any additional written terms specifically agreed between the parties.</p>
  <p>Nothing in these Terms is intended to exclude or restrict statutory consumer rights.</p>
  <h2>43. Governing Law and Jurisdiction</h2>
  <p>These Terms are governed by the law applicable in the relevant part of the United Kingdom.</p>
  <p>Where the Customer is a consumer, nothing in these Terms prevents the Customer from relying on mandatory consumer protections or bringing proceedings in a court where the Customer is legally entitled to do so.</p>
  <h2>44. Contacting Opulence</h2>
  <p>For bookings, changes, complaints or questions regarding these Terms, Customers should contact:</p>
  <p>Opulence Bliss Ltd</p>
  <p>Company Registration Number: 15894675</p>
  <p>Registered in: England and Wales</p>
  <p>Registered office: 128 City Road, London, EC1V 2NX</p>
  <p>Call / SMS / WhatsApp: +44 7484 717935</p>
  <p>Email: opulencebliss@gmail.com</p>
  <h2>45. Customer Acknowledgement</h2>
  <p>By accepting a quotation, confirming a booking, making payment or allowing Opulence to commence the agreed work, the Customer confirms that they have had an opportunity to read these Terms and understand that the applicable terms form part of the agreement for the Handyman Service.</p>
$policy$,
  '1.0',
  true,
  null,
  now(),
  now()
)
on conflict (slug) do nothing;

commit;
