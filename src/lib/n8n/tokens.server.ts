// Token exchange + refresh.

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
      "Basic " + btoa(`${encodeURIComponent(reg.client_id)}:${encodeURIComponent(reg.client_secret)}`);
  } else if (reg.token_endpoint_auth_method === "client_secret_post" && reg.client_secret) {
    form.set("client_id", reg.client_id);
    form.set("client_secret", reg.client_secret);
  } else {
    // none
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
    const text = await r.text().catch(() => "");
    throw new Error(`Token exchange failed: ${r.status} ${text.slice(0, 300)}`);
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
    const text = await r.text().catch(() => "");
    throw new Error(`Token refresh failed: ${r.status} ${text.slice(0, 300)}`);
  }
  return (await r.json()) as TokenResponse;
}

export function tokenResponseToStored(
  t: TokenResponse,
  previous: Pick<StoredTokens, "issuer" | "resource" | "client_id" | "token_endpoint_auth_method"> &
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
    client_id: previous.client_id,
    token_endpoint_auth_method: previous.token_endpoint_auth_method,
    negotiated_mcp_protocol_version: previous.negotiated_mcp_protocol_version,
    connected_at: previous.connected_at ?? now,
  };
}

export async function getValidAccessToken(sid: string): Promise<StoredTokens> {
  const t = await getTokens(sid);
  if (!t) throw new Error("not-connected");
  if (t.needs_reauth) throw new Error("needs-reauth");
  const safetyWindow = 60_000;
  if (t.expires_at - safetyWindow > Date.now()) return t;

  // needs refresh
  if (!t.refresh_token) {
    const bad = { ...t, needs_reauth: true };
    await putTokens(sid, bad);
    throw new Error("needs-reauth");
  }
  const meta = await getASMetadata(t.issuer);
  const reg = await getRegistration(t.issuer, `${process.env.APP_BASE_URL ?? "https://connect.edgars.tools"}/oauth/n8n/callback`);
  if (!meta || !reg) throw new Error("missing-metadata-or-registration");

  try {
    const resp = await refreshAccessToken({
      tokenEndpoint: meta.token_endpoint,
      refreshToken: t.refresh_token,
      resource: t.resource,
      registration: reg,
    });
    // Persist rotated refresh token if returned
    const next = tokenResponseToStored(resp, {
      issuer: t.issuer,
      resource: t.resource,
      client_id: t.client_id,
      token_endpoint_auth_method: t.token_endpoint_auth_method,
      connected_at: t.connected_at,
      negotiated_mcp_protocol_version: t.negotiated_mcp_protocol_version,
    });
    // If AS did not return a new refresh_token, keep the previous one
    if (!next.refresh_token) next.refresh_token = t.refresh_token;
    await putTokens(sid, next);
    return next;
  } catch {
    const bad = { ...t, needs_reauth: true };
    await putTokens(sid, bad);
    throw new Error("needs-reauth");
  }
}
