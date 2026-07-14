// Server functions for the n8n OAuth connect flow.
// All returned error payloads are allowlisted category strings.

import { createServerFn } from "@tanstack/react-start";
import { discoverN8n } from "./discovery.server";
import { getEnv } from "./env.server";
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
  isKvBindingActive,
  type StorageBackend,
} from "./kv.server";
import { runInitializeAndListTools } from "./mcp.server";
import { setPendingAuthCookie } from "./pending-cookie.server";
import { generatePkceVerifier, generateState, pkceChallengeS256 } from "./pkce.server";
import { resolveClientRegistration } from "./registration.server";
import { clearSessionCookie, ensureSessionId } from "./session.server";

export type StartResult =
  | { ok: true; authorizeUrl: string; issuer: string; registeredVia: string }
  | { ok: false; error: ErrorCategory };

export const startN8nOAuth = createServerFn({ method: "POST" }).handler(
  async (): Promise<StartResult> => {
    try {
      const env = getEnv();
      const discovery = await discoverN8n();
      const registration = await resolveClientRegistration(discovery.metadata, env.REDIRECT_URI);

      ensureSessionId();
      const state = generateState();
      const verifier = generatePkceVerifier();
      const challenge = await pkceChallengeS256(verifier);

      await setPendingAuthCookie({
        state,
        verifier,
        issuer: discovery.issuer,
        resource: discovery.resource,
        redirectUri: env.REDIRECT_URI,
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

export type ConnectionStatus =
  | {
      connected: true;
      issuer: string;
      connectedAt: number;
      negotiatedProtocolVersion?: string;
      needsReauth?: boolean;
      storage: StorageBackend;
    }
  | { connected: false; storage: StorageBackend; configured: boolean };

export const getN8nConnectionStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConnectionStatus> => {
    let storage: StorageBackend = "memory";
    let configured = true;
    try {
      storage = getStorageBackend();
      // Touch env to detect missing_configuration; do not surface raw error.
      getEnv();
    } catch (e) {
      if (e instanceof CategorizedError && e.category === "missing_configuration") {
        configured = false;
      }
    }
    try {
      const sid = ensureSessionId();
      const t = await getTokens(sid);
      if (!t) return { connected: false, storage, configured };
      return {
        connected: true,
        issuer: t.issuer,
        connectedAt: t.connected_at,
        negotiatedProtocolVersion: t.negotiated_mcp_protocol_version,
        needsReauth: t.needs_reauth,
        storage,
      };
    } catch {
      return { connected: false, storage, configured };
    }
  },
);

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

export type StorageStatus = { storage: StorageBackend; kvBindingActive: boolean };
export const getStorageStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<StorageStatus> => {
    return { storage: getStorageBackend(), kvBindingActive: isKvBindingActive() };
  },
);
