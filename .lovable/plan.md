# n8n MCP OAuth 2.1 Client — Current Build Plan

## Scope

OAuth 2.1 client for n8n Instance-level MCP, deployed at `https://connect.edgars.tools` on Cloudflare Workers. The flow is discovery-driven, requires PKCE S256, supports CIMD/DCR, refreshes tokens server-side, and does not expose tokens to the browser.

## Runtime configuration

Required in production:

- `APP_BASE_URL=https://connect.edgars.tools`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET` before enabling signed session cookies

OAuth target configuration:

- `N8N_MCP_URL`, or a per-session MCP URL stored in `n8n_sessions`

Optional diagnostic or preregistered-client overrides:

- `N8N_AUTHORIZATION_URL`
- `N8N_TOKEN_URL`
- `N8N_REGISTRATION_URL`
- `N8N_CLIENT_ID`
- `N8N_CLIENT_SECRET`

## Storage architecture

`src/lib/n8n/kv.server.ts` is a storage dispatcher retained under its historical filename. Its backend selection order is:

1. **Supabase** when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.
2. **Cloudflare KV** when an `OAUTH_STORE` binding is present.
3. **In-memory storage** only for development and tests.

Production without Supabase or KV is rejected. The current Cloudflare deployment uses Supabase, so `wrangler.toml` does **not** declare or require an `OAUTH_STORE` namespace. KV remains an optional fallback path, not a deployment prerequisite.

Supabase tables:

- `n8n_sessions` — opaque session ID to selected n8n MCP URL
- `n8n_pending_auth` — single-use OAuth state and PKCE verifier
- `n8n_as_metadata` — authorization-server metadata cache
- `n8n_client_registrations` — CIMD/DCR or preregistered client data
- `n8n_tokens` — token payload per opaque session
- `n8n_api_keys` — hashed connector API keys per opaque session

All current server-side database access uses the service-role client. The `n8n_*` records are keyed by anonymous `sid` and are not yet bound to `auth.users`.

## OAuth client flow

1. Discover protected-resource and authorization-server metadata from the n8n MCP endpoint.
2. Require advertised PKCE `S256`.
3. Resolve client registration in this order:
   - preconfigured `N8N_CLIENT_ID`
   - CIMD when supported
   - DCR when a registration endpoint is advertised
4. Store pending state and verifier server-side.
5. Exchange the authorization code and persist tokens server-side.
6. Validate the connection with MCP `initialize`, `notifications/initialized`, and `tools/list`.
7. Refresh tokens server-side when needed.

## Security invariants

- Access tokens, refresh tokens, authorization codes, and PKCE verifiers never reach browser JavaScript or logs.
- OAuth state is single-use and expires after ten minutes.
- Redirect URIs are derived from the request origin or canonical `APP_BASE_URL`.
- Production storage cannot silently fall back to memory.
- The current opaque `n8n_sid` cookie must be HMAC-signed before production, unless it is replaced by Supabase Auth as part of the identity-layer decision.

## Identity-layer status

The connector is currently an OAuth client to n8n, not the Supabase OAuth authorization server. Its anonymous `sid` storage model is independent of Supabase Auth users. Any move to a Supabase user-bound model or `auth.edgars.tools` requires a separate migration and product decision.
