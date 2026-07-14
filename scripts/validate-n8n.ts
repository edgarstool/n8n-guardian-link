// Focused validation for the temporary Lovable-hosted launch path.
// Run: bun run scripts/validate-n8n.ts
import assert from "node:assert/strict";

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}\n     ${(e as Error).message}`);
    failed++;
  }
}

console.log("focused validation");

// --- errors: only allowlisted categories are ever surfaced ---
await check("error categories are frozen allowlist", async () => {
  const mod = await import("../src/lib/n8n/errors");
  const cats = mod.ERROR_CATEGORIES as readonly string[];
  assert.ok(cats.includes("missing_configuration"));
  assert.ok(cats.includes("state_expired"));
  assert.ok(!cats.includes("raw_error"));
});

// --- env: dynamic origin, no SESSION_SECRET required ---
await check("getEnv() works without SESSION_SECRET", async () => {
  delete process.env.SESSION_SECRET;
  process.env.APP_BASE_URL = "https://example.com";
  const { getEnv } = await import("../src/lib/n8n/env.server");
  const env = getEnv();
  assert.equal(env.APP_BASE_URL, "https://example.com");
  assert.equal(env.REDIRECT_URI, "https://example.com/oauth/n8n/callback");
  assert.equal(env.CLIENT_METADATA_URL, "https://example.com/oauth/client-metadata.json");
});

// --- storage backend selection ---
await check("storage backend prefers supabase when configured", async () => {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
  const { getStorageBackend } = await import("../src/lib/n8n/kv.server");
  assert.equal(getStorageBackend(), "supabase");
});

// --- api-keys: hash + secret shape ---
await check("api-key secret hashes deterministically", async () => {
  const { sha256Hex, generateApiKeySecret } = await import("../src/lib/n8n/api-keys.server");
  const { secret, prefix } = generateApiKeySecret();
  assert.ok(secret.startsWith("n8n_live_"));
  assert.equal(prefix, secret.slice(0, 16));
  const h1 = await sha256Hex(secret);
  const h2 = await sha256Hex(secret);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.notEqual(h1, await sha256Hex(secret + "x"));
});

// --- errors: new categories exist ---
await check("new error categories present", async () => {
  const { ERROR_CATEGORIES } = await import("../src/lib/n8n/errors");
  const cats = ERROR_CATEGORIES as readonly string[];
  for (const c of ["unauthorized", "invalid_request", "mcp_tools_call_failed"]) {
    assert.ok(cats.includes(c), `missing ${c}`);
  }
});

// --- api-auth: missing / invalid bearer rejected ---
await check("requireBearerSid rejects missing/invalid tokens", async () => {
  const { requireBearerSid } = await import("../src/lib/n8n/api-auth.server");
  const noHeader = new Request("http://x/", {});
  await assert.rejects(() => requireBearerSid(noHeader), /unauthorized/);
  const badScheme = new Request("http://x/", { headers: { authorization: "Basic abc" } });
  await assert.rejects(() => requireBearerSid(badScheme), /unauthorized/);
  const wrongPrefix = new Request("http://x/", { headers: { authorization: "Bearer notakey" } });
  await assert.rejects(() => requireBearerSid(wrongPrefix), /unauthorized/);
});

// --- mcp: tools/call payload shape ---
await check("mcp tools/call builds JSON-RPC params correctly", async () => {
  // Verify shape via a stub fetch. We validate the exported function threads name/arguments.
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  const jsonResp = (result: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
  globalThis.fetch = (async (input: any, init: any) => {
    const body = JSON.parse(init.body as string);
    calls.push({ url: String(input), body });
    if (body.method === "initialize")
      return jsonResp({ protocolVersion: "2025-11-25" }, { "mcp-session-id": "sess-1" });
    if (body.method?.startsWith("notifications/")) return new Response("", { status: 200 });
    if (body.method === "tools/call")
      return jsonResp({ content: [{ type: "text", text: "ok" }] });
    return new Response("no", { status: 500 });
  }) as typeof fetch;
  try {
    // Stub dependencies used by runInitializeAndCallTool
    const envMod: any = await import("../src/lib/n8n/env.server");
    const origReq = envMod.requireSessionMcpUrl;
    envMod.requireSessionMcpUrl = async () => "https://example.n8n.cloud/mcp-server/http";
    const tokMod: any = await import("../src/lib/n8n/tokens.server");
    const origTok = tokMod.getValidAccessToken;
    tokMod.getValidAccessToken = async () => ({ access_token: "at-1", refresh_token: "rt-1" });
    const kvMod: any = await import("../src/lib/n8n/kv.server");
    const origGet = kvMod.getTokens, origPut = kvMod.putTokens;
    kvMod.getTokens = async () => null; kvMod.putTokens = async () => {};
    const mcp = await import("../src/lib/n8n/mcp.server");
    const r = await mcp.runInitializeAndCallTool("sid-x", "my_tool", { a: 1 });
    assert.equal(r.negotiatedProtocolVersion, "2025-11-25");
    const call = calls.find((c) => c.body.method === "tools/call");
    assert.ok(call, "tools/call fetch was made");
    assert.equal(call!.body.params.name, "my_tool");
    assert.deepEqual(call!.body.params.arguments, { a: 1 });
    envMod.requireSessionMcpUrl = origReq;
    tokMod.getValidAccessToken = origTok;
    kvMod.getTokens = origGet; kvMod.putTokens = origPut;
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- mcp: one refresh + one retry on 401 ---
await check("mcp retries once with a refreshed token on 401", async () => {
  const originalFetch = globalThis.fetch;
  let initCalls = 0;
  globalThis.fetch = (async (_input: any, init: any) => {
    const body = JSON.parse(init.body as string);
    if (body.method === "initialize") {
      initCalls++;
      const authHeader = (init.headers as any).authorization ?? "";
      if (authHeader.includes("bad-token") && initCalls === 1) {
        return new Response("", { status: 401 });
      }
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25" } }),
        { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } },
      );
    }
    if (body.method?.startsWith("notifications/")) return new Response("", { status: 200 });
    if (body.method === "tools/list")
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "x" }] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    return new Response("no", { status: 500 });
  }) as typeof fetch;
  try {
    const envMod: any = await import("../src/lib/n8n/env.server");
    envMod.requireSessionMcpUrl = async () => "https://example.n8n.cloud/mcp-server/http";
    const tokMod: any = await import("../src/lib/n8n/tokens.server");
    tokMod.getValidAccessToken = async () => ({ access_token: "bad-token" });
    tokMod.forceRefreshTokens = async () => ({ access_token: "good-token" });
    const kvMod: any = await import("../src/lib/n8n/kv.server");
    kvMod.getTokens = async () => null; kvMod.putTokens = async () => {};
    const mcp = await import("../src/lib/n8n/mcp.server");
    const r = await mcp.runInitializeAndListTools("sid-y");
    assert.equal(initCalls, 2, "initialize retried once");
    assert.equal(r.tools[0]?.name, "x");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- openapi: describes both routes with bearer auth ---
await check("openapi document lists both endpoints with bearer auth", async () => {
  // Import the route module and invoke its handler.
  const mod = await import("../src/routes/openapi[.]json");
  const handler = (mod as any).Route.options.server.handlers.GET;
  const res: Response = await handler({ request: new Request("https://example.com/openapi.json") });
  const doc = JSON.parse(await res.text());
  assert.equal(doc.openapi, "3.1.0");
  assert.ok(doc.paths["/api/n8n/tools"].get);
  assert.ok(doc.paths["/api/n8n/call"].post);
  assert.equal(doc.components.securitySchemes.bearerAuth.scheme, "bearer");
  assert.deepEqual(doc.security, [{ bearerAuth: [] }]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
