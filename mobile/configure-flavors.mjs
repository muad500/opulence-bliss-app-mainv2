import { readFile, writeFile, mkdir } from "node:fs/promises";
const apps = JSON.parse(
  await readFile(new URL("./apps.json", import.meta.url), "utf8"),
);
const gradleFile = new URL("./android/app/build.gradle", import.meta.url);
let gradle = await readFile(gradleFile, "utf8");
const flavors = Object.entries(apps)
  .map(
    ([audience, app]) => `
        ${audience} {
            applicationId '${app.packageId}'
            versionCode ${app.versionCode}
            versionName '${app.versionName}'
            manifestPlaceholders = [appPathPrefix: '${app.startUrl}']
            resValue 'string', 'appName', '${app.name}'
            resValue 'string', 'launcherName', '${app.name}'
            resValue 'string', 'launchUrl', 'https://www.opulencebliss.com${app.startUrl}'
            resValue 'string', 'webManifestUrl', 'https://www.opulencebliss.com${app.startUrl}/manifest.webmanifest'
            resValue 'string', 'providerAuthority', '${app.packageId}.fileprovider'
            ${app.shortcuts.map((shortcut, index) => `resValue 'string', 'shortcut_name_${index}', '${shortcut.name}'\n            resValue 'string', 'shortcut_short_name_${index}', '${shortcut.shortName}'`).join("\n            ")}
        }`,
  )
  .join("\n");
if (gradle.includes("// BEGIN APP FLAVORS"))
  gradle = gradle.replace(
    /\s*\/\/ BEGIN APP FLAVORS[\s\S]*?\/\/ END APP FLAVORS/,
    "",
  );
gradle = gradle.replace(
  "    buildTypes {",
  `    // BEGIN APP FLAVORS
    flavorDimensions += 'audience'
    productFlavors {${flavors}
    }
    // END APP FLAVORS
    buildTypes {`,
);
await writeFile(gradleFile, gradle);
const manifestFile = new URL(
  "./android/app/src/main/AndroidManifest.xml",
  import.meta.url,
);
let manifest = await readFile(manifestFile, "utf8");
if (!manifest.includes("appPathPrefix"))
  manifest = manifest.replace(
    'android:host="@string/hostName"',
    'android:host="@string/hostName" android:pathPrefix="${appPathPrefix}"',
  );
await writeFile(manifestFile, manifest);
for (const [audience, app] of Object.entries(apps)) {
  const directory = new URL(
    `./android/app/src/${audience}/res/xml/`,
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${app.shortcuts
  .map(
    (
      shortcut,
      index,
    ) => `    <shortcut android:shortcutId="${audience}-${shortcut.screen}" android:enabled="true" android:icon="@drawable/shortcut_0" android:shortcutShortLabel="@string/shortcut_short_name_${index}" android:shortcutLongLabel="@string/shortcut_name_${index}">
        <intent android:action="android.intent.action.MAIN" android:targetPackage="${app.packageId}" android:targetClass="com.opulencebliss.app.LauncherActivity" android:data="https://www.opulencebliss.com${app.startUrl}?screen=${shortcut.screen}" />
        <categories android:name="android.intent.category.LAUNCHER" />
    </shortcut>`,
  )
  .join("\n")}
</shortcuts>\n`;
  await writeFile(new URL("shortcuts.xml", directory), xml);
}
await import("./worker-icons.mjs");
console.log("Separate customer and worker Android variants configured.");
