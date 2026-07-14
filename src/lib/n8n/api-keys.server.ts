// Personal API-key management for the temporary HTTP/OpenAPI adapter.
// Keys are session-scoped. Only a SHA-256 digest of the secret is persisted.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ApiKeyRow = {
  id: string;
  sid: string;
  label: string | null;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const KEY_PREFIX = "n8n_live_";

function db() {
  return supabaseAdmin as unknown as { from: (t: string) => any };
}

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateApiKeySecret(): { secret: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const random = toB64Url(bytes);
  const secret = `${KEY_PREFIX}${random}`;
  return { secret, prefix: secret.slice(0, 16) };
}

export async function createApiKey(
  sid: string,
  label: string | null,
): Promise<{ id: string; secret: string; prefix: string; label: string | null }> {
  const { secret, prefix } = generateApiKeySecret();
  const key_hash = await sha256Hex(secret);
  const trimmedLabel = label?.trim() ? label.trim().slice(0, 100) : null;
  const r = await db()
    .from("n8n_api_keys")
    .insert({ sid, label: trimmedLabel, prefix, key_hash })
    .select("id")
    .single();
  if (r.error) throw new Error("api_key_create_failed");
  return { id: r.data.id as string, secret, prefix, label: trimmedLabel };
}

export async function listApiKeys(sid: string): Promise<ApiKeyRow[]> {
  const r = await db()
    .from("n8n_api_keys")
    .select("id,sid,label,prefix,created_at,last_used_at,revoked_at")
    .eq("sid", sid)
    .order("created_at", { ascending: false });
  return (r.data ?? []) as ApiKeyRow[];
}

export async function revokeApiKey(sid: string, id: string): Promise<boolean> {
  const r = await db()
    .from("n8n_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("sid", sid)
    .eq("id", id)
    .is("revoked_at", null)
    .select("id");
  return !!r.data?.length;
}

/** Look up a live (non-revoked) key by its secret. Updates last_used_at. */
export async function resolveApiKeySid(secret: string): Promise<string | null> {
  if (!secret.startsWith(KEY_PREFIX)) return null;
  const key_hash = await sha256Hex(secret);
  const r = await db()
    .from("n8n_api_keys")
    .select("id,sid,revoked_at")
    .eq("key_hash", key_hash)
    .maybeSingle();
  const row = r.data as { id: string; sid: string; revoked_at: string | null } | null;
  if (!row || row.revoked_at) return null;
  // Best-effort last-used timestamp; never blocks the request.
  db()
    .from("n8n_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => {}, () => {});
  return row.sid;
}
