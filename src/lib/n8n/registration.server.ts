// Client registration resolver: preconfigured → CIMD → DCR → error.

import { getEnv } from "./env.server";
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
    return {
      client_id: env.N8N_CLIENT_ID,
      client_secret: env.N8N_CLIENT_SECRET,
      token_endpoint_auth_method: pickAuthMethod(
        metadata.token_endpoint_auth_methods_supported,
        Boolean(env.N8N_CLIENT_SECRET),
      ),
      registered_via: "preconfigured",
    };
  }

  // 2) CIMD (Client ID Metadata Document)
  if (metadata.client_id_metadata_document_supported) {
    return {
      client_id: env.CLIENT_METADATA_URL,
      token_endpoint_auth_method: "none",
      registered_via: "cimd",
    };
  }

  // 3) Cached DCR
  const cached = await getRegistration(metadata.issuer, redirectUri);
  if (cached) return cached;

  // 4) Fresh DCR
  if (!metadata.registration_endpoint) {
    throw new Error(
      "missing-client-registration: AS does not advertise CIMD or registration_endpoint, and no N8N_CLIENT_ID is set.",
    );
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
    const text = await r.text().catch(() => "");
    throw new Error(`Dynamic client registration failed: ${r.status} ${text.slice(0, 200)}`);
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
