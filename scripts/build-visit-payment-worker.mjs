import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { format } from "prettier";

const root = process.cwd();
const directory = "supabase/functions/visit-payments";
const output = `${directory}/index.ts`;
const manifestPath = `${directory}/source-manifest.json`;
const stripeVersion = JSON.parse(
  readFileSync("node_modules/stripe/package.json"),
).version;
const supabaseVersion = JSON.parse(
  readFileSync("node_modules/@supabase/supabase-js/package.json"),
).version;
const hash = (value) =>
  createHash("sha256")
    .update(value.toString().replace(/\r\n/g, "\n"))
    .digest("hex");
const external = {
  stripe: `npm:stripe@${stripeVersion}`,
  "@supabase/supabase-js": `npm:@supabase/supabase-js@${supabaseVersion}`,
};
const options = {
  entryPoints: [`${directory}/handler.ts`],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: false,
  metafile: true,
  outfile: output,
  plugins: [
    {
      name: "edge-runtime-imports",
      setup(builder) {
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "marker",
        }));
        builder.onLoad({ filter: /.*/, namespace: "marker" }, () => ({
          contents: "",
          loader: "js",
        }));
        builder.onResolve(
          { filter: /^(stripe|@supabase\/supabase-js)$/ },
          ({ path }) => ({ path: external[path], external: true }),
        );
        builder.onResolve({ filter: /^node:/ }, ({ path }) => ({
          path,
          external: true,
        }));
      },
    },
  ],
  define: { __VISIT_WORKER_SOURCE_SHA__: '"pending"' },
};
const initial = await build(options);
const inputs = Object.keys(initial.metafile.inputs)
  .filter((path) => !path.startsWith("marker:"))
  .sort()
  .map((path) => ({
    path: relative(root, resolve(path)).replaceAll("\\", "/"),
    sha256: hash(readFileSync(path)),
  }));
const manifest = {
  generator: "scripts/build-visit-payment-worker.mjs",
  generatorSha256: hash(readFileSync("scripts/build-visit-payment-worker.mjs")),
  stripeVersion,
  supabaseVersion,
  inputs,
};
const sourceSha256 = hash(JSON.stringify(manifest));
const result = await build({
  ...options,
  define: { __VISIT_WORKER_SOURCE_SHA__: JSON.stringify(sourceSha256) },
});
const contents = await format(
  "// Generated from the shared billing engine. Run npm run build:visit-worker.\n" +
    result.outputFiles[0].text,
  { parser: "typescript" },
);
const serialized =
  JSON.stringify({ sourceSha256, ...manifest }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (
    readFileSync(output, "utf8").replace(/\r\n/g, "\n") !== contents ||
    readFileSync(manifestPath, "utf8").replace(/\r\n/g, "\n") !== serialized
  )
    throw new Error(
      "The deployed worker source is stale. Run npm run build:visit-worker.",
    );
} else {
  writeFileSync(output, contents);
  writeFileSync(manifestPath, serialized);
}
console.log(
  JSON.stringify({
    output,
    sourceSha256,
    inputFiles: inputs.length,
    checked: process.argv.includes("--check"),
  }),
);
