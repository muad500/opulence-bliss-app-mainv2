begin;

create table public.site_social_links (
  platform text primary key check (platform in ('facebook', 'instagram', 'tiktok', 'nextdoor')),
  url text check (url is null or (length(url) <= 2048 and url ~ '^https://')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.site_social_links (platform, url) values
  ('facebook', 'https://www.facebook.com/opulencebliss'),
  ('instagram', 'https://www.instagram.com/opulencebliss/'),
  ('tiktok', 'https://www.tiktok.com/@opulencebliss'),
  ('nextdoor', null);

alter table public.site_social_links enable row level security;
revoke all on public.site_social_links from public, anon, authenticated;
grant select (platform, url) on public.site_social_links to anon, authenticated;
grant select, insert, update on public.site_social_links to service_role;
create policy "Public social page URLs" on public.site_social_links for select to anon, authenticated using (true);

comment on table public.site_social_links is 'Public footer social URLs. Only authenticated admin API requests may edit; blank URLs hide the icon.';
commit;
