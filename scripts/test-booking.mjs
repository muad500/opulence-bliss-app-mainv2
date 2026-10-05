import ts from "typescript";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Compile the pure modules into an isolated CommonJS directory using the
// project's locked TypeScript compiler; no extra runtime dependency is needed.
const directory = await mkdtemp(join(tmpdir(), "opulence-tests-"));
const modules = ["assistantBooking", "assistantKnowledge", "appointmentSlots", "appointmentWindow", "bookingPolicy", "bookingTimeChoices", "cancellationPeriod", "cancellationPolicy", "cleaningBooking", "cleaningHome", "earningsPeriod", "handymanEstimate", "legacyDestinationCapture", "messageAttachments", "payoutDestination", "providerCoverage", "providerDbs", "providerOnboarding", "providerOperations", "regularBooking", "reviewVisibility", "ukPhone", "visitStatus", "bookingSms", "verificationRenewal", "handymanMarketplace"];
try {
  for (const moduleName of modules) {
    for (const suffix of ["", ".test"]) {
      const name = moduleName + suffix;
      const source = await readFile(new URL("../lib/" + name + ".ts", import.meta.url), "utf8");
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
      await writeFile(join(directory, name + ".js"), compiled.outputText);
    }
  }
  execFileSync(process.execPath, ["--test", ...modules.map((moduleName) => join(directory, moduleName + ".test.js"))], {
    stdio: "inherit",
    env: { ...process.env, NODE_PATH: join(process.cwd(), "node_modules") },
  });
  execFileSync(process.execPath, [
    "--test", "scripts/test-handyman-payment-recovery.mjs"
  ], { stdio: "inherit" });
  execFileSync(process.execPath, [
    "--test", "scripts/test-login-security.mjs"
  ], { stdio: "inherit" });
} finally {
  await rm(directory, { recursive: true, force: true });
}
