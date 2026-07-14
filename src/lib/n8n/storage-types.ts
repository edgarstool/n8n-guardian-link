// Shared types for the OAuth Connector storage layer.

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
  client_id_metadata_document_supported?: boolean;
};

export type DiscoveryResult = {
  issuer: string;
  resource: string;
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

export type StoredTokens = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_at: number;
  scope?: string;
  issuer: string;
  resource: string;
  redirect_uri: string;
  client_id: string;
  token_endpoint_auth_method: ClientRegistration["token_endpoint_auth_method"];
  negotiated_mcp_protocol_version?: string;
  connected_at: number;
  needs_reauth?: boolean;
};
