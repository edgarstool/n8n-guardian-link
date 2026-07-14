// Server functions for the n8n OAuth connect flow.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { discoverN8n } from "./discovery.server";
import { getEnv, isProduction } from "./env.server";
import {
  CategorizedError,
  ErrorCategory,
  logCategory,
  toCategory,
} from "./errors.server";
import {
  deleteTokens,
  getStorageBackend,
  getTokens,
  type StorageBackend,
} from "./kv.server";
import {
  ensureSessionRow,
  getSessionMcpUrl,
  putPendingAuth,
  putSessionMcpUrl,
} from "./db.server";
import { runInitializeAndListTools } from "./mcp.server";
import { generatePkceVerifier, generateState, pkceChallengeS256 } from "./pkce.server";
import { resolveClientRegistration } from "./registration.server";
import { clearSessionCookie, ensureSessionId } from "./session.server";

// ---------- Save MCP URL ----------

export type SaveMcpUrlResult =
  | { ok: true; mcpUrl: string; callbackUrl: string }
  | { ok: false; error: "invalid_url" | "https_required" | "missing_configuration" };

export const saveN8nMcpUrl = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ mcpUrl: z.string().min(1).max(2048) }).parse(input),
  )
  .handler(async ({ data }): Promise<SaveMcpUrlResult> => {
    const raw = data.mcpUrl.trim();
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, error: "invalid_url" };
    }
    if (isProduction() && parsed.protocol !== "https:") {
      return { ok: false, error: "https_required" };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "invalid_url" };
    }
    try {
      const sid = ensureSessionId();
      await ensureSessionRow(sid);
      // Preserve the URL exactly as pasted (path + trailing slash intact).
      await putSessionMcpUrl(sid, raw);
      return { ok: true, mcpUrl: raw, callbackUrl: getEnv().REDIRECT_URI };
    } catch (e) {
      logCategory("saveN8nMcpUrl", toCategory(e, "missing_configuration"));
      return { ok: false, error: "missing_configuration" };
    }
  });

// ---------- Start OAuth ----------

export type StartResult =
  | { ok: true; authorizeUrl: string; issuer: string; registeredVia: string }
  | { ok: false; error: ErrorCategory };

export const startN8nOAuth = createServerFn({ method: "POST" }).handler(
  async (): Promise<StartResult> => {
    try {
      const env = getEnv();
      const sid = ensureSessionId();
      await ensureSessionRow(sid);
      const mcpUrl = await getSessionMcpUrl(sid);
      if (!mcpUrl) return { ok: false, error: "missing_configuration" };

      const discovery = await discoverN8n(mcpUrl);
      const registration = await resolveClientRegistration(discovery.metadata, env.REDIRECT_URI);

      const state = generateState();
      const verifier = generatePkceVerifier();
      const challenge = await pkceChallengeS256(verifier);

      await putPendingAuth({
        state,
        sid,
        verifier,
        issuer: discovery.issuer,
        resource: discovery.resource,
        redirectUri: env.REDIRECT_URI,
        mcpUrl,
        createdAt: Date.now(),
      });

      const url = new URL(discovery.metadata.authorization_endpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", registration.client_id);
      url.searchParams.set("redirect_uri", env.REDIRECT_URI);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("resource", discovery.resource);
      const scopes = discovery.metadata.scopes_supported ?? [];
      if (scopes.length) url.searchParams.set("scope", scopes.join(" "));

      return {
        ok: true,
        authorizeUrl: url.toString(),
        issuer: discovery.issuer,
        registeredVia: registration.registered_via,
      };
    } catch (e) {
      const cat = toCategory(e, "discovery_failed");
      logCategory("startN8nOAuth", cat);
      return { ok: false, error: cat };
    }
  },
);

// ---------- Status ----------

export type ConnectionStatus =
  | {
      connected: true;
      issuer: string;
      connectedAt: number;
      negotiatedProtocolVersion?: string;
      needsReauth?: boolean;
      storage: StorageBackend;
      mcpUrl?: string;
      callbackUrl: string;
    }
  | {
      connected: false;
      storage: StorageBackend;
      configured: boolean;
      mcpUrl?: string;
      callbackUrl: string;
    };

export const getN8nConnectionStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConnectionStatus> => {
    let storage: StorageBackend = "memory";
    let configured = true;
    try {
      storage = getStorageBackend();
    } catch (e) {
      if (e instanceof CategorizedError && e.category === "missing_configuration") {
        configured = false;
      }
    }
    const callbackUrl = getEnv().REDIRECT_URI;
    try {
      const sid = ensureSessionId();
      await ensureSessionRow(sid);
      const mcpUrl = (await getSessionMcpUrl(sid)) ?? undefined;
      const t = await getTokens(sid);
      if (!t) return { connected: false, storage, configured, mcpUrl, callbackUrl };
      return {
        connected: true,
        issuer: t.issuer,
        connectedAt: t.connected_at,
        negotiatedProtocolVersion: t.negotiated_mcp_protocol_version,
        needsReauth: t.needs_reauth,
        storage,
        mcpUrl,
        callbackUrl,
      };
    } catch {
      return { connected: false, storage, configured, callbackUrl };
    }
  },
);

// ---------- Disconnect ----------

export const disconnectN8n = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const sid = ensureSessionId();
    await deleteTokens(sid);
  } catch {
    /* best-effort */
  }
  clearSessionCookie();
  return { ok: true } as const;
});

// ---------- List tools ----------

export type ListToolsResult =
  | {
      ok: true;
      protocolVersion: string;
      tools: Array<{ name: string; description?: string }>;
    }
  | { ok: false; error: ErrorCategory; needsReauth?: boolean };

export const listN8nMcpTools = createServerFn({ method: "POST" }).handler(
  async (): Promise<ListToolsResult> => {
    try {
      const sid = ensureSessionId();
      const result = await runInitializeAndListTools(sid);
      return {
        ok: true,
        protocolVersion: result.negotiatedProtocolVersion,
        tools: result.tools,
      };
    } catch (e) {
      const cat = toCategory(e, "mcp_tools_list_failed");
      logCategory("listN8nMcpTools", cat);
      return { ok: false, error: cat, needsReauth: cat === "needs_reauth" };
    }
  },
);

export type StorageStatus = { storage: StorageBackend };
export const getStorageStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<StorageStatus> => ({ storage: getStorageBackend() }),
);

// ---------- API keys (session-scoped) ----------

import {
  createApiKey as createApiKeyRow,
  listApiKeys as listApiKeyRows,
  revokeApiKey as revokeApiKeyRow,
  type ApiKeyRow,
} from "./api-keys.server";

export type ListApiKeysResult = { ok: true; keys: ApiKeyRow[] } | { ok: false; error: ErrorCategory };

export const listN8nApiKeys = createServerFn({ method: "GET" }).handler(
  async (): Promise<ListApiKeysResult> => {
    try {
      const sid = ensureSessionId();
      await ensureSessionRow(sid);
      const keys = await listApiKeyRows(sid);
      return { ok: true, keys };
    } catch (e) {
      logCategory("listN8nApiKeys", toCategory(e, "missing_configuration"));
      return { ok: false, error: "missing_configuration" };
    }
  },
);

export type CreateApiKeyResult =
  | { ok: true; id: string; secret: string; prefix: string; label: string | null }
  | { ok: false; error: ErrorCategory };

export const createN8nApiKey = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ label: z.string().max(100).optional() }).parse(input),
  )
  .handler(async ({ data }): Promise<CreateApiKeyResult> => {
    try {
      const sid = ensureSessionId();
      await ensureSessionRow(sid);
      // Require a live n8n connection before minting a key.
      const t = await getTokens(sid);
      if (!t) return { ok: false, error: "needs_reauth" };
      const created = await createApiKeyRow(sid, data.label ?? null);
      return { ok: true, ...created };
    } catch (e) {
      logCategory("createN8nApiKey", toCategory(e, "missing_configuration"));
      return { ok: false, error: "missing_configuration" };
    }
  });

export const revokeN8nApiKey = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    try {
      const sid = ensureSessionId();
      const ok = await revokeApiKeyRow(sid, data.id);
      return { ok };
    } catch {
      return { ok: false };
    }
  });
