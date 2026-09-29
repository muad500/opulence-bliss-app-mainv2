import { accountError, isRecord, optionalInteger, optionalText } from "@/lib/accountApi";
import { NextResponse } from "next/server";

export function addressFields(input: unknown, creating: boolean): Record<string, unknown> | NextResponse {
  if (!isRecord(input)) return accountError("Enter an address.");
  const allowed = new Set([
    "label", "line1", "line2", "city", "postcode", "accessInstructions",
    "propertyType", "bedrooms", "bathrooms", "pets", "productsProvidedBy", "isDefault",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return accountError("Unsupported address field.");
  try {
    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const map: Record<string, number> = {
      label: 40, line1: 180, line2: 180, city: 100,
      postcode: 12, accessInstructions: 1200, propertyType: 80, pets: 200,
    };
    for (const [camel, max] of Object.entries(map)) {
      if (!(camel in input)) continue;
      const snake = camel.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
      values[snake] = optionalText(input[camel], max);
    }
    if ("postcode" in input) {
      const postcode = String(values.postcode ?? "").replace(/\s+/g, "").toUpperCase();
      if (!/^(GIR0AA|(?:[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}))$/.test(postcode)) return accountError("Enter a valid UK postcode.");
      values.postcode = `${postcode.slice(0, -3)} ${postcode.slice(-3)}`;
    }
    if ("bedrooms" in input) values.bedrooms = optionalInteger(input.bedrooms, 0, 30);
    if ("bathrooms" in input) values.bathrooms = optionalInteger(input.bathrooms, 0, 30);
    if ("productsProvidedBy" in input) {
      if (input.productsProvidedBy !== null && !["customer", "professional"].includes(String(input.productsProvidedBy))) {
        return accountError("Choose who supplies cleaning products.");
      }
      values.products_provided_by = input.productsProvidedBy;
    }
    if ("isDefault" in input && typeof input.isDefault !== "boolean") return accountError("Choose a valid default setting.");
    if (creating && (!values.line1 || !values.city || !values.postcode)) return accountError("Enter the full address, city and postcode.");
    if ("line1" in input && !values.line1) return accountError("Enter the address line.");
    if ("city" in input && !values.city) return accountError("Enter the town or city.");
    return values;
  } catch (error) {
    return accountError(error instanceof Error ? error.message : "Invalid address.");
  }
}

export function addressResponse(row: Record<string, unknown>) {
  return {
    id: row.id, label: row.label, isDefault: row.is_default,
    line1: row.line1, line2: row.line2 ?? "", city: row.city, postcode: row.postcode,
    accessInstructions: row.access_instructions ?? "", propertyType: row.property_type ?? "",
    bedrooms: row.bedrooms, bathrooms: row.bathrooms, pets: row.pets ?? "",
    productsProvidedBy: row.products_provided_by,
  };
}
