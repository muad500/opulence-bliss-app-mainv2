-- READ ONLY. Run in the dashboard for STAGING comwdjprdedmsnxtvuuk only.
-- Reports metadata and hashes, never credentials, addresses or policy bodies.
-- Does not run jobs, send emails, create bookings or change the migration ledger.
-- Missing tables/extensions cause an error: stop and inspect the installation.
with expected(version, source_md5) as (values
  ('20261021000200', 'ce765e0f5a6958db6f51814d8e1dfe8c'),
  ('20261021000300', 'c1570056a75448e3cab0ae91a85298ff'),
  ('20261023000100', '36ff2804fe113458858859bca246845e'),
  ('20261023000200', '59a258ac8fa170f024b9064c42956948')
), ledger as (
  select e.version,
    case when m.version is null then 'not applied'
      when md5(array_to_string(m.statements, E'\n')) = e.source_md5 then 'exact source match'
      else 'inspect source mismatch before any write' end as source_status,
    md5(array_to_string(m.statements, E'\n')) as recorded_source_md5,
    cardinality(m.statements) as statement_count
  from expected e left join supabase_migrations.schema_migrations m using (version)
), jobs as (
  select jobname, schedule, active from cron.job
  where jobname='opulence-booking-notifications'
), vault_presence as (
  select wanted.name, exists(select 1 from vault.secrets s where s.name=wanted.name) as configured
  from (values ('opulence_cron_secret'), ('opulence_app_origin'),
    ('opulence_staging_vercel_bypass')) wanted(name)
)
select jsonb_build_object(
  'migration_ledger', (select jsonb_agg(to_jsonb(l) order by version) from ledger l),
  'latest_recorded_migration', (select max(version) from supabase_migrations.schema_migrations),
  'evidence_writer_installed', to_regprocedure('public.prepare_booking_legal_consent_v2(uuid,jsonb,jsonb,jsonb,jsonb)') is not null,
  'contract_reader_installed', to_regprocedure('public.booking_legal_contract(uuid)') is not null,
  'published_legal_versions', (select jsonb_agg(jsonb_build_object(
    'slug',slug,'version',version,'updated_at',updated_at,'has_content',nullif(content_html,'') is not null) order by slug)
    from public.legal_documents where published and slug in ('terms','privacy','cancellation-refund')),
  'booking_email_jobs', coalesce((select jsonb_agg(to_jsonb(j)) from jobs j),'[]'::jsonb),
  'scheduler_handles_preview_protection', coalesce(position('x-vercel-protection-bypass' in
    pg_get_functiondef(to_regprocedure('public.invoke_booking_notification_cron()'))) > 0,false),
  'vault_configuration_present', (select jsonb_agg(to_jsonb(v) order by name) from vault_presence v),
  'scheduler_origin_is_staging', exists(select 1 from vault.decrypted_secrets
    where name='opulence_app_origin' and decrypted_secret ~
      '^https://opulence-bliss-app-mainv2-git-codex-[a-z0-9-]+-muad500s-projects[.]vercel[.]app/?$')
) as staging_preflight;
