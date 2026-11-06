<!-- Generated from content/cleaner-onboarding-drafts.json. Edit that file, then regenerate. -->

# Cleaner onboarding: approved emails and staff checklist

**Version 1.0 – effective 1 October 2026**

Review version: 1.0 | Prepared: 2026-11-05

Approved operational wording from review draft-1. Publication is separate from delivery and activation: guarded Stage 2 flows and their readiness checks still apply.

## Client approval record

Approved as written by Opulence Bliss. Confirmation received: 2026-11-06. Effective: 2026-10-01.

Approved: E01–E10, D01 and C01–C12, Version 1.0. No amendments.

Original review: draft-1; exact source retained in content/history/. The effective date is not a backdated acceptance or approval date.

Recording approval in this review copy does not enable a website feature or send a message. Approved wording must be versioned and connected to the guarded workflow separately.

## Complete inventory

| Code | Draft                                           | Replaces / source reference                                    |
| ---- | ----------------------------------------------- | -------------------------------------------------------------- |
| E01  | Application received                            | Onboarding Process 9.1                                         |
| E02  | Induction and assessment invitation             | Onboarding Process: induction invitation (section unspecified) |
| E03  | General application rejection                   | Onboarding Process 9.3                                         |
| E04  | Secure DBS-related decision notice              | DBS Policy 6.2–6.3; cleaner spec 5.2                           |
| E05  | Manager escalation alert                        | Onboarding Process 3.9 and 3.14                                |
| E06  | Right-to-work expiry reminder                   | Onboarding Process 3.8                                         |
| E07  | Fresh basic DBS reminder                        | Onboarding Process 4.4                                         |
| E08  | First completed booking follow-up reminder      | Onboarding Process 4.1                                         |
| E09  | Fifth completed booking review reminder         | Onboarding Process 4.2                                         |
| E10  | Stage 2 account setup confirmation              | Cleaner spec 2.2, 5.4 and 8: welcome email                     |
| D01  | Application privacy and checks acknowledgement  | Onboarding Process 3.1A                                        |
| C01  | Application and desk screening                  | Cleaner Onboarding Checklist; Process 3.1                      |
| C02  | Interview and proposed review criteria          | Onboarding Process 3.3                                         |
| C03  | Live identity and right-to-work check           | Onboarding Process 3.7                                         |
| C04  | Basic DBS record and decision                   | DBS Policy 2, 4–8; cleaner spec 5.2–5.3                        |
| C05  | Experience or Manager waiver                    | Cleaner spec 5.3.1                                             |
| C06  | Cleaner insurance                               | Cleaner Terms 16.1; Safeguarding Policy 4.1                    |
| C07  | Induction and assessment                        | Cleaner spec 5.5; Process 3.19A and 3.21–3.21C                 |
| C08  | Acceptances, emergency contact and payout setup | Cleaner spec 5.3–5.4                                           |
| C09  | Independent final sign-off                      | Cleaner spec 5.3.1; existing independent-sign-off controls     |
| C10  | Escalation, decision and rejection record       | Onboarding Process 3.9 and 3.14                                |
| C11  | First completed booking follow-up               | Onboarding Process 4.1                                         |
| C12  | Fifth completed booking review                  | Onboarding Process 4.2                                         |

## Scope and implementation notes

- Approve or amend the text and checklist before enabling delivery or treating the proposed checklist wording as final. The existing published hard gates remain in force.
- No guaranteed work, minimum hours, application-response deadline, extra charge, automatic conviction exclusion or new interview pass score is proposed.
- Every merge field must be filled from an authorised record before an approved template is used. Invitation links must be personal and time-limited; staff links must require staff sign-in and the authenticator.
- Do not put DBS outcomes, offence details, certificate numbers, ID documents, medical details or personal contact/access details into ordinary email. Keep sensitive decisions and reasons in the restricted record and use a secure written-decision route.
- Published Privacy Policy section 13 and DBS Policy section 7 allow records needed for an unresolved case or legal matter to be held. Do not promise unconditional deletion on a fixed day.
- The build specification uses a three-year DBS renewal reminder. The existing renewal helper computes an annual anniversary. Before enabling the new reminder, verify and reconcile the verification/scheduler logic with the approved specification. This pack changes no runtime rule.
- The existing welcome email asks for checks after account creation. The Stage 2 specification puts those checks before induction and full account creation. E10 proposes wording for that new sequence; it does not replace the current welcome email yet.

## Source documents

- Cleaner Account Build Specification and Test Checklist, v1.0, effective 2026-10-01.
- Cleaner Terms and Conditions, v1.0, effective 2026-10-01.
- DBS and Criminal-Offence Data Policy, v1.0, effective 2026-10-01.
- Safeguarding, Lone Working and Incident Policy, v1.0, effective 2026-10-01.
- Privacy Policy, v1.0, effective 2026-10-01.

## Approved emails

### E01. Application received

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 9.1

Basis: Cleaner spec 2.2 and 5.1; Cleaner Terms 2.2, 4.1–4.2 and 17; Privacy Policy 3 and 13

Audience: Applicant

Trigger: After a valid application record is saved. Send once for that application, after the wording is approved.

**Subject: We have received your cleaner application**

Hello {{first_name}},

Thank you for applying to work through Opulence Bliss. We have received your application, reference {{application_reference}}.

Our team will review the information you provided and contact you about the next step. Before induction, we need to complete the application checks, including identity, the right to carry out self-employed work in the UK, a review of your basic DBS certificate and experience.

This application has not created a login or activated a cleaner account. You can receive booking offers only after the required checks, assessment, account setup and independent final sign-off are complete.

Please use the secure method our team gives you for identity or DBS documents. Do not send those documents or health information through WhatsApp or personal email.

You can read how we use your information in our Privacy Notice: {{privacy_url}}. To correct your application or ask a question, email hello@opulencebliss.com and quote your reference.

Opulence Bliss Ltd

Merge fields: {{first_name}}, {{application_reference}}, {{privacy_url}}

Reviewer notes:

- No response date or promise of work is made. Duplicate submissions must not generate a second email.

### E02. Induction and assessment invitation

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process: induction invitation (section unspecified)

Basis: Cleaner spec 2.2, 5.3 and 5.5; Safeguarding Policy 12.1

Audience: Applicant invited to induction

Trigger: Only after the pre-induction checks and experience stage are recorded, and staff have arranged the session.

**Subject: Your Opulence Bliss cleaner induction**

Hello {{first_name}},

We would like to invite you to your live cleaner induction and assessment.

Date: {{session_date}}
Time: {{session_time}} ({{time_zone}})
Join the induction: {{meeting_url}}

After the induction, the host will open the assessment. Use your personal assessment link on your own device: {{assessment_invitation_url}}. The link expires at {{invitation_expires_at}}. Do not share it or use someone else's link.

The assessment rules and timers will be shown before you start. You must stay on that page until you finish. Please tell us before the session if you need an adjustment, so that the host can arrange it.

This access is for the assessment only. Passing it does not activate your account: you must then accept the required documents, complete account setup and receive independent final sign-off before taking bookings.

If you cannot attend, or need help accessing the session, email hello@opulencebliss.com and quote {{application_reference}}.

Opulence Bliss Ltd

Merge fields: {{first_name}}, {{session_date}}, {{session_time}}, {{time_zone}}, {{meeting_url}}, {{assessment_invitation_url}}, {{invitation_expires_at}}, {{application_reference}}

Reviewer notes:

- Meeting and personal assessment links are merge fields, not new third-party integrations. No invitation or credential is created by preparing this draft.
- Do not ask applicants to email medical information when requesting an adjustment. Record only the granted assessment adjustment, as specified.

### E03. General application rejection

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 9.3

Basis: Cleaner spec 2, 5.2 and 7.3–7.4; Cleaner Terms 2.3; Privacy Policy 13

Audience: Applicant

Trigger: After the Manager records a general application rejection, its stage and a non-sensitive reason.

**Subject: An update on your cleaner application**

Hello {{first_name}},

Thank you for your interest in working through Opulence Bliss. After reviewing your application, we will not be progressing it further at this stage.

Reason: {{non_sensitive_reason_summary}}

If you think we have used incorrect information, or would like us to consider relevant information, please email hello@opulencebliss.com and quote {{application_reference}}.

We normally keep unsuccessful application information for six months from our decision, subject to the retention exceptions explained in our Privacy Notice: {{privacy_url}}.

Opulence Bliss Ltd

Merge fields: {{first_name}}, {{non_sensitive_reason_summary}}, {{application_reference}}, {{privacy_url}}

Reviewer notes:

- Not for assessment failure: use the unchanged Content Pack 4.2/4.3 message (Process 9.6).
- Not for a DBS-related decision: use E04 and provide the decision and explanation securely. Do not put sensitive reasons in the non-sensitive reason field.
- No general 14-day appeal deadline or three-month reapplication ban is added. The assessment-specific review/reapplication wording stays in its supplied template.

### E04. Secure DBS-related decision notice

**Version 1.0 – effective 1 October 2026**

Reference: DBS Policy 6.2–6.3; cleaner spec 5.2

Basis: DBS Policy 5.6, 6.1–6.4 and 8; Privacy Policy 6.11 and 7.2

Audience: Applicant whose DBS-related decision has been made by the Manager

Trigger: After the person has had the chance to explain, the Manager has decided, and a secure written decision with reasons is available to that person.

**Subject: An update on your Opulence Bliss application**

Hello {{first_name}},

Our Manager has completed the review of your application. You can read the decision and its explanation securely here: {{secure_decision_url}}.

You can ask us to review the decision. Email hello@opulencebliss.com and quote {{application_reference}}. If you cannot open the secure link, contact us so that we can arrange a secure way for you to receive the written decision.

Please do not send your certificate, offence details or identity documents by ordinary email.

Our DBS and Criminal-Offence Data Policy explains how we use and protect this information: {{dbs_policy_url}}.

Opulence Bliss Ltd

Merge fields: {{first_name}}, {{secure_decision_url}}, {{application_reference}}, {{dbs_policy_url}}

Reviewer notes:

- Requires a secure written-decision view or delivery route before use; that route is not claimed to be implemented by this draft.
- The decision and explanation belong in the protected record, not this email. A conviction must not produce an automatic rejection.
- No new deadline is imposed on a request for review.

### E05. Manager escalation alert

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 3.9 and 3.14

Basis: Cleaner spec 3 and 5.2; DBS Policy 6 and 8; Privacy Policy 6.11

Audience: Authorised Manager only

Trigger: When a staff member refers an applicant case for a Manager decision and locks the file.

**Subject: Cleaner application needs Manager review: {{application_reference}}**

Application {{application_reference}} has been referred for your review. The file is locked to other onboarding team members until the Manager review is resolved.

Open the restricted staff record: {{staff_record_url}}. Staff sign-in and the authenticator are required; private evidence also requires named access.

Review the recorded facts and any explanation from the applicant. Record your decision, its reason and any follow-up before resolving the escalation. A DBS-related decision must be explained to the person in writing through a secure route.

This email intentionally contains no DBS outcome, offence details, certificate number, identity document or medical information.

Merge fields: {{application_reference}}, {{staff_record_url}}

Reviewer notes:

- A reminder does not grant access. Keep the existing named DBS access list and role permissions.

### E06. Right-to-work expiry reminder

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 3.8

Basis: Cleaner spec 5.3.2 and 7.2; Cleaner Terms 2.1–2.3 and 4.1; Privacy Policy 6.11

Audience: Authorised onboarding staff or Manager

Trigger: 30 days and 7 days before the recorded right-to-work expiry, using the same template with the relevant reminder window.

**Subject: Right-to-work check due: {{professional_reference}}**

The recorded right-to-work permission for professional {{professional_reference}} expires on {{expiry_date}}. This is the {{days_until_expiry}}-day reminder.

Open the protected staff record: {{staff_record_url}}. Arrange the appropriate current check and record the check date, checker, evidence type, outcome and any new expiry date or no-expiry result.

Confirm that the checked permission allows the self-employed work offered through the platform. Refer unclear evidence or restrictions to the Manager; do not treat an application declaration as verification.

If permission has expired, no new bookings may be offered. Flag already accepted work for the team to review and reassign as required.

Merge fields: {{professional_reference}}, {{expiry_date}}, {{days_until_expiry}}, {{staff_record_url}}

Reviewer notes:

- No document number, share code or document image belongs in this email. Do not send it to customers.
- Use only 30 or 7 for the scheduled reminder window. This draft does not change the expiry scheduler.

### E07. Fresh basic DBS reminder

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 4.4

Basis: Cleaner spec 7.2; Cleaner Terms 2.2; DBS Policy 2, 5.4, 7 and 8

Audience: Named DBS onboarding staff or Manager

Trigger: When the fresh-certificate review falls due under the build specification's three-year rule. Reconcile the existing annual helper before enabling this schedule.

**Subject: Basic DBS review due: {{professional_reference}}**

A fresh basic DBS certificate review is due for professional {{professional_reference}} on {{review_due_date}}, under the renewal rule in the cleaner build specification.

Open the restricted record: {{staff_record_url}}. Arrange for the person to show their own fresh basic certificate through the secure checking process and record the required outcome and decision.

Do not request spent-conviction information or a higher level of check through this reminder. Any unspent-conviction decision needs a Manager review and an opportunity for the person to explain.

Do not attach a certificate or offence information to email. Record any certificate-copy deletion date and retain only what the published DBS Policy permits.

Merge fields: {{professional_reference}}, {{review_due_date}}, {{staff_record_url}}

Reviewer notes:

- This is an internal review reminder, not a statement that DBS certificates have a statutory three-year expiry.
- No change to the current renewal calculation or suspension behaviour is made by this draft.

### E08. First completed booking follow-up reminder

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 4.1

Basis: Cleaner spec 7.2; Safeguarding Policy 8–10; Privacy Policy 6.11

Audience: Assigned onboarding staff or Manager

Trigger: After the cleaner's first completed booking, so that the team can make the specified contact within 24 hours.

**Subject: First-booking follow-up: {{professional_reference}}**

Professional {{professional_reference}} completed their first booking, reference {{booking_reference}}, at {{completed_at}}.

The first-booking follow-up is due by {{follow_up_due_at}} under the cleaner build specification. Open the staff record: {{staff_record_url}}.

Check whether the cleaner is safe, whether any incident or access problem needs action, and whether they need help using the platform or completing the job record. Record the contact and agreed follow-up.

Escalate any safeguarding or immediate safety concern through the published procedure. Do not put customer addresses, access codes or sensitive incident details in this email.

Merge fields: {{professional_reference}}, {{booking_reference}}, {{completed_at}}, {{follow_up_due_at}}, {{staff_record_url}}

Reviewer notes:

- The 24-hour timing comes from the specification. It does not create a new customer-facing response promise.

### E09. Fifth completed booking review reminder

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 4.2

Basis: Cleaner spec 7.2; Cleaner Terms 2.2, 6 and 19; Safeguarding Policy 10.5

Audience: Assigned onboarding staff or Manager

Trigger: After the fifth completed booking, once for that milestone.

**Subject: Five-booking review: {{professional_reference}}**

Professional {{professional_reference}} has completed five bookings. The fifth-booking review is ready in the staff record: {{staff_record_url}}.

Review factual booking feedback, completed job records, any cancellations or no-shows, support requests and any open complaint or safety concern. Confirm that the professional's required checks and insurance are still current.

Record the review, any explanation from the cleaner and any agreed support or follow-up. Refer a possible suspension or disputed decision to the Manager under the applicable published policy.

There is no new numerical rating threshold or automatic penalty in this review.

Merge fields: {{professional_reference}}, {{staff_record_url}}

Reviewer notes:

- Count completed bookings; do not count a cancelled or uncompleted booking for this milestone.
- This review does not restart probation or replace the published cancellation/suspension rules.

### E10. Stage 2 account setup confirmation

**Version 1.0 – effective 1 October 2026**

Reference: Cleaner spec 2.2, 5.4 and 8: welcome email

Basis: Cleaner spec 5.3–5.4; Cleaner Terms 4.2 and 17; Privacy Policy 3

Audience: Cleaner after the assessment and required acceptances/account setup

Trigger: After full account setup and required acceptances are saved. Attach the exact document versions accepted, using the existing accepted-version attachment mechanism.

**Subject: Your Opulence Bliss cleaner account setup**

Hello {{first_name}},

Your cleaner account setup is complete. We have attached the document versions you accepted on {{accepted_at}}: {{accepted_documents}}.

You can review your details and accepted documents here: {{account_url}}.

Your account can receive booking offers only when all required checks and independent final sign-off are complete and its status is Active. Joining the platform does not guarantee a minimum amount of work.

If we need updated information, our team will contact you. For help, email hello@opulencebliss.com.

Opulence Bliss Ltd

Merge fields: {{first_name}}, {{accepted_at}}, {{accepted_documents}}, {{account_url}}

Reviewer notes:

- Proposed for the Stage 2 sequence only. Do not replace the current welcome email or detach its accepted-version PDFs before approval and integration.
- Do not say the cleaner is Active or ask them to repeat checks already completed before induction.

## Approved application acknowledgement

### D01. Application privacy and checks acknowledgement

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 3.1A

Basis: Cleaner spec 5.1; Cleaner Terms 2.2 and 17; DBS Policy 4.3 and 5.1; Privacy Policy 3–5

I have read the Privacy Notice (v1.0). I agree that Opulence Bliss Ltd may check my identity and right to carry out self-employed work in the UK, review my experience, and see my basic DBS certificate and record the check details and outcome as explained in the DBS and Criminal-Offence Data Policy (v1.0).

Reviewer notes:

- Required and unticked by default, with links to the published versions. Record the exact approved wording, time, IP and versions when this is later enabled.
- This is not marketing consent or the sole legal basis for processing. The published policies continue to explain the applicable legal bases.
- Keep the public test form's draft warning until the client approves the wording. Do not backdate or replace an earlier acknowledgement.

## Approved staff checklist

Every completed item in the eventual approved workflow must record the staff member, UTC time and any necessary note. Sensitive evidence stays in the restricted record. These review checkboxes are not live application decisions.

### C01. Application and desk screening

**Version 1.0 – effective 1 October 2026**

Reference: Cleaner Onboarding Checklist; Process 3.1

Basis: Cleaner spec 2.2, 5.1 and 5.2; Cleaner Terms 2 and 4.1

- [ ] Confirm the application record has full name, email, UK phone, postcode/areas, experience, general availability and stated right-to-work type. Referral code stays optional.
- [ ] Confirm the required unticked privacy/checks acknowledgement was actually given and its wording, version, time and IP are recorded. Draft acknowledgement is not treated as approved final wording.
- [ ] Check for an existing account/application and any recorded assessment reapplication date. Resolve duplicates without creating a second professional identity.
- [ ] Flag unclear right-to-work or self-employment restrictions for the proper live check or Manager review. An applicant's declaration alone does not verify eligibility.
- [ ] Review the stated areas, availability and relevant experience. Record any missing information that needs clarification; do not add a minimum-years or minimum-hours threshold.
- [ ] Record the screening outcome, factual note, staff member and time. Keep status Applied until the required screening items are completed.

Reviewer notes:

- No password, full account, job access or Active status is created by the application or desk screen.

### C02. Interview and proposed review criteria

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 3.3

Basis: Cleaner spec 5.2 and 5.5.4; Cleaner Terms 4 and 6; Safeguarding Policy 8 and 10

- [ ] Discuss the applicant's relevant cleaning experience or other evidence, and record factual examples or information still needed.
- [ ] Ask how they would follow the booked scope, confirm instructions, record pre-existing damage and report a problem. Assess against the published service and safety requirements.
- [ ] Check that they can explain how they would communicate appropriately with a customer through the platform and protect customer information.
- [ ] Confirm their understanding of check-in/check-out, leaving an unsafe situation, reporting incidents and contacting the team under the Safeguarding Policy.
- [ ] Explain the induction/assessment and how to request an adjustment. Record only an adjustment granted; do not put medical information in the interview or timing record.
- [ ] For each topic, propose one outcome: Meets requirement, Further information needed, or Refer to Manager. Record evidence and the overall staff decision; do not add an automatic numerical pass mark.

Reviewer notes:

- These are proposed operational review criteria, not a new legal eligibility test. Do not use protected characteristics, accent or unrelated private-life information as selection criteria.
- The separate assessment keeps its supplied server-marked pass rule; this checklist cannot change its score.

### C03. Live identity and right-to-work check

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 3.7

Basis: Cleaner spec 5.2–5.3; Cleaner Terms 2.1–2.2; Privacy Policy 4 and 13

- [ ] Use an authorised staff account with authenticator sign-in. Open private evidence only when needed and retain the access audit.
- [ ] Check the person live against the evidence using the appropriate checking process. Confirm identity, name/date-of-birth consistency and that the person is at least 18.
- [ ] Carry out the appropriate current right-to-work check for the evidence type. Confirm that the permission covers the self-employed work offered through this platform; do not infer this from a share code or declaration alone.
- [ ] Record the date, checker, evidence/document type, outcome and any expiry date or a verified no-expiry result. Do not add an unrestricted field for the full identity-document number.
- [ ] Confirm the permission remains valid before progressing. Refer uncertain restrictions, mismatches or unclear results to the Manager and keep the stage incomplete.
- [ ] Keep any necessary evidence in the restricted storage and apply the published retention and open-case rules. Never send ID documents through WhatsApp or personal email.

Reviewer notes:

- This checklist is a record of the required process, not a replacement for the official checking procedure for each evidence type.

### C04. Basic DBS record and decision

**Version 1.0 – effective 1 October 2026**

Reference: DBS Policy 2, 4–8; cleaner spec 5.2–5.3

Basis: Cleaner Terms 2.2; DBS Policy 2.1–2.3, 4.3, 5.6, 6, 7 and 8

- [ ] Check that the person was told why the basic DBS check is needed and agreed that the certificate may be seen and recorded.
- [ ] Only staff named on the written DBS access list may open the certificate or outcome. Log each deliberate opening; general staff/admin status alone is insufficient.
- [ ] See the person's own basic certificate, check that it belongs to them and record the name, certificate number, certificate date, outcome, decision/reason and review date.
- [ ] Keep offence information off the general applicant screen. Do not request or take into account spent convictions where the published policy says they must not be used.
- [ ] If an unspent conviction is shown, refer it to the Manager. Give the person the opportunity to explain before a decision; consider relevance, seriousness, time elapsed and the facts. Do not reject automatically because of a conviction.
- [ ] Record the Manager's decision and explanation, give the person the decision and reasons securely in writing, and explain that they can ask for a review.
- [ ] Do not retain a certificate image by default. If a copy is kept, record when it was first seen and delete it within six months unless a permitted legal matter requires a hold. Apply the published outcome/rejection retention periods.

Reviewer notes:

- A generic application rejection email is not a substitute for the required DBS-related written decision and explanation.

### C05. Experience or Manager waiver

**Version 1.0 – effective 1 October 2026**

Reference: Cleaner spec 5.3.1

Basis: Cleaner spec 5.2–5.3; Cleaner Terms 2.2

- [ ] Record the reference or proof of relevant experience reviewed and the factual outcome.
- [ ] If evidence is waived, record the Manager's explicit decision and reason. An onboarding team member cannot grant the waiver.
- [ ] Record who checked or waived the evidence and when, before the induction invitation stage.

Reviewer notes:

- No new minimum length of experience or number of references is proposed.

### C06. Cleaner insurance

**Version 1.0 – effective 1 October 2026**

Reference: Cleaner Terms 16.1; Safeguarding Policy 4.1

Basis: Cleaner Terms 16.1; Safeguarding Policy 4.1

- [ ] Review the cleaner's own public liability insurance certificate and confirm that it covers the person/business and the cleaning work offered.
- [ ] Confirm cover of at least £1,000,000 for any one claim, as required by Cleaner Terms 16.1.
- [ ] Record the insurer/policy reference where needed, expiry date and reviewer. Check it is current before activation and require renewed proof when the policy renews.
- [ ] Flag cancellation, changed cover or a lapse for the existing service-approval/suspension process. The business's insurance does not replace the cleaner's own cover.

Reviewer notes:

- This approves no property maintenance service. Any additional role keeps its own insurance and approval requirements.

### C07. Induction and assessment

**Version 1.0 – effective 1 October 2026**

Reference: Cleaner spec 5.5; Process 3.19A and 3.21–3.21C

Basis: Cleaner spec 2.2 and 5.5; Cleaner Assessment Content Pack 1 and 4; Safeguarding Policy 12.1

- [ ] Confirm identity, right-to-work, DBS decision and experience checks are recorded before issuing the personal limited induction/assessment access.
- [ ] Record attendance at the live induction. The host opens assessment access only for the arranged session; it provides no job access.
- [ ] Set any approved individual double/triple-time adjustment before the attempt and record only adjustment granted.
- [ ] Require the supplied unticked rules acknowledgement. Keep the server-marked 12-of-15 Part A rule, the supplied selection/timers and the private answer key. Staff cannot type or change a score.
- [ ] Record the human writing decision and one-line reason. A writing not-passed decision requires Manager confirmation before the applicant is told.
- [ ] Use the supplied failure and human-review wording. Show the host a failure flag so they can remove the person from Meet manually; no Meet-removal integration is assumed. Only the Manager may reopen once, with a reason.

Reviewer notes:

- The approved assessment content and failure email are not replaced by these checklist drafts. Do not put the marking key into a report, email, client bundle or staff checklist.

### C08. Acceptances, emergency contact and payout setup

**Version 1.0 – effective 1 October 2026**

Reference: Cleaner spec 5.3–5.4

Basis: Cleaner spec 2.2, 4.1 and 5.3–5.4; Cleaner Terms 17; Safeguarding Policy 4.3; Privacy Policy 6.3 and 6.6; Existing owner instruction: optional UTR and business name must not block registration

- [ ] Upgrade to full account setup only after the assessment has passed. Keep the same person's existing account/roles where applicable, rather than creating a duplicate identity.
- [ ] Obtain the required Cleaner Terms, Cleaner Cancellation Policy, Privacy Notice, Safeguarding Policy and DBS-recording acknowledgements after assessment, using the approved wording and unticked boxes.
- [ ] Save the exact wording and boxes ticked, document versions, UTC time and IP in uneditable acceptance evidence; retain the accepted PDFs and apply the contract-end retention rule.
- [ ] Record the required emergency contact's name, relationship and phone number, and explain its safeguarding purpose. Keep it private and remind the cleaner to keep it current.
- [ ] Confirm the cleaner's own Stripe payout account is set up and verified. Bank details remain with Stripe; do not ask for online banking passwords or PINs.
- [ ] Check the necessary contact/profile details and payout-schedule choice. Do not make optional UTR or business-name fields mandatory by inventing a new onboarding requirement.
- [ ] Send the account setup/welcome email only through its approved workflow, attaching the exact document versions accepted. Keep the account unavailable for new offers until independent activation.

Reviewer notes:

- This draft changes neither accepted legal documents nor payment calculations.

### C09. Independent final sign-off

**Version 1.0 – effective 1 October 2026**

Reference: Cleaner spec 5.3.1; existing independent-sign-off controls

Basis: Cleaner spec 2, 3 and 5.3; Cleaner Terms 2 and 16.1; Safeguarding Policy 4.1

- [ ] Recheck recorded identity and current right-to-work/self-employment permission, including expiry or verified no-expiry status.
- [ ] Confirm the basic DBS decision, any necessary Manager decision, experience evidence or permitted Manager waiver, and current cleaner insurance are complete.
- [ ] Confirm induction attendance, automatic Part A pass, human writing pass, required post-assessment acceptances, emergency contact and verified Stripe payout setup.
- [ ] Use the existing independent second-reviewer rule. The person who invited, onboarded, checked evidence or performed the first review cannot activate their own case, including when they are a Manager.
- [ ] Record the independent decision, reviewer and time. Activate only when every required gate is satisfied; if a required check later becomes invalid, stop new offers and flag accepted work under the published rules.

Reviewer notes:

- No approval, waiver or Active status is created by viewing or copying this draft checklist.

### C10. Escalation, decision and rejection record

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 3.9 and 3.14

Basis: Cleaner spec 5.2 and 7.3–7.4; DBS Policy 6–8; Privacy Policy 6.11 and 13

- [ ] Record the stage, a factual reason and the referring staff member/time; lock the file for Manager review using the existing restricted workflow.
- [ ] Limit evidence to staff authorised for that data. Keep DBS/offence information in the private record, not in the general note or escalation email.
- [ ] Consider the relevant evidence and the applicant's explanation. A DBS-related decision is made by the Manager and never on a conviction alone. Assessment decisions retain their supplied automatic-marking and human-review safeguards.
- [ ] Record the Manager decision and reason. Use the approved message for its decision type: general rejection, secure DBS-related decision, or the unchanged assessment-failure message.
- [ ] For an unsuccessful application, record the decision date and six-month retention timer. Preserve anything needed for an unresolved case. Resolve the escalation only after its decision/follow-up are recorded; do not clear an independent legal hold automatically.

Reviewer notes:

- Manager review cannot waive identity, right to work, required insurance, assessment, required acceptances or independence. Only the experience waiver specified in the build specification is proposed here.

### C11. First completed booking follow-up

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 4.1

Basis: Cleaner spec 7.2; Cleaner Terms 6, 9 and 16.2; Safeguarding Policy 8–10

- [ ] Contact the cleaner within 24 hours of their first completed booking and record who contacted them and when.
- [ ] Ask whether they are safe and whether any incident, access difficulty, damage or safeguarding concern needs action. Follow the published urgent reporting procedure where relevant.
- [ ] Review completion of the job checklist, required result photos and check-in/check-out record. Clarify a missing record without inventing a new penalty.
- [ ] Record any platform-use, scope or pay-record question and any support or action agreed. If products were requested, record any issue about whether they were actually supplied; do not change pay from this checklist.
- [ ] Link an incident/complaint to the proper restricted case and retention protection; record the next action and responsible staff member.

Reviewer notes:

- Do not copy customer addresses, contact details or access codes into the follow-up email.

### C12. Fifth completed booking review

**Version 1.0 – effective 1 October 2026**

Reference: Onboarding Process 4.2

Basis: Cleaner spec 7.2; Cleaner Terms 6 and 19; Safeguarding Policy 10.5

- [ ] Confirm this is the fifth completed booking and record the review milestone once.
- [ ] Review relevant feedback, job records, attendance, cancellations/no-shows, support requests and open concerns. Give the cleaner the opportunity to explain relevant issues.
- [ ] Check that required identity/right-to-work/DBS decisions and cleaner insurance remain current and that any required follow-up is assigned.
- [ ] Record the reviewer, date, factual outcome and agreed support/follow-up. Use the existing Manager and published suspension process for a possible restriction; add no new automatic rating threshold or penalty.

Reviewer notes:

- No extra probation period, minimum score or new financial consequence is proposed.

## Existing wording kept unchanged

### Assessment not-passed email

Reference: Onboarding Process 9.6 / Content Pack 4.2–4.3

The supplied subject, failure wording, 14-day human-review wording and three-month reapplication wording remain exact and unchanged. The private marking key is not part of this pack.

### Password reset and current account/security messages

Reference: Cleaner spec 8

No missing HR wording is identified for these existing flows. Their secure links and authenticator requirements are unchanged.

### Current welcome and insurance reminders

Reference: Cleaner spec 7.2 and 8

Current delivery is unchanged. E10 is a separate proposal for the new Stage 2 order; review the annual/three-year DBS timing note before changing reminder integration.
