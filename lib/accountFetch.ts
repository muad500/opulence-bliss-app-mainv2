"use client";

export type AccountCodeRequest = {
  requestHash: string;
  resolve: (proof: string | null) => void;
};

/** Retain the exact serialized body (including a multipart boundary) for the verified retry. */
export async function accountFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(new URL(input, window.location.origin), {
    credentials: "same-origin",
    ...init,
  });
  const response = await fetch(request.clone());
  if (response.status !== 428) return response;
  const info = await response
    .clone()
    .json()
    .catch(() => ({}));
  if (!info.verificationRequired || !info.requestHash) return response;
  const proof = await new Promise<string | null>((resolve) => {
    window.dispatchEvent(
      new CustomEvent<AccountCodeRequest>("account-change-code", {
        detail: { requestHash: info.requestHash, resolve },
      }),
    );
  });
  if (!proof)
    return new Response(
      JSON.stringify({
        error: "Change cancelled. Your details have not changed.",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  const headers = new Headers(request.headers);
  headers.set("x-account-change-proof", proof);
  return fetch(new Request(request, { headers }));
}
