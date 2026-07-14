// Env resolution for n8n OAuth client. Read env only inside handlers.

import { CategorizedError } from "./errors.server";

const DEV_SESSION_SECRET = "dev-insecure-session-secret-change-me-please-32b";

export function isProduction(): boolean {
  // Cloudflare/wrangler sets NODE_ENV=production for deployed workers.
  // Any explicit "development" value opts into the dev fallback.
  const v = process.env.NODE_ENV;
  return v !== "development" && v !== "test";
}

/**
 * Resolve app env. Throws CategorizedError('missing_configuration') in
 * production if SESSION_SECRET is missing or too short (<32 chars).
 * In development, falls back to a well-known insecure value.
 */
export function getEnv() {
  const APP_BASE_URL =
    process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "https://connect.edgars.tools";
  const REDIRECT_URI = `${APP_BASE_URL}/oauth/n8n/callback`;
  const CLIENT_METADATA_URL = `${APP_BASE_URL}/oauth/client-metadata.json`;

  const N8N_MCP_URL = process.env.N8N_MCP_URL ?? "";

  const rawSecret = process.env.SESSION_SECRET;
  let SESSION_SECRET: string;
  if (rawSecret && rawSecret.length >= 32) {
    SESSION_SECRET = rawSecret;
  } else if (!isProduction()) {
    SESSION_SECRET = DEV_SESSION_SECRET;
  } else {
    throw new CategorizedError("missing_configuration");
  }

  return {
    APP_BASE_URL,
    REDIRECT_URI,
    CLIENT_METADATA_URL,
    N8N_MCP_URL,
    N8N_AUTHORIZATION_URL: process.env.N8N_AUTHORIZATION_URL,
    N8N_TOKEN_URL: process.env.N8N_TOKEN_URL,
    N8N_REGISTRATION_URL: process.env.N8N_REGISTRATION_URL,
    N8N_CLIENT_ID: process.env.N8N_CLIENT_ID,
    N8N_CLIENT_SECRET: process.env.N8N_CLIENT_SECRET,
    SESSION_SECRET,
  };
}

export function requireN8nMcpUrl(): string {
  const url = getEnv().N8N_MCP_URL;
  if (!url) throw new CategorizedError("missing_configuration");
  return url;
}
