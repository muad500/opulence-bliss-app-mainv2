import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const javaHome = process.env.JAVA_HOME;
const androidHome = process.env.ANDROID_HOME;
if (!javaHome || !androidHome) {
  throw new Error(
    "Set JAVA_HOME to JDK 17 and ANDROID_HOME to the Android SDK.",
  );
}
const signingDirectory =
  process.env.OPULENCE_ANDROID_SIGNING_DIRECTORY ||
  join(homedir(), "Documents", "Opulence Bliss Android Signing");
const signing = JSON.parse(
  await readFile(join(signingDirectory, "signing.json"), "utf8"),
);
const keyFile = join(signingDirectory, "opulence-bliss.jks");
const projectDirectory = fileURLToPath(new URL("./android/", import.meta.url));
const outputDirectory = fileURLToPath(
  new URL("../artifacts/android/", import.meta.url),
);
const java = join(
  javaHome,
  "bin",
  process.platform === "win32" ? "java.exe" : "java",
);
const jarsigner = join(
  javaHome,
  "bin",
  process.platform === "win32" ? "jarsigner.exe" : "jarsigner",
);
const env = {
  ...process.env,
  OB_ANDROID_SIGNING_PASSWORD: signing.storePassword,
};

const tasks = [
  "assembleCustomerRelease",
  "bundleCustomerRelease",
  "lintCustomerRelease",
  "assembleWorkerRelease",
  "bundleWorkerRelease",
  "lintWorkerRelease",
  "--console=plain",
  "--no-daemon",
];
const build =
  process.platform === "win32"
    ? spawnSync(
        "cmd.exe",
        ["/d", "/s", "/c", "gradlew.bat " + tasks.join(" ")],
        { cwd: projectDirectory, env, stdio: "inherit" },
      )
    : spawnSync("./gradlew", tasks, {
        cwd: projectDirectory,
        env,
        stdio: "inherit",
      });
if (build.error) throw build.error;
if (build.status !== 0) throw new Error("Android build or lint failed.");

await mkdir(outputDirectory, { recursive: true });
const apps = JSON.parse(
  await readFile(new URL("./apps.json", import.meta.url), "utf8"),
);
for (const [audience, app] of Object.entries(apps)) {
  const prefix =
    audience === "worker" ? "Opulence-Bliss-Pro" : "Opulence-Bliss";
  const apk = join(outputDirectory, `${prefix}-${app.versionName}.apk`);
  const bundle = join(outputDirectory, `${prefix}-${app.versionName}.aab`);
  const tools = join(androidHome, "build-tools", "36.1.0");
  execFileSync(
    java,
    [
      "-jar",
      join(tools, "lib", "apksigner.jar"),
      "sign",
      "--ks",
      keyFile,
      "--ks-key-alias",
      signing.alias,
      "--ks-pass",
      "env:OB_ANDROID_SIGNING_PASSWORD",
      "--key-pass",
      "env:OB_ANDROID_SIGNING_PASSWORD",
      "--out",
      apk,
      join(
        projectDirectory,
        "app",
        "build",
        "outputs",
        "apk",
        audience,
        "release",
        `app-${audience}-release-unsigned.apk`,
      ),
    ],
    { env, stdio: "pipe" },
  );
  const signature = execFileSync(
    java,
    [
      "-jar",
      join(tools, "lib", "apksigner.jar"),
      "verify",
      "--print-certs",
      apk,
    ],
    { env, encoding: "utf8" },
  );
  const certificate = JSON.parse(
    await readFile(
      new URL("./android/signing-certificate.json", import.meta.url),
    ),
  );
  const expectedFingerprint = certificate.sha256Fingerprint
    .replaceAll(":", "")
    .toLowerCase();
  if (!signature.toLowerCase().includes(expectedFingerprint)) {
    throw new Error(
      "APK signing certificate does not match the website association.",
    );
  }

  await copyFile(
    join(
      projectDirectory,
      "app",
      "build",
      "outputs",
      "bundle",
      `${audience}Release`,
      `app-${audience}-release.aab`,
    ),
    bundle,
  );
  execFileSync(
    jarsigner,
    [
      "-keystore",
      keyFile,
      "-storepass:env",
      "OB_ANDROID_SIGNING_PASSWORD",
      "-keypass:env",
      "OB_ANDROID_SIGNING_PASSWORD",
      bundle,
      signing.alias,
    ],
    { env, stdio: "pipe" },
  );
  execFileSync(jarsigner, ["-verify", bundle], { env, stdio: "pipe" });
  console.log(
    "Signed APK and AAB created; APK certificate matches the website association.",
  );
  console.log(apk);
  console.log(bundle);
}
