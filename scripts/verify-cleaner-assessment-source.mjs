// Private verification only: output counts/pass-fail, never bank/choice/key data.
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { privateBankHash } from "./cleaner-assessment-pack.mjs";
try {
  const pack = JSON.parse(
    await readFile(
      ".local-secrets/assessment-source/parsed-private-pack.json",
      "utf8",
    ),
  );
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      await readFile("lib/cleanerAssessmentPolicy.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    { module, exports: module.exports },
  );
  const copy = module.exports.CLEANER_ASSESSMENT_COPY;
  const source = pack.copyParagraphs.join("\n");
  const missing = Object.entries(copy)
    .filter(([, value]) =>
      (Array.isArray(value) ? value : [value]).some(
        (part) => !source.includes(part),
      ),
    )
    .map(([key]) => key);
  if (missing.length)
    throw Error(`Non-secret copy differs in fields: ${missing.join(", ")}`);
  const stems = pack.questions
    .map((q) => q.prompt)
    .filter((p) => p.length >= 20);
  let checked = 0;
  async function scan(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(
      () => [],
    )) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (/\.(?:js|jsx|ts|tsx|html|json|txt|map)$/.test(entry.name)) {
        const body = await readFile(file, "utf8");
        if (stems.some((stem) => body.includes(stem)))
          throw Error(
            "Private bank text found outside its private source store.",
          );
        checked++;
      }
    }
  }
  for (const folder of ["app", "components", "lib", "public", ".next/static"])
    await scan(resolve(folder));
  console.log(
    JSON.stringify({
      copyMatches: true,
      questions: pack.questions.length,
      writingPrompts: pack.writing.length,
      bankSha256: privateBankHash(pack),
      clientFilesChecked: checked,
      bankTextInClient: false,
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
