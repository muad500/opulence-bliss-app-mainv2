// Compose exact current icons and real staging captures; never fabricate UI.
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../mobile/store-assets/", import.meta.url);
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const svg = (w, h, body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#281342"/><stop offset="1" stop-color="#6d28d9"/></linearGradient><linearGradient id="accent"><stop stop-color="#f5c542"/><stop offset=".5" stop-color="#c86fc9"/><stop offset="1" stop-color="#7b2ff7"/></linearGradient></defs>${body}</svg>`,
  );
const apps = {
  customer: {
    name: "Opulence Bliss",
    icon: "app-512.png",
    title: ["Your home,", "looked after."],
    subtitle: "Cleaning &amp; property maintenance",
    screens: [
      ["customer-home", "A little more time for you", "/mobile/customer"],
      ["customer-services", "Find your cleaning session", "/services/cleaning"],
      ["customer-session", "Choose the clean you need", "/book?type=clean"],
      ["customer-frequency", "Make it fit your routine", "/book?type=clean"],
    ],
  },
  professional: {
    name: "Opulence Bliss Pro",
    icon: "pro-512.png",
    title: ["Your workday,", "in one place."],
    subtitle: "Jobs, availability, messages &amp; earnings",
    screens: [
      ["pro-today", "Your day at a glance", "/worker"],
      ["pro-availability", "Set your availability", "/worker/availability"],
      ["pro-earnings", "Keep track of earnings", "/worker/earnings"],
      ["pro-inbox", "Keep booking chats together", "/mobile/worker/inbox"],
    ],
  },
};
const manifest = {
  capturedAt: "2026-10-22",
  origin:
    "https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app",
  data: "Synthetic staging accounts only. Alex (Demo) / Sam (Demo). No production access.",
  source:
    "Real in-app browser phone viewport captures, 412 × 824 CSS pixels. No UI has been generated or retouched.",
  files: [],
};
for (const [audience, app] of Object.entries(apps)) {
  const dir = new URL(audience + "/", root);
  await mkdir(dir, { recursive: true });
  const icon = await sharp(
    await readFile(new URL("../public/icons/" + app.icon, import.meta.url)),
  )
    .resize(512, 512)
    .flatten({ background: audience === "customer" ? "#6d28d9" : "#16202a" })
    .png()
    .toBuffer();
  await writeFile(new URL("icon-512.png", dir), icon);
  const art = svg(
    1024,
    500,
    `<rect width="1024" height="500" fill="url(#bg)"/><circle cx="950" cy="80" r="290" fill="#c86fc9" opacity=".14"/><rect x="64" y="66" width="64" height="7" rx="3" fill="url(#accent)"/><text x="64" y="119" fill="#f2eafa" font-family="Arial,sans-serif" font-size="25" font-weight="700">${app.name}</text><text x="60" y="220" fill="white" font-family="Arial,sans-serif" font-size="62" font-weight="700">${app.title[0]}</text><text x="60" y="291" fill="white" font-family="Arial,sans-serif" font-size="62" font-weight="700">${app.title[1]}</text><text x="64" y="369" fill="#e6d8f8" font-family="Arial,sans-serif" font-size="22">${app.subtitle}</text><rect x="64" y="419" width="220" height="6" rx="3" fill="url(#accent)"/>`,
  );
  await sharp(art)
    .composite([
      {
        input: await sharp(icon).resize(260, 260).toBuffer(),
        left: 704,
        top: 120,
      },
    ])
    .png()
    .toFile(new URL("feature-1024x500.png", dir).pathname);
  let index = 0;
  for (const [source, caption, path] of app.screens) {
    index++;
    const raw = await readFile(new URL("source/" + source + ".jpg", root));
    const canvas = svg(
      1080,
      1920,
      `<rect width="1080" height="1920" fill="#faf8ff"/><rect x="0" y="0" width="1080" height="270" fill="url(#bg)"/><text x="64" y="79" font-family="Arial,sans-serif" font-size="30" fill="#e6d8f8" font-weight="700">${app.name}</text><text x="64" y="156" font-family="Arial,sans-serif" font-size="50" fill="white" font-weight="700">${esc(caption)}</text><rect x="130" y="294" width="820" height="1576" rx="24" fill="#16202a"/>`,
    );
    const capture = await sharp(raw)
      .resize(796, 1552, { fit: "contain", background: "#ffffff" })
      .png()
      .toBuffer();
    const file = `${String(index).padStart(2, "0")}-${source}.png`;
    await sharp(canvas)
      .composite([{ input: capture, left: 142, top: 306 }])
      .png()
      .toFile(new URL(file, dir).pathname);
    manifest.files.push({
      audience,
      file: `${audience}/${file}`,
      source: `source/${source}.jpg`,
      path,
      caption,
      sha256: createHash("sha256").update(raw).digest("hex"),
    });
  }
}
await sharp(
  svg(96, 96, '<path d="M16 43L48 16l32 27v39H58V57H38v25H16z" fill="white"/>'),
)
  .png()
  .toFile(new URL("../public/icons/push-badge.png", import.meta.url).pathname);
await writeFile(
  new URL("manifest.json", root),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "Built 2 icons, 2 feature graphics, 8 captioned real staging screenshots and a monochrome push badge.",
);
