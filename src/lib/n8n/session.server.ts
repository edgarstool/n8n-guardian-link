// Opaque session cookie (HttpOnly, Secure, SameSite=Lax). Carries only a session ID.

import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { generateSessionId } from "./pkce.server";

const COOKIE_NAME = "n8n_sid";

export function getSessionId(): string | undefined {
  return getCookie(COOKIE_NAME);
}

export function ensureSessionId(): string {
  const existing = getSessionId();
  if (existing) return existing;
  const sid = generateSessionId();
  setSessionCookie(sid);
  return sid;
}

export function setSessionCookie(sid: string) {
  setCookie(COOKIE_NAME, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export function clearSessionCookie() {
  deleteCookie(COOKIE_NAME, { path: "/" });
}
