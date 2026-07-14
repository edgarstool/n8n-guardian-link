// Env + dynamic-origin resolver for the n8n OAuth Connector.
// The temporary Lovable-hosted launch path derives the request origin
// from the actual incoming request; APP_BASE_URL is only used as a
// fallback for hardened Cloudflare deployments.

import { getRequestUrl } from "@tanstack/react-start/server";
import { CategorizedError } from "./errors.server";
import { getSessionMcpUrl } from "./db.server";

export function isProduction(): boolean {
  const v = process.env.NODE_ENV;
  return v !== "development" && v !== "test";
}

function tryRequestOrigin(): string | undefined {
  try {
    const u = getRequestUrl();
    if (u) return new URL(u).origin.replace(/\/$/, "");
  } catch {
    /* no request context */
  }
  return undefined;
}

/** Resolve the canonical app origin for this request. */
export function getAppBaseUrl(): string {
  return (
    tryRequestOrigin() ??
    process.env.APP_BASE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

/**
 * Resolve env. No SESSION_SECRET required on the temporary Lovable path.
 * REDIRECT_URI / CLIENT_METADATA_URL are derived from the live request origin.
 */
export function getEnv() {
  const APP_BASE_URL = getAppBaseUrl();
  const REDIRECT_URI = `${APP_BASE_URL}/oauth/n8n/callback`;
  const CLIENT_METADATA_URL = `${APP_BASE_URL}/oauth/client-metadata.json`;

  return {
    APP_BASE_URL,
    REDIRECT_URI,
    CLIENT_METADATA_URL,
    N8N_AUTHORIZATION_URL: process.env.N8N_AUTHORIZATION_URL,
    N8N_TOKEN_URL: process.env.N8N_TOKEN_URL,
    N8N_REGISTRATION_URL: process.env.N8N_REGISTRATION_URL,
    N8N_CLIENT_ID: process.env.N8N_CLIENT_ID,
    N8N_CLIENT_SECRET: process.env.N8N_CLIENT_SECRET,
  };
}

/** Look up the per-session Instance MCP URL saved by the user. */
export async function requireSessionMcpUrl(sid: string): Promise<string> {
  const fromSession = await getSessionMcpUrl(sid);
  const url = fromSession ?? process.env.N8N_MCP_URL ?? "";
  if (!url) throw new CategorizedError("missing_configuration");
  return url;
}
