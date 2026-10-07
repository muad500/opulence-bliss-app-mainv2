type DevelopmentEnvironment = {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  DEVELOPMENT_TOOLS_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
};

/** Test credentials alone must never unlock shortcuts on the public site. */
export function developmentToolsEnabled(env: DevelopmentEnvironment): boolean {
  const allowedEnvironment =
    env.VERCEL_ENV === "preview" ||
    (!env.VERCEL_ENV && env.NODE_ENV === "development");
  return (
    allowedEnvironment &&
    env.DEVELOPMENT_TOOLS_ENABLED === "true" &&
    /^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? "")
  );
}

export function assertDevelopmentToolsEnabled(
  env: DevelopmentEnvironment,
  tool: string,
): void {
  if (!developmentToolsEnabled(env)) {
    throw new Error(
      `"${tool}" is disabled. Development tools require an explicitly enabled ` +
        `Preview or local development environment with Stripe test credentials. ` +
        `Use the resolution desk to correct production records.`,
    );
  }
}
