import type { Metadata } from "next";
import SiteFooter from "@/components/SiteFooter";
import PartnerPageContent from "./PartnerPageContent";

export const metadata: Metadata = {
  title: "Opulence Bliss Partner Programme",
  description:
    "Earn rewards by recommending Opulence Bliss cleaning to households and businesses in London. Free to join.",
};

export default function PartnersPage() {
  return (
    <>
      <PartnerPageContent />
      <SiteFooter storageFree />
    </>
  );
}
