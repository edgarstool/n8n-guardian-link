// Token exchange + refresh. Uses the redirect_uri stored on each token row
// so refresh works without depending on the current request origin.

import { CategorizedError, logCategory } from "./errors.server";
import {
  getASMetadata,
  getRegistration,
  getTokens,
  putTokens,
  type ClientRegistration,
  type StoredTokens,
} from "./kv.server";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
};

function buildTokenAuth(
  reg: ClientRegistration,
  form: URLSearchParams,
): { headers: Record<string, string>; body: URLSearchParams } {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (reg.token_endpoint_auth_method === "client_secret_basic" && reg.client_secret) {
    headers["authorization"] =
      "Basic " +
      btoa(`${encodeURIComponent(reg.client_id)}:${encodeURIComponent(reg.client_secret)}`);
  } else if (reg.token_endpoint_auth_method === "client_secret_post" && reg.client_secret) {
    form.set("client_id", reg.client_id);
    form.set("client_secret", reg.client_secret);
  } else {
    form.set("client_id", reg.client_id);
  }
  return { headers, body: form };
}

export async function exchangeAuthorizationCode(args: {
  tokenEndpoint: string;
  code: string;
  verifier: string;
  redirectUri: string;
  resource: string;
  registration: ClientRegistration;
}): Promise<TokenResponse> {
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", args.code);
  form.set("redirect_uri", args.redirectUri);
  form.set("code_verifier", args.verifier);
  form.set("resource", args.resource);
  const { headers, body } = buildTokenAuth(args.registration, form);
  const r = await fetch(args.tokenEndpoint, { method: "POST", headers, body });
  if (!r.ok) {
    await r.text().catch(() => "");
    logCategory("token_exchange", "token_exchange_failed", r.status);
    throw new CategorizedError("token_exchange_failed", r.status);
  }
  return (await r.json()) as TokenResponse;
}

export async function refreshAccessToken(args: {
  tokenEndpoint: string;
  refreshToken: string;
  resource: string;
  registration: ClientRegistration;
}): Promise<TokenResponse> {
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", args.refreshToken);
  form.set("resource", args.resource);
  const { headers, body } = buildTokenAuth(args.registration, form);
  const r = await fetch(args.tokenEndpoint, { method: "POST", headers, body });
  if (!r.ok) {
    await r.text().catch(() => "");
    logCategory("token_refresh", "needs_reauth", r.status);
    throw new CategorizedError("needs_reauth", r.status);
  }
  return (await r.json()) as TokenResponse;
}

export function tokenResponseToStored(
  t: TokenResponse,
  previous: Pick<
    StoredTokens,
    "issuer" | "resource" | "client_id" | "token_endpoint_auth_method" | "redirect_uri"
  > &
    Partial<Pick<StoredTokens, "connected_at" | "negotiated_mcp_protocol_version">>,
): StoredTokens {
  const now = Date.now();
  const expiresIn = (t.expires_in ?? 3600) * 1000;
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? undefined,
    token_type: t.token_type ?? "Bearer",
    expires_at: now + expiresIn,
    scope: t.scope,
    issuer: previous.issuer,
    resource: previous.resource,
    redirect_uri: previous.redirect_uri,
    client_id: previous.client_id,
    token_endpoint_auth_method: previous.token_endpoint_auth_method,
    negotiated_mcp_protocol_version: previous.negotiated_mcp_protocol_version,
    connected_at: previous.connected_at ?? now,
  };
}

export async function getValidAccessToken(sid: string): Promise<StoredTokens> {
  const t = await getTokens(sid);
  if (!t) throw new CategorizedError("needs_reauth");
  if (t.needs_reauth) throw new CategorizedError("needs_reauth");
  const safetyWindow = 60_000;
  if (t.expires_at - safetyWindow > Date.now()) return t;
  return refreshStoredTokens(sid, t);
}

export async function forceRefreshTokens(sid: string): Promise<StoredTokens> {
  const t = await getTokens(sid);
  if (!t) throw new CategorizedError("needs_reauth");
  return refreshStoredTokens(sid, t);
}

async function refreshStoredTokens(sid: string, t: StoredTokens): Promise<StoredTokens> {
  if (!t.refresh_token) {
    await putTokens(sid, { ...t, needs_reauth: true });
    throw new CategorizedError("needs_reauth");
  }
  const meta = await getASMetadata(t.issuer);
  const reg = await getRegistration(t.issuer, t.redirect_uri);
  if (!meta || !reg) {
    await putTokens(sid, { ...t, needs_reauth: true });
    throw new CategorizedError("needs_reauth");
  }
  try {
    const resp = await refreshAccessToken({
      tokenEndpoint: meta.token_endpoint,
      refreshToken: t.refresh_token,
      resource: t.resource,
      registration: reg,
    });
    const next = tokenResponseToStored(resp, {
      issuer: t.issuer,
      resource: t.resource,
      redirect_uri: t.redirect_uri,
      client_id: t.client_id,
      token_endpoint_auth_method: t.token_endpoint_auth_method,
      connected_at: t.connected_at,
      negotiated_mcp_protocol_version: t.negotiated_mcp_protocol_version,
    });
    if (!next.refresh_token) next.refresh_token = t.refresh_token;
    await putTokens(sid, next);
    return next;
  } catch {
    await putTokens(sid, { ...t, needs_reauth: true });
    throw new CategorizedError("needs_reauth");
  }
}
