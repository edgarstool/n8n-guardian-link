// HTTP Bearer auth for the temporary /api/n8n adapter.
import { CategorizedError } from "./errors.server";
import { resolveApiKeySid } from "./api-keys.server";

export async function requireBearerSid(request: Request): Promise<string> {
  const h = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!h || !h.toLowerCase().startsWith("bearer ")) {
    throw new CategorizedError("unauthorized", 401);
  }
  const token = h.slice(7).trim();
  if (!token) throw new CategorizedError("unauthorized", 401);
  const sid = await resolveApiKeySid(token);
  if (!sid) throw new CategorizedError("unauthorized", 401);
  return sid;
}

export function jsonError(category: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: category }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function jsonOk(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, ...(payload as object) }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
