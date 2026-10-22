import { webPushEnabled, webPushEnvironment } from "./webPushPolicy";
// Public DEBUG certificate fingerprint, not a private key or production signer.
export const stagingFingerprint =
  "1C:1C:7D:37:7A:24:0A:96:C3:FE:FD:BE:AC:76:A7:AE:49:17:C3:07:11:BD:61:CA:8A:8C:17:F9:95:7F:E9:23";
export function stagingAndroidAssociation(host: string) {
  if (
    !webPushEnabled(process.env) ||
    webPushEnvironment(process.env) !== "staging" ||
    !/^opulence-bliss-app-mainv2-[a-z0-9-]+-muad500s-projects\.vercel\.app$/.test(
      host,
    )
  )
    return null;
  return [
    "com.opulencebliss.app.staging",
    "com.opulencebliss.worker.staging",
  ].map((packageName) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: packageName,
      sha256_cert_fingerprints: [stagingFingerprint],
    },
  }));
}
