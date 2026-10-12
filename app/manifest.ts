import type { MetadataRoute } from "next";
import { mobileManifest } from "@/lib/mobileManifest";
export default function manifest(): MetadataRoute.Manifest {
  return mobileManifest("customer");
}
