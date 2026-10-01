"use client";

import PortalNavigation from "@/components/PortalNavigation";

export default function ClientNav({ name, email, hasProfessionalAccount }: {
  name: string;
  email: string;
  hasProfessionalAccount: boolean;
}) {
  return <PortalNavigation mode="client" name={name} email={email} hasProfessionalAccount={hasProfessionalAccount} />;
}
