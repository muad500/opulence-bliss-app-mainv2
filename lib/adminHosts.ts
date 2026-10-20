type Environment = Record<string, string | undefined>;

export const ADMIN_ORIGIN = "https://admin.opulencebliss.com";
export const WEBSITE_ORIGIN = "https://www.opulencebliss.com";

function vercelOrigin(host: string | undefined) {
  if (!host || !/^[a-z0-9-]+\.vercel\.app$/i.test(host)) return null;
  return `https://${host.toLowerCase()}`;
}

/** Preview has two hosts on the same isolated deployment: its branch alias is
 * staff-only; its immutable deployment address is the public test website. */
export function deploymentOrigins(env: Environment) {
  if (env.VERCEL_ENV === "preview") {
    const admin = vercelOrigin(env.VERCEL_BRANCH_URL);
    const website = vercelOrigin(env.VERCEL_URL);
    if (!admin || !website || admin === website)
      throw new Error("Separate Preview staff and website hosts are required.");
    return { admin, website };
  }
  return { admin: ADMIN_ORIGIN, website: WEBSITE_ORIGIN };
}

function within(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isStaffPath(path: string) {
  return within(path, "/admin") || within(path, "/staff");
}

export function adminHostRedirect(url: URL, env: Environment) {
  if (
    !env.VERCEL_ENV &&
    env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return null;
  const origins = deploymentOrigins(env);
  let path = url.pathname;
  // Next can decode a route before matching it. Encoded staff segments must
  // receive the same host protection, including a path ending in an image suffix.
  try {
    path = decodeURIComponent(path).replaceAll("\\", "/");
  } catch {
    // Malformed encodings will be refused by the router; never invent a target.
  }
  const staff = isStaffPath(path) || within(path, "/api/admin");
  const onAdmin = url.origin === origins.admin;
  // Admin pages need their own same-origin APIs and framework assets. All other
  // public pages and APIs leave the staff host before session handling runs.
  const supporting =
    within(url.pathname, "/_next") ||
    ["/favicon.ico", "/api/slots"].includes(url.pathname);
  const destination = staff
    ? onAdmin
      ? null
      : origins.admin
    : onAdmin && !supporting
      ? origins.website
      : null;
  if (!destination) return null;
  const target = new URL(destination);
  target.pathname = url.pathname;
  target.search = url.search;
  return target;
}

/** Shared by web and the payment worker; staff links never use a public host. */
export function notificationLink(
  path: string,
  website: string,
  env: Environment,
) {
  if (!/^\/(?!\/)[^\\\u0000-\u0020]*$/.test(path))
    throw new Error("Invalid notification link.");
  let origin = website;
  if (isStaffPath(path.split(/[?#]/)[0])) {
    origin =
      env.VISIT_PAYMENTS_MODE === "staging" && !env.VERCEL_ENV
        ? website
        : deploymentOrigins(env).admin;
  }
  const target = new URL(path, origin);
  if (target.protocol !== "https:")
    throw new Error("A secure notification address is required.");
  return target.toString();
}
