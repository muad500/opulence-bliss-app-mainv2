import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Create your account | Opulence Bliss",
};
import { SignUpForm } from "@/components/sign-up-form";

export default function Page() {
  return <SignUpForm />;
}
