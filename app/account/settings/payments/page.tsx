import { redirect } from "next/navigation";

export default function PaymentSettingsRedirect() {
  redirect("/account/profile#payments");
}
