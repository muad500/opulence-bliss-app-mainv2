-- Owner-approved factual payment/rescheduling corrections ONLY. Cancellation
-- charge bands, basis, access clauses and all other pack wording stay unchanged.
-- The existing revision trigger archives the old content/version before update.
begin;
do $migration$
declare r record; v_html text;
begin
  for r in select slug,version,content_html from public.legal_documents where slug in ('terms','cancellation-refund') for update loop
    v_html:=r.content_html;
    if r.slug='terms' then
      v_html:=replace(v_html,'<p>At present, Opulence Bliss Ltd accepts payment by bank transfer only.</p>','<p>Website cleaning bookings are paid securely by card through Stripe. One-off visits are charged when booked. For regular visits, your card is saved securely with nothing charged at setup; each visit is charged once a cleaner accepts it. If no cleaner accepts, an unpaid visit is not charged and any payment already taken for that visit is refunded in full automatically.</p>');
      v_html:=replace(v_html,'<p>Payment instructions will be provided after your booking has been confirmed or as otherwise agreed.</p>','');
      v_html:=replace(v_html,'<p>Unless otherwise agreed, payment must be received before the scheduled appointment.</p>','');
      v_html:=replace(v_html,'<p>Where possible, we will make reasonable efforts to accommodate requests to reschedule a booking. However, rescheduling cannot be guaranteed and will depend on the availability of an appropriate Service Professional.</p>','<p>Date and time changes for cleaning visits are free up to 24 hours before the visit, subject to availability. Within 24 hours, contact support; the website does not automatically apply a rescheduling fee.</p>');
    else
      v_html:=replace(v_html,'<p>Because we currently accept payment by bank transfer, refunds will normally be made by bank transfer.</p>','<p>Website cleaning payments and refunds use Stripe. One-off visits are charged when booked. Regular visits are charged once a cleaner accepts each visit; card setup itself is free. Refunds return to the original payment method. If no cleaner accepts, any payment already taken for that visit is refunded in full automatically; unpaid visits are not charged.</p>');
      v_html:=replace(v_html,'<p>Customers may be asked to provide the bank details required to process the refund.</p>','');
      v_html:=replace(v_html,'<p>Where a customer provides sufficient notice, we will normally try to reschedule the booking without a cancellation charge.</p>','<p>Date and time changes for cleaning visits are free up to 24 hours before the visit, subject to availability. Within 24 hours, contact support; the website does not automatically apply a rescheduling fee.</p>');
      v_html:=replace(v_html,'<p>Repeated changes or very late requests may be treated as cancellations.</p>','');
    end if;
    if v_html is distinct from r.content_html then
      -- Fail rather than silently clobber a newly published policy pack.
      if (r.slug='terms' and r.version<>'2.0') or (r.slug='cancellation-refund' and r.version<>'1.0') then
        raise exception 'Published policy changed since operational wording review: % %',r.slug,r.version;
      end if;
      v_html:=replace(v_html,'<strong>Version:</strong> '||r.version,'<strong>Version:</strong> '||case when r.slug='terms' then '2.1' else '1.1' end);
      v_html:=regexp_replace(v_html,'(<strong>Last Updated:</strong> )[^<]*','\125 October 2026');
      update public.legal_documents set content_html=v_html,
        version=case when r.slug='terms' then '2.1' else '1.1' end,updated_at=now() where slug=r.slug;
    end if;
  end loop;
end
$migration$;
update public.faqs set answer='Date and time changes are free up to 24 hours before your cleaning visit, subject to availability. Use My bookings to choose an available time. Within 24 hours, contact support; no rescheduling fee is charged automatically.'
where lower(trim(question)) in ('can i reschedule my appointment?','can i change my booking?') and category<>'handyman';
update public.faqs set answer='Website cleaning bookings use secure card payments through Stripe. One-off visits are charged when booked. For regular cleaning, your card is saved with nothing charged at setup; each visit is charged once a cleaner accepts it. If no cleaner accepts, unpaid visits are not charged and any payment taken for that visit is refunded in full automatically.'
where lower(trim(question)) in ('how do i pay?','how can i pay?','when will i be charged?','what payment methods do you accept?') and category<>'handyman';
commit;
