/** Keep sign-in/signup returns on this website, including a booking resume token. */
export function safeAuthNext(value: string | null | undefined): string | null {
  return typeof value === "string" &&
    /^\/(?!\/)[^\\\u0000-\u0020]*$/.test(value)
    ? value
    : null;
}

export function authLink(path: string, next: string | null | undefined) {
  const destination = safeAuthNext(next);
  return destination ? `${path}?next=${encodeURIComponent(destination)}` : path;
}
