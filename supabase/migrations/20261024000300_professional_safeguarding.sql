-- Exact supplied safeguarding policy. Source PDF SHA-256:
-- 36f9a39e473cb01fc7dfd587810affa68782708f03b3e063c70f04bd659f85e3
begin;
alter table public.legal_documents drop constraint if exists legal_documents_slug_check;
alter table public.legal_documents add constraint legal_documents_slug_check check (
  slug in ('terms','privacy','cancellation-refund','handyman-terms','review-policy','professional-partner-agreement','safeguarding')
);
insert into public.legal_documents(slug,title,audience,content_html,version,published)
values('safeguarding','Safeguarding, Lone Working and Incident Reporting Policy','professionals',$safeguarding$<p><strong>For cleaners and handymen | Opulence Bliss Ltd | Version 1.0 | Effective from: 1 October 2026</strong></p>
<p>This policy sets out how we keep customers, and the cleaners and handymen who work in their homes, safe. It forms part of the Cleaner Terms and Conditions and the Handyman Terms and Conditions. In this policy &quot;you&quot; means a cleaner or handyman working through our platform.</p>
<h2>1. Why this policy matters</h2>
<p>1.1  You work alone, inside people&#x27;s homes and businesses. That brings two kinds of risk: risk to your own safety, and risk to customers who may be vulnerable, such as older people, disabled people, people who are unwell and children.</p>
<p>1.2  We take both seriously. This policy tells you what to expect from us, what we expect from you, and exactly what to do when something goes wrong.</p>
<p>1.3  If anyone is in immediate danger, call 999 first. Then tell us.</p>
<h2>2. Who is responsible</h2>
<p>2.1  Our Safeguarding Lead is the owner of Opulence Bliss Ltd. They receive all safeguarding concerns and incident reports, decide what happens next, and keep the records. Contact: hello@opulencebliss.com or +44 7484 717935.</p>
<p>2.2  Our onboarding team explains this policy to every new cleaner and handyman and keeps records of who has been briefed.</p>
<p>2.3  Everyone who works through the platform is responsible for following this policy and for reporting concerns. You are not expected to investigate or to decide whether something is abuse. Your job is to notice, to keep people safe, and to tell us.</p>
<h2>3. Who we mean by vulnerable</h2>
<p>3.1  A child is anyone under 18.</p>
<p>3.2  An adult at risk is an adult who needs care and support, and who is experiencing, or is at risk of, abuse or neglect, and is unable to protect themselves because of those needs. This can include people with dementia, a physical or learning disability, a mental health condition, or frailty, and people who are isolated.</p>
<p>3.3  Vulnerability can be temporary, for example after an illness or bereavement. Treat everyone with respect, and take extra care where you notice signs that someone may need extra help.</p>
<p>3.4  We do not ask customers about health conditions when they book. If a customer tells us, or you notice, we may note only what is needed to keep them safe, such as &quot;needs extra time at the door&quot; or &quot;hard of hearing&quot;.</p>
<h2>4. Before a booking</h2>
<p>4.1  Every cleaner and handyman has been through our checks: identity, right to work, a basic DBS certificate and insurance. A basic DBS check does not cover everything, so it does not replace your own vigilance.</p>
<p>4.2  If a customer tells us before a booking that they are vulnerable or live with someone who is, we will, where we can send the same cleaner or handyman each time, and tell you any practical needs.</p>
<p>4.3  You must give us an emergency contact when you register, and keep it up to date.</p>
<p>4.4  You will receive the address, date, time and any access or safety notes through the platform. Do not accept a booking if you do not feel safe doing so.</p>
<h2>5. Working with vulnerable customers</h2>
<p>5.1  Always treat the customer with dignity and respect. Speak clearly and calmly, use their name, and give them time to answer.</p>
<p>5.2  You are there to clean or to do repair work. Do not provide personal care , such as washing, dressing, toileting, feeding or giving medicines, and do not give medical advice. If a customer asks for this, politely decline and tell us.</p>
<p>5.3 Do not take, handle or hold money, bank cards, PINs, cheque books or valuables. Do not accept gifts of value, loans or any request to be added to a will or given power of attorney. Do not offer or ask for personal favour. Tell us if anyone asks you to do any of these things.</p>
<p>5.4  Do not take photographs of the customer, of other people in the home or of their personal belongings. Photograph the work only, where the terms allow, and keep other people out of the picture.</p>
<p>5.5  Where children are present, you must never be alone with a child, never provide childcare, and never be in a child&#x27;s bedroom or bathroom while they are in it. Keep to the areas you have been asked to work in.</p>
<p>5.6  Do not share a customer&#x27;s personal details, health or circumstances with anyone except us, or the emergency services if needed.</p>
<p>5.7  Respect a customer&#x27;s choices. Do not move or touch medication, medical equipment, mobility aids or documents unless the customer asks and it is safe.</p>
<p>5.8  If a customer seems confused, distressed or unwell, stay calm. If they need urgent medical help, call 999 . Then tell us.</p>
<h2>6. What to look for and what to do</h2>
<p>6.1  Signs that a customer may be at risk include: • unexplained injuries, bruises or marks, or poor hygiene and neglect; • being very afraid of, or controlled by, another person; • missing money or belongings, or sudden changes to their finances; • no food, heating or care, or unsafe living conditions; • being locked in, or not allowed to speak for themselves; • a child who seems fearful, hungry, unsupervised or injured, or who tells you something worrying.</p>
<p>6.2  If you see something that worries you: • Immediate danger: call 999. • Otherwise, tell the Safeguarding Lead the same day, and as soon as you safely can. Use the platform or call +44 7484 717935. • Write down what you saw or heard, with the date, time and place. Record facts and the person&#x27;s own words, not your opinions. • Do not confront anyone, investigate, promise to keep a secret, or tell other people. If someone tells you something serious, listen, stay calm, say you are glad they told you, and explain that you must pass it on to keep them safe.</p>
<p>6.3  We will decide what to do, which may include contacting the local authority adult safeguarding team or children&#x27;s services, the police, or the customer&#x27;s family or doctor, depending on the situation. We will tell you what we need from you. You will not be punished for raising a concern in good faith, even if it turns out to be mistaken.</p>
<p>6.4  Helpful national numbers: NSPCC helpline 0808 800 5000 (children); Action on Elder Abuse 080 8808 8141. The local authority safeguarding team for the customer&#x27;s borough can also be contacted.</p>
<h2>7. Concerns about a cleaner or handyman</h2>
<p>7.1  If a customer or anyone else raises a concern about a cleaner or handyman, we take it seriously and act promptly.</p>
<p>7.2  We may suspend the person from bookings while we look into it, which is not a finding that they did anything wrong. We will tell them what is being said, give them the chance to respond, and decide fairly.</p>
<p>7.3  Where the concern involves a possible crime or serious risk, we will tell the police or the right authority. Where needed, we will also tell the person&#x27;s customers.</p>
<p>7.4  If you have a concern about how we or another cleaner or handyman is working, tell us. If you feel you cannot, you can contact the relevant local authority or the police.</p>
<h2>8. Lone working: staying safe</h2>
<p>8.1 Before you go. Check the booking details and any notes. Make sure your phone is charged and has the platform open. Tell us if you are running late.</p>
<p>8.2 Check in and out. Check in on the platform when you arrive and check out when you leave. If your plans change, tell us.</p>
<p>8.3 At the door. Trust your instincts. Do not go in if the customer seems drunk, aggressive or unsafe, if someone else at the property makes you uneasy, or if the situation is not as the booking said. You can leave at any time, and you will not be penalised. Tell us straight away.</p>
<p>8.4 While you work. Know where the exits are and keep your route to the door clear. Keep your phone, keys and valuables with you. Do not let anyone stand between you and the exit. Do not work in a locked room, and do not go into areas you are not asked to work in. Handymen must follow safe-working rules for ladders, tools, electricity, gas and water, and must not work at height beyond their training.</p>
<p>8.5 Pets and hazards. Ask the customer to secure pets. Report broken fittings, wet floors, mould, pests, needles and other hazards, and stop if you are not safe.</p>
<p>8.6 Behaviour you must not tolerate. Harassment, unwanted touching, sexual comments, threats, discrimination or being asked to do anything that makes you uncomfortable. Leave if you need to and tell us. We will support you and, where appropriate, stop sending cleaners to that customer.</p>
<p>8.7 Never put yourself at risk to protect property. Your safety comes first.</p>
<h2>9. Our check-in procedure</h2>
<p>9.1  We monitor check-ins during our operating hours (7am -8pm). If you do not check in within 30 minutes of the booking start time and we cannot reach you, we will: • phone and message you; • if there is no answer within 15 minutes, phone your emergency contact; and • If there is still no answer and we are worried, ask the police to carry out a welfare check at the booking address.</p>
<p>9.2  If you cannot use the platform, tell us another way, by phone or email, and we will log it.</p>
<h2>10. Reporting incidents</h2>
<p>10.1  Report to us any of the following, however small: • an injury or illness at work, or a near miss; • a threat, harassment, abuse or assault, towards you or anyone else; • damage to property or an allegation of theft; • a safeguarding concern (section 6); • a data incident, such as a lost key or access code, or personal information sent to the wrong person; and • a vehicle accident or anything else that affected your work.</p>
<p>10.2 How and when. For anything urgent, call +44 7484 717935. Otherwise report through the platform or by email to hello@opulencebliss.com. Report immediately if someone is hurt or in danger, the same day for safeguarding concerns and threats, and within 24 hours for everything else.</p>
<p>10.3 What to tell us. What happened, when and where, who was involved, any injuries or damage, what you did, and whether anyone else saw it. Add photos if it is safe and appropriate.</p>
<p>10.4 What we do. We will contact you within 24 hours (the same day for serious incidents). We will check you are safe, offer support, record the incident, decide on any action, and tell you the outcome where we can. We may need to tell our insurer, the police, the local authority, the Health and Safety Executive (including under RIDDOR where it applies), or the ICO within 72 hours for a personal data breach.</p>
<p>10.5  We keep an incident log and review it at least every 6 months to find ways to make things safer.</p>
<h2>11. Records, confidentiality and data protection</h2>
<p>11.1  We keep safeguarding and incident records securely. Only the Safeguarding Lead and people who need them can see them. We share information only when we have to, to keep someone safe, or where the law requires or allows it. We do not promise absolute confidentiality when someone may be at risk.</p>
<p>11.2  We keep these records for 6 years, or longer where the law, a court or an authority requires. Records about a child are kept for longer where guidance says they should be.</p>
<p>11.3  We use this information under UK GDPR, relying on our legal duties, our legitimate interests in keeping people safe, and, where needed, the safeguarding conditions in Schedule 1 of the Data Protection Act 2018. See our Privacy Notice for more.</p>
<h2>12. Training and review</h2>
<p>12.1  Our onboarding team goes through this policy with every new cleaner and handyman, and you must confirm in writing (a tick box in the platform) that you have read it. We repeat a short refresher at least once a year.</p>
<p>12.2  We review this policy at least once a year and after any serious incident, or when the law changes.</p>
<h2>13. Quick reference</h2>
<p>• Immediate danger: call 999, then tell us. • Worried about a customer: tell the Safeguarding Lead the same day. Write down facts. Do not investigate or promise secrecy. • Feeling unsafe at a booking: leave and tell us. You will not be penalised. • Running late or cannot check in: tell us. • Any incident: report it within 24 hours, and the same day for threats or safeguarding.</p>
<h2>14. Contact us</h2>
<p>Opulence Bliss Ltd 128 City Road, London, United Kingdom, EC1V 2NX Company number: 15894675 Telephone: +44 7484 717935 Email: hello@opulencebliss.com</p>$safeguarding$,'1.0',true)
on conflict(slug) do nothing;

-- Existing professionals are not retrospectively asked to re-register. New
-- applicants cannot be approved by bypassing the website registration form.
alter table public.providers add column safeguarding_required boolean not null default false;
alter table public.providers alter column safeguarding_required set default true;
create or replace function public.require_professional_safeguarding()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op='INSERT' then
    new.safeguarding_required:=true;
  elsif new.safeguarding_required is distinct from old.safeguarding_required then
    raise exception 'The safeguarding registration requirement cannot be removed' using errcode='check_violation';
  end if;
  if new.safeguarding_required and (
    new.vetting_status::text='approved' or coalesce(new.service_approvals->>'cleaning','')='approved'
    or coalesce(new.service_approvals->>'handyman','')='approved'
  ) and not exists (
    select 1 from public.account_legal_acceptances
    where user_id=new.profile_id and document_slug='safeguarding'
  ) then
    raise exception 'The professional must accept the safeguarding policy before approval' using errcode='check_violation';
  end if;
  return new;
end
$fn$;
revoke all on function public.require_professional_safeguarding() from public,anon,authenticated;
create trigger require_professional_safeguarding before insert or update of vetting_status,service_approvals,safeguarding_required
on public.providers for each row execute function public.require_professional_safeguarding();
commit;
