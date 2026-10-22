import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const require = createRequire(
  process.env.OPULENCE_ANDROID_TOOLS_PACKAGE ||
    new URL("./package.json", import.meta.url),
);
const {
  TwaManifest,
  TwaGenerator,
  ConsoleLog,
  fetchUtils,
} = require("@bubblewrap/core");
fetchUtils.setFetchEngine("node-fetch");
const certificate = JSON.parse(
  await readFile(
    new URL("./android/signing-certificate.json", import.meta.url),
  ),
);
const data = {
  packageId: certificate.packageName,
  host: "www.opulencebliss.com",
  name: "Opulence Bliss",
  launcherName: "Opulence Bliss",
  display: "standalone",
  startUrl: "/mobile/customer",
  themeColor: "#6d28d9",
  themeColorDark: "#6d28d9",
  navigationColor: "#ffffff",
  navigationColorDark: "#16202a",
  navigationDividerColor: "#ffffff",
  navigationDividerColorDark: "#16202a",
  backgroundColor: "#ffffff",
  enableNotifications: true,
  enableSiteSettingsShortcut: true,
  splashScreenFadeOutDuration: 250,
  appVersion: "1.1.0",
  appVersionCode: 2,
  minSdkVersion: 24,
  orientation: "default",
  iconUrl: "https://www.opulencebliss.com/icons/app-512.png",
  maskableIconUrl: "https://www.opulencebliss.com/icons/app-maskable-512.png",
  webManifestUrl:
    "https://www.opulencebliss.com/mobile/customer/manifest.webmanifest",
  fullScopeUrl: "https://www.opulencebliss.com/",
  fallbackType: "customtabs",
  signingKey: { path: "./opulence-bliss.jks", alias: "opulence-bliss" },
  fingerprints: [
    { name: "Android release", value: certificate.sha256Fingerprint },
  ],
  additionalTrustedOrigins: [],
  shortcuts: [
    {
      name: "Book a clean",
      shortName: "Book",
      url: "/mobile/customer?screen=book",
      chosenIconUrl: "https://www.opulencebliss.com/icons/app-192.png",
    },
    {
      name: "My bookings",
      shortName: "Bookings",
      url: "/mobile/customer?screen=bookings",
      chosenIconUrl: "https://www.opulencebliss.com/icons/app-192.png",
    },
  ],
};

// Generate from the checked-in icons; no dependency on a running deployment.
const server = createServer(async (request, response) => {
  if (request.url === "/manifest.webmanifest") {
    response
      .writeHead(200, { "Content-Type": "application/manifest+json" })
      .end(
        JSON.stringify({
          name: data.name,
          short_name: data.launcherName,
          start_url: data.startUrl,
          scope: "/",
          display: data.display,
          background_color: data.backgroundColor,
          theme_color: data.themeColor,
          icons: [
            { src: data.iconUrl, sizes: "512x512", type: "image/png" },
            {
              src: data.maskableIconUrl,
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        }),
      );
    return;
  }
  const filename = request.url?.match(
    /^\/icons\/(app-(?:192|512|maskable-512)\.png)$/,
  )?.[1];
  if (!filename) {
    response.writeHead(404).end();
    return;
  }
  try {
    const icon = await readFile(
      new URL("../public/icons/" + filename, import.meta.url),
    );
    response.writeHead(200, { "Content-Type": "image/png" }).end(icon);
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const localOrigin = `http://127.0.0.1:${server.address().port}`;
try {
  const manifest = new TwaManifest({
    ...data,
    iconUrl: localOrigin + "/icons/app-512.png",
    maskableIconUrl: localOrigin + "/icons/app-maskable-512.png",
    webManifestUrl: localOrigin + "/manifest.webmanifest",
    shortcuts: data.shortcuts.map((shortcut) => ({
      ...shortcut,
      chosenIconUrl: localOrigin + "/icons/app-192.png",
    })),
  });
  const validation = manifest.validate();
  if (validation) throw new Error(validation);
  await new TwaGenerator().createTwaProject(
    fileURLToPath(new URL("./android/", import.meta.url)),
    manifest,
    new ConsoleLog("Opulence Bliss Android"),
  );
  const appGradleUrl = new URL("./android/app/build.gradle", import.meta.url);
  const appGradle = await readFile(appGradleUrl, "utf8");
  await writeFile(
    appGradleUrl,
    appGradle.replaceAll(localOrigin, "https://www.opulencebliss.com"),
  );
  const rootGradleUrl = new URL("./android/build.gradle", import.meta.url);
  const rootGradle = await readFile(rootGradleUrl, "utf8");
  await writeFile(
    rootGradleUrl,
    rootGradle
      .replace("gradle:8.9.1", "gradle:8.13.2")
      .replaceAll("jcenter()", "mavenCentral()"),
  );
  const wrapperUrl = new URL(
    "./android/gradle/wrapper/gradle-wrapper.properties",
    import.meta.url,
  );
  const wrapper = await readFile(wrapperUrl, "utf8");
  await writeFile(
    wrapperUrl,
    wrapper.replace("gradle-8.11.1-bin.zip", "gradle-8.13-bin.zip"),
  );
  const androidManifestUrl = new URL(
    "./android/app/src/main/AndroidManifest.xml",
    import.meta.url,
  );
  const androidManifest = await readFile(androidManifestUrl, "utf8");
  await writeFile(
    androidManifestUrl,
    androidManifest.replace(/\s+package="com\.opulencebliss\.app"/, ""),
  );
  await writeFile(
    new URL("./android/twa-manifest.json", import.meta.url),
    JSON.stringify(data, null, 2) + "\n",
  );
  await import("./configure-flavors.mjs");
  console.log("Android project generated for https://www.opulencebliss.com.");
} finally {
  server.closeIdleConnections();
  await new Promise((resolve) => server.close(resolve));
}
