// Env resolution for n8n OAuth client. Read env only inside handlers.

export function getEnv() {
  const APP_BASE_URL =
    process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "https://connect.edgars.tools";
  const REDIRECT_URI = `${APP_BASE_URL}/oauth/n8n/callback`;
  const CLIENT_METADATA_URL = `${APP_BASE_URL}/oauth/client-metadata.json`;

  const N8N_MCP_URL = process.env.N8N_MCP_URL ?? "";

  return {
    APP_BASE_URL,
    REDIRECT_URI,
    CLIENT_METADATA_URL,
    N8N_MCP_URL,
    // Optional diagnostic overrides
    N8N_AUTHORIZATION_URL: process.env.N8N_AUTHORIZATION_URL,
    N8N_TOKEN_URL: process.env.N8N_TOKEN_URL,
    N8N_REGISTRATION_URL: process.env.N8N_REGISTRATION_URL,
    N8N_CLIENT_ID: process.env.N8N_CLIENT_ID,
    N8N_CLIENT_SECRET: process.env.N8N_CLIENT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET ?? "dev-insecure-session-secret-change-me-please-32b",
  };
}

export function requireN8nMcpUrl(): string {
  const url = getEnv().N8N_MCP_URL;
  if (!url) {
    throw new Error(
      "N8N_MCP_URL is not configured. Set it to your n8n Instance-level MCP URL (Settings → MCP access).",
    );
  }
  return url;
}
