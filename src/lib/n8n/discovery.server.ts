// MCP + OAuth discovery pipeline. Accepts the mcpUrl explicitly so the
// caller can pass a per-session URL saved by the user.

import { getEnv } from "./env.server";
import { CategorizedError, logCategory } from "./errors.server";
import { putASMetadata } from "./kv.server";
import type { ASMetadata, DiscoveryResult } from "./storage-types";

function parseWwwAuthenticate(header: string): Record<string, string> {
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
    } catch {
      /* try next */
    }
  }
  throw new CategorizedError("discovery_failed");
}

export async function discoverN8n(mcpUrl: string): Promise<DiscoveryResult> {
  try {
    const env = getEnv();
    const prm = await tryFetchProtectedResourceMetadata(mcpUrl);
    let issuer: string;
    let resource: string;
    if (prm) {
      issuer = prm.authorization_servers[0].replace(/\/$/, "");
      resource = prm.resource ?? mcpUrl;
    } else {
      issuer = new URL(mcpUrl).origin;
      resource = mcpUrl;
    }

    const metadata = await fetchAuthorizationServerMetadata(issuer);

    if (env.N8N_AUTHORIZATION_URL) metadata.authorization_endpoint = env.N8N_AUTHORIZATION_URL;
    if (env.N8N_TOKEN_URL) metadata.token_endpoint = env.N8N_TOKEN_URL;
    if (env.N8N_REGISTRATION_URL) metadata.registration_endpoint = env.N8N_REGISTRATION_URL;

    const methods = metadata.code_challenge_methods_supported ?? [];
    if (!methods.includes("S256")) {
      throw new CategorizedError("discovery_failed");
    }

    await putASMetadata(metadata);
    return { issuer: metadata.issuer, resource, metadata };
  } catch (e) {
    if (e instanceof CategorizedError) throw e;
    logCategory("discovery", "discovery_failed");
    throw new CategorizedError("discovery_failed");
  }
}
