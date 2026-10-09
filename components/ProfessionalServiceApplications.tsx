"use client";

import { useState } from "react";
import type {
  ProfessionalService,
  ServiceApprovals,
} from "@/lib/professionalServices";

export default function ProfessionalServiceApplications({
  approvals,
  handymanEnabled,
  onAdded,
}: {
  approvals: ServiceApprovals;
  handymanEnabled: boolean;
  onAdded: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const services: ProfessionalService[] = handymanEnabled
    ? ["cleaning", "handyman"]
    : ["cleaning"];
  async function add(service: ProfessionalService) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "The application could not be saved.");
      await onAdded();
      setMessage(
        "Service added for review. Your shared checks, other services and working hours are unchanged.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="services"
      aria-label="Your service applications"
      style={{
        border: "1px solid #e6ddf4",
        borderRadius: 14,
        padding: 16,
        margin: "18px 0",
      }}
    >
      <h3>Services on your account</h3>
      <p>
        Shared identity, right-to-work and DBS checks apply to all your
        services. Each service needs its own approval.
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {services.map((service) => (
          <div
            key={service}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <strong style={{ textTransform: "capitalize" }}>{service}</strong>
            {approvals[service] ? (
              <span style={{ textTransform: "capitalize" }}>
                {approvals[service]}
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void add(service)}
                style={{
                  padding: "9px 14px",
                  border: "1px solid #d7c5f6",
                  borderRadius: 10,
                  background: "#f6f0ff",
                  color: "#6d28d9",
                  fontWeight: 800,
                }}
              >
                {busy ? "Adding…" : "Add a service"}
              </button>
            )}
          </div>
        ))}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
