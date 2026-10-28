import Link from "next/link";
import { notFound } from "next/navigation";
import {
  UserRound,
  MapPin,
  Heart,
  CreditCard,
  Star,
  ShieldCheck,
  CircleHelp,
  CalendarDays,
  Wallet,
  ChevronRight,
  ClipboardCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { canUseProfessionalTools } from "@/lib/professionalAccess";
import styles from "@/components/MobileAccountMenu.module.css";
export default async function AccountMenu({
  params,
}: {
  params: Promise<{ audience: string }>;
}) {
  const { audience } = await params;
  if (audience !== "customer" && audience !== "worker") notFound();
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  const worker = audience === "worker";
  if (!user)
    return (
      <main className={styles.page}>
        <h1>Your account</h1>
        <p>Sign in to keep your details and messages together.</p>
        <Link
          className={styles.signIn}
          href={worker ? "/provider/login" : "/login"}
        >
          Sign in
        </Link>
        <Link href={worker ? "/provider/join" : "/auth/sign-up"}>
          {worker ? "Apply to join" : "Create account"}
        </Link>
      </main>
    );
  const [{ data: profile }, { data: provider }] = await Promise.all([
    client
      .from("profiles")
      .select("full_name,email")
      .eq("id", user.id)
      .maybeSingle(),
    worker
      ? client
          .from("providers")
          .select("id,vetting_status,is_suspended,service_approvals")
          .eq("profile_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const canWork = canUseProfessionalTools(provider);
  const rows = worker
    ? [
        {
          label: "Personal & public profile",
          detail: "Your details, photo and services",
          href: "/worker/profile#personal",
          icon: UserRound,
        },
        {
          label: "Verification",
          detail: "ID, right to work and DBS",
          href: "/worker/profile#verification",
          icon: ShieldCheck,
        },
        {
          label: "Availability",
          detail: canWork
            ? "Hours, areas and time off"
            : "Available after approval",
          href: "/worker/availability",
          icon: CalendarDays,
          locked: !canWork,
        },
        {
          label: "Earnings & payouts",
          detail: canWork
            ? "Statements, bank setup and tax details"
            : "Available after approval",
          href: "/worker/earnings",
          icon: Wallet,
          locked: !canWork,
        },
        {
          label: "Application",
          detail: "Your review and approval status",
          href: "/worker/application",
          icon: ClipboardCheck,
        },
        {
          label: "Privacy & account",
          detail: "Download your data or request deletion",
          href: "/worker/profile#legal",
          icon: ShieldCheck,
        },
        {
          label: "Help & support",
          detail: "Answers and contact details",
          href: "/faq",
          icon: CircleHelp,
        },
      ]
    : [
        {
          label: "Personal details",
          detail: "Name, email, phone and password",
          href: "/account/profile#personal",
          icon: UserRound,
        },
        {
          label: "Addresses & home",
          detail: "Saved places and access instructions",
          href: "/account/profile#addresses",
          icon: MapPin,
        },
        {
          label: "Preferences",
          detail: "Favourites and notifications",
          href: "/account/profile#preferences",
          icon: Heart,
        },
        {
          label: "Payments & receipts",
          detail: "Cards, invoices, tips and refunds",
          href: "/account/profile#payments",
          icon: CreditCard,
        },
        {
          label: "Reviews",
          detail: "Your feedback and ratings",
          href: "/account/profile#reviews",
          icon: Star,
        },
        {
          label: "Privacy & security",
          detail: "Download your data or request deletion",
          href: "/account/profile#privacy",
          icon: ShieldCheck,
        },
        {
          label: "Help & support",
          detail: "Answers, contact us or report a problem",
          href: "/account/profile#help",
          icon: CircleHelp,
        },
      ];
  rows.push({
    label: "Earn with us",
    detail: "Explore cleaning work or become a Partner",
    href: "/earn-with-us",
    icon: ClipboardCheck,
  });
  return (
    <main className={styles.page}>
      <div className={styles.identity}>
        <span>{profile?.full_name?.charAt(0) || "O"}</span>
        <div>
          <h1>{profile?.full_name || "Your account"}</h1>
          <p>{profile?.email || user.email}</p>
        </div>
      </div>
      <div className={styles.list}>
        {rows.map((row) => {
          const Icon = row.icon;
          const content = (
            <>
              <Icon size={22} />
              <div>
                <strong>{row.label}</strong>
                <small>{row.detail}</small>
              </div>
              <ChevronRight size={18} />
            </>
          );
          return "locked" in row && row.locked ? (
            <div key={row.label} className={styles.locked} aria-disabled="true">
              {content}
            </div>
          ) : (
            <Link
              key={row.label}
              href={row.href}
              target={row.label === "Earn with us" ? "_blank" : undefined}
              rel={
                row.label === "Earn with us" ? "noopener noreferrer" : undefined
              }
              data-earn-with-us={row.label === "Earn with us" || undefined}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
