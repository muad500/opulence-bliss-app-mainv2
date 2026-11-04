export type StaffRole =
  | "onboarding"
  | "manager"
  | "second_signoff"
  | "developer";
export type StaffPermission =
  | "staff"
  | "manage"
  | "onboarding"
  | "first_review"
  | "second_signoff"
  | "suspend"
  | "private_evidence";
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  onboarding: "Onboarding member",
  manager: "Manager",
  second_signoff: "Second sign-off",
  developer: "Developer",
};
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && Object.hasOwn(STAFF_ROLE_LABELS, value);
}
export function staffRoleAllows(role: StaffRole, permission: StaffPermission) {
  if (
    ![
      "staff",
      "manage",
      "onboarding",
      "first_review",
      "second_signoff",
      "suspend",
      "private_evidence",
    ].includes(permission)
  )
    return false;
  if (permission === "staff") return true;
  if (role === "manager") return true;
  if (role === "onboarding")
    return [
      "onboarding",
      "first_review",
      "suspend",
      "private_evidence",
    ].includes(permission);
  if (role === "second_signoff")
    return ["onboarding", "second_signoff"].includes(permission);
  return false;
}
