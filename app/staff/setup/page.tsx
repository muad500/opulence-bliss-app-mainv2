export const metadata = {
  title: "Set up your staff account | Opulence Bliss",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function StaffSetup({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>;
}) {
  const { token_hash: token } = await searchParams;
  if (!token || !/^[a-zA-Z0-9_-]{32,512}$/.test(token))
    return (
      <main className="mx-auto max-w-md p-8">
        <h1>Staff setup link unavailable</h1>
        <p>Ask your administrator for a new setup email.</p>
      </main>
    );
  // Opening or scanning the email never consumes its single-use credential.
  return (
    <main className="mx-auto max-w-md space-y-5 p-8">
      <h1 className="text-2xl font-bold">Set up your admin account</h1>
      <p>
        Continue to set up your authenticator and choose your own password. Both
        are required before you can use the admin pages.
      </p>
      <form action="/staff/callback" method="post">
        <input type="hidden" name="token_hash" value={token} />
        <button className="rounded-xl bg-purple-700 px-6 py-3 font-semibold text-white">
          Continue with staff setup
        </button>
      </form>
    </main>
  );
}
