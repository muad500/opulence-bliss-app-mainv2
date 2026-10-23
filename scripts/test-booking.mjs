import ts from "typescript";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Compile the pure modules into an isolated CommonJS directory using the
// project's locked TypeScript compiler; no extra runtime dependency is needed.
const directory = await mkdtemp(join(tmpdir(), "opulence-tests-"));
const modules = [
  "notificationSettings",
  "adminHosts",
  "chatMessageMail",
  "cleaningComparison",
  "adminDashboard",
  "jobOfferSettings",
  "staffMfa",
  "accountSecurityAlerts",
  "socialLinks",
  "cleaningBillingTerms",
  "cleaningPaymentCopy",
  "bookingPreferences",
  "visitContactPolicy",
  "assistantPresentation",
  "assistantBooking",
  "assistantKnowledge",
  "appointmentSlots",
  "appointmentWindow",
  "bookingPolicy",
  "bookingDraft",
  "authReturn",
  "bookingTimeChoices",
  "cancellationPeriod",
  "cancellationPolicy",
  "cleaningBooking",
  "cleaningExtras",
  "visitBillingPolicy",
  "visitMatchingPolicy",
  "visitLineItems",
  "visitAdjustments",
  "quotePhotos",
  "cleaningHome",
  "earningsPeriod",
  "handymanQuotes",
  "legacyDestinationCapture",
  "messageAttachments",
  "payoutDestination",
  "professionalAccess",
  "professionalServices",
  "professionalEarnings",
  "providerCoverage",
  "providerDbs",
  "providerOnboarding",
  "providerOperations",
  "regularBooking",
  "reviewVisibility",
  "ukPhone",
  "visitStatus",
  "bookingSms",
  "verificationRenewal",
  "handymanMarketplace",
];
try {
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-booking-legal-evidence.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-notification-settings.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(process.execPath, ["--test", "scripts/test-store-assets.mjs"], {
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["--test", "scripts/test-web-push.mjs"], {
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-payment-copy-seed.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-checkout-legal.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-handyman-webhook.mjs"],
    {
      stdio: "inherit",
    },
  );
  execFileSync(process.execPath, ["--test", "scripts/test-admin-host.mjs"], {
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-chat-message-emails.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-admin-dashboard.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-account-security.mjs"],
    { stdio: "inherit" },
  );
  for (const moduleName of modules) {
    for (const suffix of ["", ".test"]) {
      const name = moduleName + suffix;
      const source = await readFile(
        new URL("../lib/" + name + ".ts", import.meta.url),
        "utf8",
      );
      const compiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      });
      await writeFile(join(directory, name + ".js"), compiled.outputText);
    }
  }
  execFileSync(
    process.execPath,
    [
      "--test",
      ...modules.map((moduleName) => join(directory, moduleName + ".test.js")),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, NODE_PATH: join(process.cwd(), "node_modules") },
    },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-cleaning-checkout.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(process.execPath, ["--test", "scripts/test-social-links.mjs"], {
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-booking-sign-in.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-booking-confirmation.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(process.execPath, ["--test", "scripts/test-visit-billing.mjs"], {
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-visit-matching-notices.mjs"],
    {
      stdio: "inherit",
    },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-handyman-payment-recovery.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-handyman-quote-marketplace.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-supabase-session.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-login-security.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-professional-access.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-professional-portal.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-separated-apps.mjs"],
    { stdio: "inherit" },
  );
  execFileSync(process.execPath, ["--test", "scripts/test-mobile-app.mjs"], {
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-loading-updates.mjs"],
    {
      stdio: "inherit",
    },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-visit-payment-worker.mjs"],
    {
      stdio: "inherit",
    },
  );
  execFileSync(
    process.execPath,
    ["scripts/build-visit-payment-worker.mjs", "--check"],
    {
      stdio: "inherit",
    },
  );
  execFileSync(
    process.execPath,
    ["--test", "scripts/test-production-visit-release.mjs"],
    { stdio: "inherit" },
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
