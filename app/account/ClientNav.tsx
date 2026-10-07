"use client";

import PortalNavigation from "@/components/PortalNavigation";

export default function ClientNav({ name, email, hasProfessionalAccount, professionalApproved }: {
  name: string;
  email: string;
  hasProfessionalAccount: boolean;
  professionalApproved: boolean;
}) {
  return <PortalNavigation mode="client" name={name} email={email} hasProfessionalAccount={hasProfessionalAccount} professionalApproved={professionalApproved} />;
}
