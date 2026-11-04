export const ACCOUNT_ROLES = [
  "customer",
  "cleaner",
  "handyman",
  "partner",
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export type AccountRoleRecord = {
  role: AccountRole;
  status: string;
  pay_source: string;
  reward_route: string | null;
};
export const ROLE_LABELS: Record<AccountRole, string> = {
  customer: "Customer",
  cleaner: "Cleaner",
  handyman: "Property maintenance",
  partner: "Partner",
};
export function isAccountRole(value: unknown): value is AccountRole {
  return ACCOUNT_ROLES.includes(value as AccountRole);
}
export function visibleAccountRoles(
  roles: AccountRoleRecord[],
  marketplace: boolean,
) {
  const hasHandyman = roles.some((item) => item.role === "handyman");
  return roles.filter(
    (item) =>
      (item.role !== "handyman" || marketplace) &&
      (item.role !== "partner" || !hasHandyman),
  );
}
export function accountRoleDestination(role: AccountRole, status: string) {
  if (status !== "active") return `/account/roles/${role}`;
  if (role === "customer") return "/book";
  if (role === "partner") return "/account/roles/partner";
  return `/account/roles/${role}`;
}
export function roleDocumentPath(role: AccountRole, slug: string) {
  const professional = [
    "professional-partner-agreement",
    "cleaner-terms",
    "cleaner-cancellation",
    "handyman-professional-terms",
    "safeguarding",
    "dbs-data",
  ].includes(slug);
  return professional && (role === "cleaner" || role === "handyman")
    ? `/provider/join/policies/${slug}`
    : `/legal/${slug}`;
}
export const SHARED_VERIFICATION_TYPES = [
  "photo_id",
  "right_to_work",
  "proof_of_address",
  "public_liability_insurance",
];
export const HANDYMAN_VERIFICATION_TYPES = [
  "trade_certificate",
  "gas_safe_registration",
  "electrical_registration",
];
export function verificationTypesForRole(role: AccountRole) {
  if (role === "cleaner") return SHARED_VERIFICATION_TYPES;
  if (role === "handyman")
    return [...SHARED_VERIFICATION_TYPES, ...HANDYMAN_VERIFICATION_TYPES];
  return [];
}
