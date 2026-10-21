import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
const root = new URL("../mobile/store-assets/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", root), "utf8"),
);
for (const audience of ["customer", "professional"])
  test(`${audience} store assets have exact Play dimensions and 4 real capture sources`, async () => {
    const files = await readdir(new URL(audience + "/", root));
    const screenshots = files.filter((x) => /^\d\d-.*\.png$/.test(x));
    assert.equal(screenshots.length, 4);
    for (const [file, w, h] of [
      ["icon-512.png", 512, 512],
      ["feature-1024x500.png", 1024, 500],
      ...screenshots.map((x) => [x, 1080, 1920]),
    ]) {
      const m = await sharp(
        await readFile(new URL(audience + "/" + file, root)),
      ).metadata();
      assert.equal(m.width, w);
      assert.equal(m.height, h);
      assert.equal(m.format, "png");
    }
    for (const entry of manifest.files.filter((x) => x.audience === audience)) {
      const data = await readFile(new URL(entry.source, root));
      assert.equal(
        createHash("sha256").update(data).digest("hex"),
        entry.sha256,
      );
      assert.match(entry.path, /^\//);
      assert.ok(!/token|bypass|secret|email/i.test(entry.path));
    }
  });
