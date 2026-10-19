export function chatMessageMail(
  delivery: { sender_role: string; body: string; href: string },
  site: string,
) {
  if (!/^(customer|provider)$/.test(delivery.sender_role))
    throw new Error("Unsupported chat sender");
  if (!/^\/(account\/visit|worker\/job)\/[0-9a-f-]{36}$/.test(delivery.href))
    throw new Error("Invalid conversation link");
  const origin = new URL(site);
  if (origin.protocol !== "https:" || origin.username || origin.password)
    throw new Error("A secure website address is required");
  const subject = `You've received a new message from your ${delivery.sender_role === "provider" ? "cleaner" : "customer"}`;
  return {
    subject,
    // Plain text only: message contents are never interpreted as email HTML.
    text: `${subject}\n\n${delivery.body}\n\nOpen your chat: ${origin.origin}${delivery.href}#messages`,
  };
}
