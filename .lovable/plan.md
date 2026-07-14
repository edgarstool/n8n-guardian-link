# n8n MCP OAuth 2.1 Client — Final Build Plan (Corrections Applied)

## Scope

Real OAuth 2.1 + PKCE client for n8n Instance-level MCP, deployed at `https://connect.edgars.tools` on Cloudflare Workers. Discovery-driven, KV-backed, refresh-capable. No manual OAuth endpoint entry, no browser-side tokens.

## Environment Variables

Required:
- `N8N_MCP_URL` — e.g. `https://<n8n-host>/mcp-server/http`
- `APP_BASE_URL=https://connect.edgars.tools` (redirect URI derived: `${APP_BASE_URL}/oauth/n8n/callback`)
- `SESSION_SECRET` — 32+ bytes, for opaque session cookie signing

Optional (diagnostic overrides only, not part of normal flow):
- `N8N_AUTHORIZATION_URL`, `N8N_TOKEN_URL`, `N8N_REGISTRATION_URL`
- `N8N_CLIENT_ID`, `N8N_CLIENT_SECRET` (preregistered path)

Cloudflare binding:
- KV namespace **`OAUTH_STORE`** (declared in `wrangler.toml` / nitro cloudflare preset config)

## Files (created)

1. `src/lib/n8n/discovery.server.ts` — MCP discovery pipeline:
   - Unauthenticated probe of `N8N_MCP_URL` → parse `WWW-Authenticate` for `resource_metadata`.
   - Fallback to RFC 9728 well-known paths (`/.well-known/oauth-protected-resource` on MCP origin + path variants).
   - Fetch Protected Resource Metadata → read `authorization_servers[]`.
   - Fetch AS Metadata (RFC 8414) or OIDC Discovery.
   - Assert `S256 ∈ code_challenge_methods_supported`, else refuse.
   - Return normalized `{ issuer, authorization_endpoint, token_endpoint, registration_endpoint?, scopes_supported, code_challenge_methods_supported, token_endpoint_auth_methods_supported, client_id_metadata_document_supported, resource }`.
   - Apply diagnostic overrides last, only if set.
   - Cache in KV keyed by issuer.

2. `src/lib/n8n/pkce.server.ts` — S256 verifier + challenge, `state` generator, opaque session-ID generator (all via WebCrypto).

3. `src/lib/n8n/kv.server.ts` — Typed KV accessors bound to `OAUTH_STORE`:
   - `putRegistration(issuer, redirectUri, client)` / `getRegistration(issuer, redirectUri)`
   - `putPendingAuth(sessionId, { state, verifier, issuer, resource, redirectUri, expiresAt })` (TTL 10 min)
   - `getPendingAuth(sessionId)` / `deletePendingAuth`
   - `putTokens(sessionId, { access_token, refresh_token, expires_at, token_type, scope, issuer, client_id, token_endpoint_auth_method, connected_at })`
   - `getTokens(sessionId)` / `putASMetadata(issuer, meta)`
   - Access via `getRequestEvent().context.cloudflare.env.OAUTH_STORE`.

4. `src/lib/n8n/registration.server.ts` — Registration priority resolver:
   1. `N8N_CLIENT_ID` preconfigured → return.
   2. `client_id_metadata_document_supported === true` → return `{ client_id: "${APP_BASE_URL}/oauth/client-metadata.json", token_endpoint_auth_method: "none" }`.
   3. `registration_endpoint` present → DCR POST (persisted in KV by `issuer + redirectUri`, reused across sessions).
   4. Throw `missing-client-registration`.
   - Chooses `token_endpoint_auth_method` from intersection of registered method and `token_endpoint_auth_methods_supported`. Never auto-upgrades to `client_secret_post` just because a secret exists.

5. `src/lib/n8n/tokens.server.ts` — Token endpoint calls:
   - Authorization Code + PKCE exchange (includes `resource`).
   - Refresh Token grant, persists rotated refresh_token if returned.
   - `getValidAccessToken(sessionId)` — checks expiry with 60s safety window, refreshes if needed, marks connection `needs_reauth` if refresh fails or no refresh_token.

6. `src/lib/n8n/mcp.server.ts` — MCP client:
   - Supported client versions: `["2025-11-25", "2025-06-18", "2025-03-26"]`; sends latest in `initialize`; accepts server value only if in the list; stores negotiated version in KV; sends `MCP-Protocol-Version: <negotiated>` on all follow-up requests.
   - Accepts both `application/json` and `text/event-stream` (parses SSE `data:` frames).
   - Sequence: `initialize` → `notifications/initialized` → `tools/list`.
   - On HTTP 401: exactly one refresh + retry; then fail with `needs_reauth`.

7. `src/lib/n8n/n8n-oauth.functions.ts` — Server functions:
   - `startN8nOAuth()` → discovery, PKCE, resolve registration, persist pending state to KV under new session ID, set opaque session cookie (HttpOnly, Secure, SameSite=Lax, Path=/), return `authorize_url` including `resource`, `state`, `code_challenge`, `code_challenge_method=S256`.
   - `getN8nConnectionStatus()` → reads tokens from KV via session cookie.
   - `disconnectN8n()` → deletes KV entries and cookie.
   - `listN8nMcpTools()` → runs `initialize`/`initialized`/`tools/list` with valid access token; success only when `tools/list` returns.

8. `src/routes/oauth/n8n/callback.tsx` — Server route:
   - Validates `state` against KV pending entry (single-use, delete on read).
   - Exchanges code (with PKCE verifier + `resource`) at discovered `token_endpoint` using resolved auth method.
   - Persists tokens to KV.
   - Immediately runs `initialize`/`initialized`/`tools/list` to validate.
   - Redirects to `/oauth/n8n/result?status=success|error|cancelled` (never with tokens/codes).

9. `src/routes/oauth/n8n/result.tsx` — Visual page (bilingual, EDGAR'S Tools design), reads status from query; on success shows tool count from a follow-up `listN8nMcpTools` call.

10. `src/routes/oauth/client-metadata[.]json.tsx` — Serves CIMD JSON:
    ```json
    {
      "client_id": "https://connect.edgars.tools/oauth/client-metadata.json",
      "client_name": "EDGAR'S Tools — n8n Connector",
      "client_uri": "https://connect.edgars.tools",
      "redirect_uris": ["https://connect.edgars.tools/oauth/n8n/callback"],
      "grant_types": ["authorization_code", "refresh_token"],
      "response_types": ["code"],
      "token_endpoint_auth_method": "none",
      "application_type": "web"
    }
    ```

11. `src/routes/connect/n8n.tsx` — Landing/connect page (EDGAR'S Tools shell).

12. `src/components/site/*` — `SiteShell`, `Hero`, `StatusPanel`, `Footer` (bilingual copy: 「授權成功」/「授權失敗」/「已取消授權」).

13. `src/routes/index.tsx` — EDGAR'S Tools homepage using SiteShell.

14. `src/styles.css` — Design tokens (deep charcoal, gear accents), Tailwind v4 `@theme`.

## Files (modified)

- `src/routes/__root.tsx` — real head metadata (title, description, OG, Twitter card).
- `wrangler.toml` (or equivalent nitro cloudflare config) — add `OAUTH_STORE` KV binding.

## Security Invariants

- No access/refresh tokens or codes ever reach the browser or logs.
- Cookie carries only opaque session ID (32B random) + HMAC.
- `state` single-use, TTL 10 min, verified server-side.
- PKCE S256 mandatory; refuse if AS doesn't advertise S256.
- Redirect URI hardcoded-derived from `APP_BASE_URL`; not user-configurable.
- DCR client credentials stored only in KV, keyed by `issuer + redirect_uri`.

## Verification (final report items)

- APP_BASE_URL, callback URL, n8n allowlist entry
- Discovered issuer
- Registration mechanism used
- Negotiated MCP protocol version
- KV binding name (`OAUTH_STORE`)
- Refresh test result
- `initialize` / `initialized` / `tools/list` results
- Files changed
- Remaining configuration

## Open Item Requiring User Input Before/After Build

To complete verification and populate the final report, I need from you at build time:
- `N8N_MCP_URL` value (the exact URL from n8n Settings → MCP access)
- Confirmation that the Cloudflare project for this Lovable app has KV enabled (or approval to add the `OAUTH_STORE` binding via `wrangler.toml`)
- Confirmation that `connect.edgars.tools` is (or will be) pointed at this deployment
