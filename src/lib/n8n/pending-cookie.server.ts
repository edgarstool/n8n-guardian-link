// Encrypted, integrity-protected pending-auth cookie.
// Uses AES-GCM with a key derived from SESSION_SECRET (SHA-256).

import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { getEnv } from "./env.server";

const COOKIE_NAME = "n8n_pending";
const MAX_AGE_SECONDS = 600;

export type PendingAuthCookie = {
  state: string;
  verifier: string;
  issuer: string;
  resource: string;
  redirectUri: string;
  createdAt: number;
};

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function deriveKey(): Promise<CryptoKey> {
  const secret = getEnv().SESSION_SECRET;
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toArrayBuffer(a: Uint8Array): ArrayBuffer {
  return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
}

async function encrypt(data: PendingAuthCookie): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(plaintext),
    ),
  );
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(cipher)}`;
}

async function decrypt(token: string): Promise<PendingAuthCookie | null> {
  try {
    const [version, ivStr, cipherStr] = token.split(".");
    if (version !== "v1" || !ivStr || !cipherStr) return null;
    const iv = b64urlDecode(ivStr);
    const cipher = b64urlDecode(cipherStr);
    const key = await deriveKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(cipher),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as PendingAuthCookie;
    if (typeof parsed?.state !== "string" || typeof parsed?.verifier !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setPendingAuthCookie(data: PendingAuthCookie): Promise<void> {
  const value = await encrypt(data);
  setCookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Read the pending cookie, delete it (single-use), and validate freshness. */
export async function takePendingAuthCookie(): Promise<PendingAuthCookie | null> {
  const raw = getCookie(COOKIE_NAME);
  clearPendingAuthCookie();
  if (!raw) return null;
  const data = await decrypt(raw);
  if (!data) return null;
  if (Date.now() - data.createdAt > MAX_AGE_SECONDS * 1000) return null;
  return data;
}

export function clearPendingAuthCookie(): void {
  deleteCookie(COOKIE_NAME, { path: "/" });
}
