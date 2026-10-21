# Android store artwork — review set

Both apps include a 512×512 PNG icon, 1024×500 PNG feature graphic and four
1080×1920 PNG phone screenshots with short captions. `customer/` is Opulence
Bliss; `professional/` is Opulence Bliss Pro. These use the current exact site
icons, pending the client's high-resolution logo. Nothing is uploaded to Play.

`source/` contains **real staging browser screenshots**, captured at a phone
viewport on 21 October 2026. They are not generated/mock app interfaces and are
not photographs of an Android device. The framing adds only branding, a caption
and a Demo account / Test data label; the captured UI remains unchanged.
Screens use synthetic private QA accounts, demo names and a labelled fictional
address. Pro payment amounts are existing Stripe **test-mode** fixture results.
There are no real customer names, emails, addresses, private keys or tokens.
The blank Pro inbox is an honest empty state, not a fabricated conversation.

`manifest.json` records source paths, screen routes and SHA-256 hashes. The
origin is the protected staging alias, never the live production site. Auth
confirmation URLs and deployment-protection secrets are deliberately excluded.
Rebuild the PNG exports from these captures with:

```
node scripts/build-store-assets.mjs
```

The Play account owner should review the current logo, copy and screenshots
before upload and replace the logo once the client supplies it. Do not caption
or advertise Apple push, offline bookings or features not shown in the app.
