# Android store artwork — review set

Both apps include a 512×512 PNG icon, 1024×500 PNG feature graphic and four
1080×1920 PNG phone screenshots with short captions. `customer/` is Opulence
Bliss; `professional/` is Opulence Bliss Pro. These use the current exact site
icons, pending the client's high-resolution logo. Nothing is uploaded to Play.

`source/` contains **real staging browser screenshots**, captured at a phone
viewport on 22 October 2026. They are not generated/mock app interfaces and are
not photographs of an Android device. The framing adds only branding, a caption
without a "Demo account · Test data" label; the captured UI remains unchanged.
Screens use synthetic private QA accounts and fictional fixtures. The refreshed
Pro workday has scheduled visits, a normal working week and a populated inbox.
Earnings use explicitly marked **database-only staging artwork fixtures**; no
real charge or transfer was made to create the screenshots. Those fixtures must
not be treated as Stripe end-to-end payment test evidence.
There are no real customer names, emails, addresses, private keys or tokens.
The conversation was sent through the real staging booking-chat function between
the two synthetic accounts, not painted onto a screenshot.

`manifest.json` records source paths, screen routes and SHA-256 hashes. The
origin is the protected feature-branch staging Preview, never the live production site. Auth
confirmation URLs and deployment-protection secrets are deliberately excluded.
Rebuild the PNG exports from these captures with:

```
node scripts/build-store-assets.mjs
```

The Play account owner should review the current logo, copy and screenshots
before upload and replace the logo once the client supplies it. Do not caption
or advertise Apple push, offline bookings or features not shown in the app.
