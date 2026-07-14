// Cloudflare KV accessor for OAuth persistent state.
// Falls back to in-memory Map for local dev if the binding is unavailable.

import { getRequest } from "@tanstack/react-start/server";

type KVLike = {
  get(key: string, opts?: { type?: "json" | "text" }): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

const memoryStore = new Map<string, { value: string; expiresAt?: number }>();

const memoryKV: KVLike = {
  async get(key, opts) {
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      memoryStore.delete(key);
      return null;
    }
    if (opts?.type === "json") {
      try {
        return JSON.parse(entry.value);
      } catch {
        return null;
      }
    }
    return entry.value;
  },
  async put(key, value, opts) {
    memoryStore.set(key, {
      value,
      expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined,
    });
  },
  async delete(key) {
    memoryStore.delete(key);
  },
};

function readCloudflareEnv(): Record<string, unknown> | undefined {
  try {
    const req = getRequest() as unknown as { context?: Record<string, unknown> };
    const ctx = req?.context as { cloudflare?: { env?: Record<string, unknown> } } | undefined;
    if (ctx?.cloudflare?.env) return ctx.cloudflare.env;
  } catch {
    // no active request
  }
  // Fallback: some runtimes expose env on globalThis
  const g = globalThis as unknown as { OAUTH_STORE?: KVLike };
  if (g.OAUTH_STORE) return { OAUTH_STORE: g.OAUTH_STORE };
  return undefined;
}

let warned = false;
export function getKV(): KVLike {
  const env = readCloudflareEnv();
  const kv = env?.OAUTH_STORE as KVLike | undefined;
  if (kv && typeof kv.get === "function" && typeof kv.put === "function") return kv;
  if (!warned) {
    console.warn(
      "[n8n-oauth] OAUTH_STORE KV binding not found; using in-memory fallback (dev only, non-persistent).",
    );
    warned = true;
  }
  return memoryKV;
}

// --- Typed helpers ---

export type ASMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  grant_types_supported?: string[];
  response_types_supported?: string[];
  // MCP/OAuth 2.1 CIMD hint
  client_id_metadata_document_supported?: boolean;
};

export type DiscoveryResult = {
  issuer: string;
  resource: string; // canonical resource identifier for RFC 8707
  metadata: ASMetadata;
};

export type ClientRegistration = {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method: "none" | "client_secret_basic" | "client_secret_post";
  registered_via: "preconfigured" | "cimd" | "dcr";
  registration_client_uri?: string;
  registration_access_token?: string;
};

export type PendingAuth = {
  state: string;
  verifier: string;
  issuer: string;
  resource: string;
  redirectUri: string;
  clientId: string;
  createdAt: number;
};

export type StoredTokens = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_at: number; // epoch ms
  scope?: string;
  issuer: string;
  resource: string;
  client_id: string;
  token_endpoint_auth_method: ClientRegistration["token_endpoint_auth_method"];
  negotiated_mcp_protocol_version?: string;
  connected_at: number;
  needs_reauth?: boolean;
};

const K = {
  asMeta: (issuer: string) => `as-meta:${issuer}`,
  registration: (issuer: string, redirect: string) => `client:${issuer}::${redirect}`,
  pending: (sid: string) => `pending:${sid}`,
  tokens: (sid: string) => `tokens:${sid}`,
};

export async function putASMetadata(m: ASMetadata) {
  await getKV().put(K.asMeta(m.issuer), JSON.stringify(m), { expirationTtl: 3600 });
}
export async function getASMetadata(issuer: string): Promise<ASMetadata | null> {
  return ((await getKV().get(K.asMeta(issuer), { type: "json" })) as ASMetadata | null) ?? null;
}

export async function putRegistration(issuer: string, redirectUri: string, c: ClientRegistration) {
  await getKV().put(K.registration(issuer, redirectUri), JSON.stringify(c));
}
export async function getRegistration(
  issuer: string,
  redirectUri: string,
): Promise<ClientRegistration | null> {
  return (
    ((await getKV().get(K.registration(issuer, redirectUri), {
      type: "json",
    })) as ClientRegistration | null) ?? null
  );
}

export async function putPendingAuth(sid: string, p: PendingAuth) {
  await getKV().put(K.pending(sid), JSON.stringify(p), { expirationTtl: 600 });
}
export async function takePendingAuth(sid: string): Promise<PendingAuth | null> {
  const v = (await getKV().get(K.pending(sid), { type: "json" })) as PendingAuth | null;
  if (v) await getKV().delete(K.pending(sid));
  return v ?? null;
}

export async function putTokens(sid: string, t: StoredTokens) {
  await getKV().put(K.tokens(sid), JSON.stringify(t));
}
export async function getTokens(sid: string): Promise<StoredTokens | null> {
  return ((await getKV().get(K.tokens(sid), { type: "json" })) as StoredTokens | null) ?? null;
}
export async function deleteTokens(sid: string) {
  await getKV().delete(K.tokens(sid));
}
