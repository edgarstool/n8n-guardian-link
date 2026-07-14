// Focused validation harness for the n8n OAuth client.
// Run with:  bun scripts/validate-n8n.ts
// Exits non-zero if any check fails.

import assert from "node:assert/strict";

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log("       ", (e as Error).message);
    failed++;
  }
}

// ------- 1) env fails closed in production -------
await check(
  "getEnv() throws missing_configuration when SESSION_SECRET is missing in production",
  async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    const { getEnv } = await import("../src/lib/n8n/env.server");
    const { CategorizedError } = await import("../src/lib/n8n/errors.server");
    assert.throws(
      () => getEnv(),
      (err: unknown) =>
        err instanceof CategorizedError && err.category === "missing_configuration",
    );
  },
);

await check("getEnv() throws when SESSION_SECRET too short in production", async () => {
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "tooshort";
  const { getEnv } = await import("../src/lib/n8n/env.server");
  const { CategorizedError } = await import("../src/lib/n8n/errors.server");
  assert.throws(
    () => getEnv(),
    (err: unknown) =>
      err instanceof CategorizedError && err.category === "missing_configuration",
  );
});

await check("getEnv() succeeds in dev without SESSION_SECRET (fallback)", async () => {
  process.env.NODE_ENV = "development";
  delete process.env.SESSION_SECRET;
  const { getEnv } = await import("../src/lib/n8n/env.server");
  const env = getEnv();
  assert.equal(typeof env.SESSION_SECRET, "string");
  assert.ok(env.SESSION_SECRET.length >= 32);
});

// ------- 2) KV fails closed in production -------
await check(
  "getKV() throws missing_configuration when OAUTH_STORE binding is absent in production",
  async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a".repeat(48);
    // Ensure no globalThis binding.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).OAUTH_STORE;
    const { getKV } = await import("../src/lib/n8n/kv.server");
    const { CategorizedError } = await import("../src/lib/n8n/errors.server");
    assert.throws(
      () => getKV(),
      (err: unknown) =>
        err instanceof CategorizedError && err.category === "missing_configuration",
    );
  },
);

// ------- 3) Registration persistence: preconfigured + CIMD survive lookup -------
await check("resolveClientRegistration persists preconfigured registration", async () => {
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "a".repeat(48);
  process.env.N8N_CLIENT_ID = "preconfig-client-id";
  delete process.env.N8N_CLIENT_SECRET;
  const { resolveClientRegistration } = await import("../src/lib/n8n/registration.server");
  const { getRegistration } = await import("../src/lib/n8n/kv.server");
  const meta = {
    issuer: "https://n8n.example.com",
    authorization_endpoint: "https://n8n.example.com/oauth/authorize",
    token_endpoint: "https://n8n.example.com/oauth/token",
    token_endpoint_auth_methods_supported: ["none"],
  };
  const redirect = "https://app.example.com/oauth/n8n/callback";
  const reg = await resolveClientRegistration(meta, redirect);
  assert.equal(reg.registered_via, "preconfigured");
  const persisted = await getRegistration(meta.issuer, redirect);
  assert.ok(persisted, "preconfigured registration not persisted");
  assert.equal(persisted!.client_id, "preconfig-client-id");
});

await check("resolveClientRegistration persists CIMD registration", async () => {
  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "a".repeat(48);
  delete process.env.N8N_CLIENT_ID;
  delete process.env.N8N_CLIENT_SECRET;
  const { resolveClientRegistration } = await import("../src/lib/n8n/registration.server");
  const { getRegistration } = await import("../src/lib/n8n/kv.server");
  const meta = {
    issuer: "https://n8n-cimd.example.com",
    authorization_endpoint: "https://n8n-cimd.example.com/oauth/authorize",
    token_endpoint: "https://n8n-cimd.example.com/oauth/token",
    client_id_metadata_document_supported: true,
  };
  const redirect = "https://app.example.com/oauth/n8n/callback";
  const reg = await resolveClientRegistration(meta, redirect);
  assert.equal(reg.registered_via, "cimd");
  const persisted = await getRegistration(meta.issuer, redirect);
  assert.ok(persisted, "CIMD registration not persisted");
  assert.equal(persisted!.registered_via, "cimd");
});

// ------- 4) Callback never inlines raw exception text -------
await check("callback.tsx does not embed raw exception text in redirect", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile("src/routes/oauth/n8n/callback.tsx", "utf8");
  // Forbid patterns that would push raw error message into UI/logs
  const forbidden = [
    /\.message\.slice/,
    /encodeURIComponent\(msg/,
    /encodeURIComponent\(.*\.message/,
    /reason=\$\{encodeURIComponent\(/, // old pattern
    /console\.error\([^)]*msg/,
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(src), `forbidden pattern found: ${re}`);
  }
});

// ------- 5) Error categories exposed correctly -------
await check("ERROR_CATEGORIES contains all required categories", async () => {
  const { ERROR_CATEGORIES } = await import("../src/lib/n8n/errors");
  for (const req of [
    "access_denied",
    "missing_code_or_state",
    "state_expired",
    "state_mismatch",
    "missing_registration",
    "discovery_failed",
    "token_exchange_failed",
    "mcp_initialize_failed",
    "mcp_initialized_notification_failed",
    "mcp_tools_list_failed",
    "needs_reauth",
    "missing_configuration",
  ] as const) {
    assert.ok(
      (ERROR_CATEGORIES as readonly string[]).includes(req),
      `missing category: ${req}`,
    );
  }
});

// ------- 6) MCP notifications/initialized non-2xx must reject; 401 refresh+retry exactly once -------
// This exercises runInitializeAndListTools with a stubbed global fetch and stubbed KV.
await check(
  "notifications/initialized non-2xx yields mcp_initialized_notification_failed",
  async () => {
    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = "a".repeat(48);
    process.env.N8N_MCP_URL = "https://mcp.example.com/mcp";
    process.env.APP_BASE_URL = "https://app.example.com";

    const { putTokens } = await import("../src/lib/n8n/kv.server");
    const { runInitializeAndListTools } = await import("../src/lib/n8n/mcp.server");
    const { CategorizedError } = await import("../src/lib/n8n/errors.server");

    await putTokens("sid-notif", {
      access_token: "at",
      refresh_token: "rt",
      token_type: "Bearer",
      expires_at: Date.now() + 3600_000,
      issuer: "https://n8n.example.com",
      resource: "https://mcp.example.com/mcp",
      client_id: "cid",
      token_endpoint_auth_method: "none",
      connected_at: Date.now(),
    });

    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls++;
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "2025-11-25" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response("", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await runInitializeAndListTools("sid-notif");
      throw new Error("expected rejection");
    } catch (e) {
      assert.ok(e instanceof CategorizedError, "expected CategorizedError");
      assert.equal(
        (e as InstanceType<typeof CategorizedError>).category,
        "mcp_initialized_notification_failed",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.ok(calls >= 2);
  },
);

await check(
  "tools/list 401 triggers exactly one refresh + one retry, then succeeds",
  async () => {
    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = "a".repeat(48);
    process.env.N8N_MCP_URL = "https://mcp.example.com/mcp";
    process.env.APP_BASE_URL = "https://app.example.com";

    const {
      putTokens,
      putASMetadata,
      putRegistration,
      getTokens,
    } = await import("../src/lib/n8n/kv.server");
    const { runInitializeAndListTools } = await import("../src/lib/n8n/mcp.server");

    await putASMetadata({
      issuer: "https://n8n.example.com",
      authorization_endpoint: "https://n8n.example.com/oauth/authorize",
      token_endpoint: "https://n8n.example.com/oauth/token",
    });
    await putRegistration(
      "https://n8n.example.com",
      "https://app.example.com/oauth/n8n/callback",
      {
        client_id: "cid",
        token_endpoint_auth_method: "none",
        registered_via: "preconfigured",
      },
    );
    await putTokens("sid-retry", {
      access_token: "old-at",
      refresh_token: "rt",
      token_type: "Bearer",
      expires_at: Date.now() + 3600_000,
      issuer: "https://n8n.example.com",
      resource: "https://mcp.example.com/mcp",
      client_id: "cid",
      token_endpoint_auth_method: "none",
      connected_at: Date.now(),
    });

    let toolsListCalls = 0;
    let refreshCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        refreshCalls++;
        return new Response(
          JSON.stringify({
            access_token: "new-at",
            refresh_token: "rt2",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      const authHeader = new Headers(init?.headers).get("authorization") ?? "";
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "2025-11-25" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response("", { status: 202 });
      }
      if (body.method === "tools/list") {
        toolsListCalls++;
        if (authHeader === "Bearer old-at") return new Response("", { status: 401 });
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "t1" }] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      const out = await runInitializeAndListTools("sid-retry");
      assert.equal(out.tools.length, 1);
      assert.equal(toolsListCalls, 2, "tools/list should be called exactly twice (original + one retry)");
      assert.equal(refreshCalls, 1, "refresh should happen exactly once");
      const stored = await getTokens("sid-retry");
      assert.equal(stored?.access_token, "new-at");
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
