import { createFileRoute, redirect } from "@tanstack/react-router";
import { getEnv } from "@/lib/n8n/env.server";
import { getASMetadata, getRegistration, putTokens } from "@/lib/n8n/kv.server";
import { runInitializeAndListTools } from "@/lib/n8n/mcp.server";
import { takePendingAuthCookie } from "@/lib/n8n/pending-cookie.server";
import { ensureSessionId } from "@/lib/n8n/session.server";
import { exchangeAuthorizationCode, tokenResponseToStored } from "@/lib/n8n/tokens.server";

async function handleCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const env = getEnv();
  const resultBase = `${env.APP_BASE_URL}/oauth/n8n/result`;

  // Always consume the pending cookie exactly once, regardless of outcome.
  const pending = await takePendingAuthCookie();

  if (errorParam === "access_denied" || errorParam === "user_cancelled") {
    return Response.redirect(`${resultBase}?status=cancelled`, 302);
  }
  if (errorParam) {
    return Response.redirect(
      `${resultBase}?status=error&reason=${encodeURIComponent(errorParam)}`,
      302,
    );
  }
  if (!code || !state) {
    return Response.redirect(`${resultBase}?status=error&reason=missing_code_or_state`, 302);
  }
  if (!pending) {
    return Response.redirect(`${resultBase}?status=error&reason=state_expired`, 302);
  }
  if (pending.state !== state) {
    return Response.redirect(`${resultBase}?status=error&reason=state_mismatch`, 302);
  }

  // Session ID for KV token storage.
  const sid = ensureSessionId();

  const meta = await getASMetadata(pending.issuer);
  const reg = await getRegistration(pending.issuer, pending.redirectUri);
  if (!meta || !reg) {
    return Response.redirect(`${resultBase}?status=error&reason=missing_registration`, 302);
  }

  try {
    const tokenResp = await exchangeAuthorizationCode({
      tokenEndpoint: meta.token_endpoint,
      code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
      resource: pending.resource,
      registration: reg,
    });
    const stored = tokenResponseToStored(tokenResp, {
      issuer: pending.issuer,
      resource: pending.resource,
      client_id: reg.client_id,
      token_endpoint_auth_method: reg.token_endpoint_auth_method,
    });
    await putTokens(sid, stored);

    // Validate with initialize → notifications/initialized → tools/list
    const list = await runInitializeAndListTools(sid);
    return Response.redirect(
      `${resultBase}?status=success&tools=${encodeURIComponent(String(list.tools.length))}&protocol=${encodeURIComponent(list.negotiatedProtocolVersion)}`,
      302,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oauth/callback] failed:", msg);
    return Response.redirect(
      `${resultBase}?status=error&reason=${encodeURIComponent(msg.slice(0, 120))}`,
      302,
    );
  }
}

export const Route = createFileRoute("/oauth/n8n/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCallback(request),
    },
  },
  // If somehow rendered as a page, immediately redirect home.
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: () => null,
});
