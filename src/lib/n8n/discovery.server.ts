// MCP + OAuth discovery pipeline. See RFC 8414, RFC 9728, MCP auth spec.

import { getEnv, requireN8nMcpUrl } from "./env.server";
import { CategorizedError, logCategory } from "./errors.server";
import { putASMetadata, type ASMetadata, type DiscoveryResult } from "./kv.server";

function parseWwwAuthenticate(header: string): Record<string, string> {
  // Very small parser: scheme param="value", param2="value2"
  const out: Record<string, string> = {};
  const idx = header.indexOf(" ");
  const rest = idx === -1 ? "" : header.slice(idx + 1);
  const re = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(rest))) out[m[1].toLowerCase()] = m[2];
  return out;
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json();
}

async function tryFetchProtectedResourceMetadata(mcpUrl: string): Promise<{
  authorization_servers: string[];
  resource?: string;
} | null> {
  // 1) unauthenticated probe → WWW-Authenticate resource_metadata
  try {
    const probe = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
    });
    const wa = probe.headers.get("www-authenticate");
    if (wa) {
      const params = parseWwwAuthenticate(wa);
      const rm = params["resource_metadata"] ?? params["resource_metadata_uri"];
      if (rm) {
        const meta = (await fetchJson(rm)) as {
          authorization_servers?: string[];
          resource?: string;
        };
        if (meta.authorization_servers?.length) {
          return {
            authorization_servers: meta.authorization_servers,
            resource: meta.resource ?? mcpUrl,
          };
        }
      }
    }
  } catch {
    /* fall through */
  }

  // 2) RFC 9728 well-known paths
  const u = new URL(mcpUrl);
  const candidates: string[] = [
    `${u.origin}/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname}`,
    `${u.origin}/.well-known/oauth-protected-resource`,
  ];
  for (const c of candidates) {
    try {
      const meta = (await fetchJson(c)) as {
        authorization_servers?: string[];
        resource?: string;
      };
      if (meta.authorization_servers?.length) {
        return {
          authorization_servers: meta.authorization_servers,
          resource: meta.resource ?? mcpUrl,
        };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function fetchAuthorizationServerMetadata(issuer: string): Promise<ASMetadata> {
  const cleanIssuer = issuer.replace(/\/$/, "");
  const candidates = [
    `${cleanIssuer}/.well-known/oauth-authorization-server`,
    `${cleanIssuer}/.well-known/openid-configuration`,
  ];
  let lastErr: unknown;
  for (const c of candidates) {
    try {
      const raw = (await fetchJson(c)) as ASMetadata;
      if (raw?.authorization_endpoint && raw?.token_endpoint) {
        return {
          issuer: raw.issuer ?? cleanIssuer,
          authorization_endpoint: raw.authorization_endpoint,
          token_endpoint: raw.token_endpoint,
          registration_endpoint: raw.registration_endpoint,
          scopes_supported: raw.scopes_supported,
          code_challenge_methods_supported: raw.code_challenge_methods_supported,
          token_endpoint_auth_methods_supported: raw.token_endpoint_auth_methods_supported,
          grant_types_supported: raw.grant_types_supported,
          response_types_supported: raw.response_types_supported,
          client_id_metadata_document_supported: raw.client_id_metadata_document_supported,
        };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `Could not fetch AS metadata for issuer ${issuer}: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}

export async function discoverN8n(): Promise<DiscoveryResult> {
  const env = getEnv();
  const mcpUrl = requireN8nMcpUrl();

  const prm = await tryFetchProtectedResourceMetadata(mcpUrl);
  let issuer: string;
  let resource: string;
  if (prm) {
    issuer = prm.authorization_servers[0].replace(/\/$/, "");
    resource = prm.resource ?? mcpUrl;
  } else {
    // No PRM → assume the MCP origin is also the AS (fallback).
    issuer = new URL(mcpUrl).origin;
    resource = mcpUrl;
  }

  let metadata = await fetchAuthorizationServerMetadata(issuer);

  // Apply optional diagnostic overrides
  if (env.N8N_AUTHORIZATION_URL) metadata.authorization_endpoint = env.N8N_AUTHORIZATION_URL;
  if (env.N8N_TOKEN_URL) metadata.token_endpoint = env.N8N_TOKEN_URL;
  if (env.N8N_REGISTRATION_URL) metadata.registration_endpoint = env.N8N_REGISTRATION_URL;

  // Enforce S256
  const methods = metadata.code_challenge_methods_supported ?? [];
  if (!methods.includes("S256")) {
    throw new Error(
      `Authorization server ${metadata.issuer} does not advertise PKCE S256 support (code_challenge_methods_supported=${JSON.stringify(methods)}). Refusing to proceed.`,
    );
  }

  await putASMetadata(metadata);
  return { issuer: metadata.issuer, resource, metadata };
}
