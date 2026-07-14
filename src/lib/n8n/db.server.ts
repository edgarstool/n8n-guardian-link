// Supabase-backed server storage adapter for the n8n OAuth Connector.
// All access uses the service-role admin client; no client-side reads.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  ASMetadata,
  ClientRegistration,
  StoredTokens,
} from "./storage-types";

type PendingRow = {
  state: string;
  sid: string;
  verifier: string;
  issuer: string;
  resource: string;
  redirect_uri: string;
  mcp_url: string;
  created_at: string;
};

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

function db() {
  // Cast to any: the generated Database type has no tables yet for these,
  // but the service-role client accesses them directly.
  return supabaseAdmin as unknown as {
    from: (t: string) => any;
  };
}

// -------- Sessions --------

export async function putSessionMcpUrl(sid: string, mcpUrl: string): Promise<void> {
  await db().from("n8n_sessions").upsert(
    { sid, mcp_url: mcpUrl, updated_at: new Date().toISOString() },
    { onConflict: "sid" },
  );
}

export async function getSessionMcpUrl(sid: string): Promise<string | null> {
  const r = await db()
    .from("n8n_sessions")
    .select("mcp_url")
    .eq("sid", sid)
    .maybeSingle();
  return (r.data?.mcp_url as string | undefined) ?? null;
}

export async function ensureSessionRow(sid: string): Promise<void> {
  await db()
    .from("n8n_sessions")
    .upsert({ sid }, { onConflict: "sid", ignoreDuplicates: true });
}

// -------- Pending auth (state → verifier/issuer/etc) --------

export type PendingAuth = {
  state: string;
  sid: string;
  verifier: string;
  issuer: string;
  resource: string;
  redirectUri: string;
  mcpUrl: string;
  createdAt: number;
};

export async function putPendingAuth(p: PendingAuth): Promise<void> {
  await db().from("n8n_pending_auth").upsert(
    {
      state: p.state,
      sid: p.sid,
      verifier: p.verifier,
      issuer: p.issuer,
      resource: p.resource,
      redirect_uri: p.redirectUri,
      mcp_url: p.mcpUrl,
      created_at: new Date(p.createdAt).toISOString(),
    },
    { onConflict: "state" },
  );
}

export async function takePendingAuth(state: string): Promise<PendingAuth | null> {
  const r = await db()
    .from("n8n_pending_auth")
    .select("*")
    .eq("state", state)
    .maybeSingle();
  if (!r.data) return null;
  // Single-use: delete immediately.
  await db().from("n8n_pending_auth").delete().eq("state", state);
  const row = r.data as PendingRow;
  const createdAt = new Date(row.created_at).getTime();
  if (Date.now() - createdAt > PENDING_TTL_MS) return null;
  return {
    state: row.state,
    sid: row.sid,
    verifier: row.verifier,
    issuer: row.issuer,
    resource: row.resource,
    redirectUri: row.redirect_uri,
    mcpUrl: row.mcp_url,
    createdAt,
  };
}

// -------- AS metadata cache --------

export async function putASMetadataDb(m: ASMetadata): Promise<void> {
  await db().from("n8n_as_metadata").upsert(
    { issuer: m.issuer, metadata: m, updated_at: new Date().toISOString() },
    { onConflict: "issuer" },
  );
}

export async function getASMetadataDb(issuer: string): Promise<ASMetadata | null> {
  const r = await db()
    .from("n8n_as_metadata")
    .select("metadata")
    .eq("issuer", issuer)
    .maybeSingle();
  return (r.data?.metadata as ASMetadata | undefined) ?? null;
}

// -------- Client registrations --------

export async function putRegistrationDb(
  issuer: string,
  redirectUri: string,
  reg: ClientRegistration,
): Promise<void> {
  await db().from("n8n_client_registrations").upsert(
    {
      issuer,
      redirect_uri: redirectUri,
      registration: reg,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "issuer,redirect_uri" },
  );
}

export async function getRegistrationDb(
  issuer: string,
  redirectUri: string,
): Promise<ClientRegistration | null> {
  const r = await db()
    .from("n8n_client_registrations")
    .select("registration")
    .eq("issuer", issuer)
    .eq("redirect_uri", redirectUri)
    .maybeSingle();
  return (r.data?.registration as ClientRegistration | undefined) ?? null;
}

// -------- Tokens --------

export async function putTokensDb(sid: string, t: StoredTokens): Promise<void> {
  await db().from("n8n_tokens").upsert(
    { sid, data: t, updated_at: new Date().toISOString() },
    { onConflict: "sid" },
  );
}

export async function getTokensDb(sid: string): Promise<StoredTokens | null> {
  const r = await db()
    .from("n8n_tokens")
    .select("data")
    .eq("sid", sid)
    .maybeSingle();
  return (r.data?.data as StoredTokens | undefined) ?? null;
}

export async function deleteTokensDb(sid: string): Promise<void> {
  await db().from("n8n_tokens").delete().eq("sid", sid);
}
