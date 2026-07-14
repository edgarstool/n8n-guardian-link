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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
