// Storage dispatcher for the OAuth Connector.
// Backend selection order:
//   1. supabase — when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (Lovable Cloud / hosted).
//   2. kv       — when a Cloudflare Workers OAUTH_STORE binding is active.
//   3. memory   — dev/test only; never used in production.

import { getRequest } from "@tanstack/react-start/server";
import { CategorizedError } from "./errors.server";
import { isProduction } from "./env.server";
import {
  deleteTokensDb,
  getASMetadataDb,
  getRegistrationDb,
  getTokensDb,
  putASMetadataDb,
  putRegistrationDb,
  putTokensDb,
} from "./db.server";
import type {
  ASMetadata,
  ClientRegistration,
  DiscoveryResult,
  StoredTokens,
} from "./storage-types";

export type {
  ASMetadata,
  ClientRegistration,
  DiscoveryResult,
  StoredTokens,
};

type KVLike = {
  get(key: string, opts?: { type?: "json" | "text" }): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

// --- Cloudflare KV detection (preserved for the later hardened path) ---

function readCloudflareEnv(): Record<string, unknown> | undefined {
  try {
    const req = getRequest() as unknown as { context?: Record<string, unknown> };
    const ctx = req?.context as { cloudflare?: { env?: Record<string, unknown> } } | undefined;
    if (ctx?.cloudflare?.env) return ctx.cloudflare.env;
  } catch {
    /* no active request */
  }
  const g = globalThis as unknown as { OAUTH_STORE?: KVLike };
  if (g.OAUTH_STORE) return { OAUTH_STORE: g.OAUTH_STORE };
  return undefined;
}

function resolveBoundKV(): KVLike | null {
  const env = readCloudflareEnv();
  const kv = env?.OAUTH_STORE as KVLike | undefined;
  if (kv && typeof kv.get === "function" && typeof kv.put === "function") return kv;
  return null;
}

export function isKvBindingActive(): boolean {
  return resolveBoundKV() !== null;
}

function hasSupabaseConfig(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export type StorageBackend = "supabase" | "kv" | "memory";

export function getStorageBackend(): StorageBackend {
  if (hasSupabaseConfig()) return "supabase";
  if (isKvBindingActive()) return "kv";
  return "memory";
}

// --- In-memory fallback (dev only) ---

const memoryMeta = new Map<string, ASMetadata>();
const memoryReg = new Map<string, ClientRegistration>();
const memoryTokens = new Map<string, StoredTokens>();
let warnedDev = false;
function memoryWarn() {
  if (warnedDev) return;
  warnedDev = true;
  console.warn(
    "[n8n-oauth] No Supabase or Cloudflare KV storage detected; using in-memory (dev only).",
  );
}
function regKey(issuer: string, redirect: string) {
  return `${issuer}::${redirect}`;
}

// --- KV JSON helpers (Cloudflare path) ---

async function kvGet<T>(kv: KVLike, key: string): Promise<T | null> {
  return ((await kv.get(key, { type: "json" })) as T | null) ?? null;
}

// --- Typed helpers ---

export async function putASMetadata(m: ASMetadata): Promise<void> {
  const backend = getStorageBackend();
  if (backend === "supabase") return putASMetadataDb(m);
  const kv = resolveBoundKV();
  if (kv) return kv.put(`as-meta:${m.issuer}`, JSON.stringify(m), { expirationTtl: 3600 });
  if (isProduction()) throw new CategorizedError("missing_configuration");
  memoryWarn();
  memoryMeta.set(m.issuer, m);
}

export async function getASMetadata(issuer: string): Promise<ASMetadata | null> {
  const backend = getStorageBackend();
  if (backend === "supabase") return getASMetadataDb(issuer);
  const kv = resolveBoundKV();
  if (kv) return kvGet<ASMetadata>(kv, `as-meta:${issuer}`);
  if (isProduction()) throw new CategorizedError("missing_configuration");
  memoryWarn();
  return memoryMeta.get(issuer) ?? null;
}

export async function putRegistration(
  issuer: string,
  redirectUri: string,
  c: ClientRegistration,
): Promise<void> {
  const backend = getStorageBackend();
  if (backend === "supabase") return putRegistrationDb(issuer, redirectUri, c);
  const kv = resolveBoundKV();
  if (kv) return kv.put(`client:${issuer}::${redirectUri}`, JSON.stringify(c));
  if (isProduction()) throw new CategorizedError("missing_configuration");
  memoryWarn();
  memoryReg.set(regKey(issuer, redirectUri), c);
}

export async function getRegistration(
  issuer: string,
  redirectUri: string,
): Promise<ClientRegistration | null> {
  const backend = getStorageBackend();
  if (backend === "supabase") return getRegistrationDb(issuer, redirectUri);
  const kv = resolveBoundKV();
  if (kv) return kvGet<ClientRegistration>(kv, `client:${issuer}::${redirectUri}`);
  if (isProduction()) throw new CategorizedError("missing_configuration");
  memoryWarn();
  return memoryReg.get(regKey(issuer, redirectUri)) ?? null;
}

export async function putTokens(sid: string, t: StoredTokens): Promise<void> {
  const backend = getStorageBackend();
  if (backend === "supabase") return putTokensDb(sid, t);
  const kv = resolveBoundKV();
  if (kv) return kv.put(`tokens:${sid}`, JSON.stringify(t));
  if (isProduction()) throw new CategorizedError("missing_configuration");
  memoryWarn();
  memoryTokens.set(sid, t);
}

export async function getTokens(sid: string): Promise<StoredTokens | null> {
  const backend = getStorageBackend();
  if (backend === "supabase") return getTokensDb(sid);
  const kv = resolveBoundKV();
  if (kv) return kvGet<StoredTokens>(kv, `tokens:${sid}`);
  if (isProduction()) throw new CategorizedError("missing_configuration");
  memoryWarn();
  return memoryTokens.get(sid) ?? null;
}

export async function deleteTokens(sid: string): Promise<void> {
  const backend = getStorageBackend();
  if (backend === "supabase") return deleteTokensDb(sid);
  const kv = resolveBoundKV();
  if (kv) return kv.delete(`tokens:${sid}`);
  if (isProduction()) throw new CategorizedError("missing_configuration");
  memoryTokens.delete(sid);
}
