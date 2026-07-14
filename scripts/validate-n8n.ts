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
  const mcp = await import("../src/lib/n8n/mcp.server");
  const body = mcp._buildToolsCallBody("my_tool", { a: 1, b: "x" });
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "my_tool");
  assert.deepEqual(body.params.arguments, { a: 1, b: "x" });
  const empty = mcp._buildToolsCallBody("t", {} as any);
  assert.deepEqual(empty.params.arguments, {});
});

// --- mcp: one refresh + one retry on 401, then success ---
await check("mcp retries once with a refreshed token on 401", async () => {
  const originalFetch = globalThis.fetch;
  const seenTokens: string[] = [];
  let call = 0;
  globalThis.fetch = (async (_input: any, init: any) => {
    call++;
    const auth = (init.headers as any).authorization ?? "";
    seenTokens.push(auth);
    if (call === 1) return new Response("", { status: 401 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const mcp = await import("../src/lib/n8n/mcp.server");
    let refreshCalls = 0;
    const r = await mcp._fetchWithRetry({
      url: "https://example.n8n.cloud/mcp-server/http",
      body: mcp._buildToolsCallBody("t", {}),
      base: { accessToken: "bad-token" },
      refresh: async () => {
        refreshCalls++;
        return "good-token";
      },
    });
    assert.equal(call, 2, "fetch called twice");
    assert.equal(refreshCalls, 1, "refresh called exactly once");
    assert.equal(seenTokens[0], "Bearer bad-token");
    assert.equal(seenTokens[1], "Bearer good-token");
    assert.equal(r.response.status, 200);
    assert.equal(r.usedToken, "good-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- openapi: describes both routes with bearer auth ---
await check("openapi document lists both endpoints with bearer auth", async () => {
  const mod: any = await import("../src/routes/openapi[.]json");
  const handler = mod.Route.options.server.handlers.GET;
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
