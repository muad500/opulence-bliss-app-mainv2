"use client";

import PortalNavigation from "@/components/PortalNavigation";

export default function PortalNav({ name, rating, ratingCount, registered, approved, hasCurrentJob, applicationStatus }: {
  name: string;
  rating: number | null;
  ratingCount: number;
  registered: boolean;
  approved: boolean;
  hasCurrentJob: boolean;
  applicationStatus: string;
}) {
  return <PortalNavigation mode="professional" name={name} rating={rating} ratingCount={ratingCount} registered={registered} approved={approved} hasCurrentJob={hasCurrentJob} applicationStatus={applicationStatus} />;
}
