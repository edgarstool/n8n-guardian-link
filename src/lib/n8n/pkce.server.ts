// PKCE (S256) + random ID helpers using WebCrypto. Server-only.

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomBytes(len: number): Uint8Array {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

export function randomUrlSafe(len = 32): string {
  return base64UrlEncode(randomBytes(len));
}

export function generateState(): string {
  return randomUrlSafe(24);
}

export function generateSessionId(): string {
  return randomUrlSafe(32);
}

export function generatePkceVerifier(): string {
  // 32 random bytes → 43-char base64url
  return randomUrlSafe(32);
}

export async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}
