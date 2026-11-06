import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, dirname, extname, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  parseAssessmentParagraphs,
  assessmentImportSql,
  privateBankHash,
  ASSESSMENT_APPROVED_SHA256,
} from "./cleaner-assessment-pack.mjs";

// The DOCX and generated bank/SQL stay under this ignored directory. Never
// print the content, answers, SQL or an exception containing them.
try {
  const source = resolve(process.argv[2] ?? "");
  const root = resolve(".local-secrets/assessment-source");
  const rel = relative(root, source);
  if (
    !rel ||
    rel.startsWith(`..${sep}`) ||
    rel === ".." ||
    extname(source) !== ".docx"
  )
    throw Error(
      "Place the DOCX inside .local-secrets/assessment-source first.",
    );
  const bytes = await readFile(source);
  if (bytes.length > 1000000)
    throw Error("Source size exceeds the supported bound.");
  const python = `from zipfile import ZipFile
from xml.etree import ElementTree as E
import json,sys
with ZipFile(sys.argv[1]) as z:
 data=z.read('word/document.xml')
 if len(data)>2000000: raise ValueError('Source XML exceeds the supported bound')
n={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
r=E.fromstring(data)
print(json.dumps([''.join(t.text or '' for t in p.findall('.//w:t',n)) for p in r.findall('.//w:body/w:p',n)],ensure_ascii=True))`;
  const output = execFileSync("python", ["-c", python, source], {
    maxBuffer: 2000000,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pack = parseAssessmentParagraphs(JSON.parse(output));
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  if (sourceSha256 !== ASSESSMENT_APPROVED_SHA256)
    throw Error("The source differs from the approved file fingerprint.");
  const sql = assessmentImportSql(pack, sourceSha256);
  const target = resolve(root, "import-staging-assessment.sql");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, sql, { mode: 0o600 });
  await writeFile(
    resolve(root, "parsed-private-pack.json"),
    JSON.stringify(pack),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      prepared: true,
      questions: pack.questions.length,
      writingPrompts: pack.writing.length,
      version: pack.version,
      sourceSha256,
      bankSha256: privateBankHash(pack),
    }),
  );
} catch (error) {
  // Parser errors are fixed strings. Do not forward command stderr or SQL.
  console.error(
    error?.code ? "The private source could not be read." : error.message,
  );
  process.exitCode = 1;
}
