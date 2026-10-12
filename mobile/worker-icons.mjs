import sharp from "sharp";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
const svg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="110" fill="#16202a"/><text x="256" y="294" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="215" letter-spacing="-18" fill="#fff">ob</text><circle cx="374" cy="121" r="17" fill="#c86fc9"/><rect x="155" y="342" width="202" height="64" rx="24" fill="#6d28d9"/><text x="256" y="388" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="42" letter-spacing="5" fill="#fff">PRO</text></svg>`,
);
await writeFile(new URL("../public/icons/pro-icon.svg", import.meta.url), svg);
for (const [name, size] of [
  ["pro-192.png", 192],
  ["pro-512.png", 512],
  ["pro-maskable-512.png", 512],
])
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(
      new URL("../public/icons/" + name, import.meta.url).pathname.replace(
        /^\/(\w:)/,
        "$1",
      ),
    );
const main = new URL("./android/app/src/main/res/", import.meta.url);
for (const directory of await readdir(main)) {
  if (!directory.startsWith("mipmap-") || directory.includes("anydpi"))
    continue;
  for (const name of ["ic_launcher.png", "ic_maskable.png"]) {
    let metadata;
    try {
      metadata = await sharp(
        await readFile(new URL(directory + "/" + name, main)),
      ).metadata();
    } catch {
      continue;
    }
    const target = new URL(
      `./android/app/src/worker/res/${directory}/`,
      import.meta.url,
    );
    await mkdir(target, { recursive: true });
    await writeFile(
      new URL(name, target),
      await sharp(svg).resize(metadata.width, metadata.height).png().toBuffer(),
    );
  }
}
