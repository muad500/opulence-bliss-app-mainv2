# Footer social links

- Staff can edit the Facebook, Instagram, TikTok and Nextdoor page URLs in **Admin → Settings → Footer social links**.
- Use full HTTPS links on the platform's official domain. Saving updates that environment's footer without a rebuild.
- Blank Facebook, Instagram or TikTok links hide the corresponding icon. Nextdoor remains a non-clickable icon placeholder until its URL is entered.
- The website footer shows icons only, under “Across London”. Accessible names and tooltips identify each icon.
- Production and staging use separate `site_social_links` tables. Install migration `20261019000100_footer_social_links.sql` in each environment; do not copy other settings or credentials between them.
- Public access can read only platform names and URLs. Changes go through the existing same-origin, admin-authenticated API.

Validation: `npm test`, `npx tsc --noEmit`, changed-file lint, mobile/desktop footer inspection, and database grants checks.
