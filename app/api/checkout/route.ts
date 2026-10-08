import { NextRequest } from "next/server";
import { createCustomerCheckout } from "@/lib/customerCheckoutServer";

export async function POST(req: NextRequest) {
  return createCustomerCheckout(req);
}
