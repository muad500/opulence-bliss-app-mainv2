"use client";

import type { ProfessionalService } from "@/lib/professionalServices";

export default function ProfessionalServicePicker({
  value,
  onChange,
  handymanEnabled,
}: {
  value: ProfessionalService[];
  onChange: (services: ProfessionalService[]) => void;
  handymanEnabled: boolean;
}) {
  const services: ProfessionalService[] = handymanEnabled
    ? ["cleaning", "handyman"]
    : ["cleaning"];
  return (
    <fieldset
      style={{
        border: "1px solid #e6ddf4",
        borderRadius: 14,
        margin: "0 0 20px",
        padding: 16,
      }}
    >
      <legend style={{ fontWeight: 800 }}>
        Which services would you like to offer?
      </legend>
      <p style={{ fontSize: 13, margin: "0 0 12px" }}>
        One account and one set of checks. Each service is reviewed separately.
      </p>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {services.map((service) => (
          <label
            key={service}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              textTransform: "capitalize",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={value.includes(service)}
              onChange={() =>
                onChange(
                  value.includes(service)
                    ? value.filter((item) => item !== service)
                    : [...value, service],
                )
              }
              style={{
                width: 18,
                height: 18,
                margin: 0,
                accentColor: "#7b2ff7",
              }}
            />
            {service}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
