// Client registration resolver: preconfigured → CIMD → DCR → error.
// Every resolved registration is persisted with putRegistration(issuer, redirectUri, reg)
// so the callback can retrieve it via getRegistration(issuer, redirectUri).

import { getEnv } from "./env.server";
import { CategorizedError, logCategory } from "./errors.server";
import {
  getRegistration,
  putRegistration,
  type ASMetadata,
  type ClientRegistration,
} from "./kv.server";

function pickAuthMethod(
  supported: string[] | undefined,
  hasSecret: boolean,
): ClientRegistration["token_endpoint_auth_method"] {
  const s = supported ?? [];
  if (hasSecret) {
    if (s.includes("client_secret_basic")) return "client_secret_basic";
    if (s.includes("client_secret_post")) return "client_secret_post";
    return "client_secret_basic";
  }
  if (s.includes("none")) return "none";
  return "none";
}

export async function resolveClientRegistration(
  metadata: ASMetadata,
  redirectUri: string,
): Promise<ClientRegistration> {
  const env = getEnv();

  // 1) Preconfigured
  if (env.N8N_CLIENT_ID) {
    const reg: ClientRegistration = {
      client_id: env.N8N_CLIENT_ID,
      client_secret: env.N8N_CLIENT_SECRET,
      token_endpoint_auth_method: pickAuthMethod(
        metadata.token_endpoint_auth_methods_supported,
        Boolean(env.N8N_CLIENT_SECRET),
      ),
      registered_via: "preconfigured",
    };
    await putRegistration(metadata.issuer, redirectUri, reg);
    return reg;
  }

  // 2) CIMD (Client ID Metadata Document)
  if (metadata.client_id_metadata_document_supported) {
    const reg: ClientRegistration = {
      client_id: env.CLIENT_METADATA_URL,
      token_endpoint_auth_method: "none",
      registered_via: "cimd",
    };
    await putRegistration(metadata.issuer, redirectUri, reg);
    return reg;
  }

  // 3) Cached DCR
  const cached = await getRegistration(metadata.issuer, redirectUri);
  if (cached) return cached;

  // 4) Fresh DCR
  if (!metadata.registration_endpoint) {
    logCategory("registration", "missing_registration");
    throw new CategorizedError("missing_registration");
  }

  const body = {
    client_name: "EDGAR'S Tools — n8n Connector",
    client_uri: env.APP_BASE_URL,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: (metadata.token_endpoint_auth_methods_supported ?? []).includes(
      "none",
    )
      ? "none"
      : "client_secret_basic",
    application_type: "web",
  };
  const r = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    logCategory("registration", "missing_registration", r.status);
    throw new CategorizedError("missing_registration", r.status);
  }
  const data = (await r.json()) as {
    client_id: string;
    client_secret?: string;
    token_endpoint_auth_method?: string;
    registration_client_uri?: string;
    registration_access_token?: string;
  };
  const reg: ClientRegistration = {
    client_id: data.client_id,
    client_secret: data.client_secret,
    token_endpoint_auth_method:
      (data.token_endpoint_auth_method as ClientRegistration["token_endpoint_auth_method"]) ??
      pickAuthMethod(metadata.token_endpoint_auth_methods_supported, Boolean(data.client_secret)),
    registered_via: "dcr",
    registration_client_uri: data.registration_client_uri,
    registration_access_token: data.registration_access_token,
  };
  await putRegistration(metadata.issuer, redirectUri, reg);
  return reg;
}
