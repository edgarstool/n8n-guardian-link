import { createFileRoute, redirect } from "@tanstack/react-router";
import { getEnv } from "@/lib/n8n/env.server";
import {
  CategorizedError,
  ErrorCategory,
  logCategory,
  toCategory,
} from "@/lib/n8n/errors.server";
import { getASMetadata, getRegistration, putTokens } from "@/lib/n8n/kv.server";
import { runInitializeAndListTools } from "@/lib/n8n/mcp.server";
import { takePendingAuthCookie } from "@/lib/n8n/pending-cookie.server";
import { ensureSessionId } from "@/lib/n8n/session.server";
import { exchangeAuthorizationCode, tokenResponseToStored } from "@/lib/n8n/tokens.server";

function redirectToResult(
  base: string,
  status: "success" | "error" | "cancelled",
  extras?: { tools?: string; protocol?: string; reason?: ErrorCategory },
): Response {
  const url = new URL(`${base}/oauth/n8n/result`);
  url.searchParams.set("status", status);
  if (extras?.tools) url.searchParams.set("tools", extras.tools);
  if (extras?.protocol) url.searchParams.set("protocol", extras.protocol);
  if (extras?.reason) url.searchParams.set("reason", extras.reason);
  return Response.redirect(url.toString(), 302);
}

async function handleCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // Resolving env may itself throw missing_configuration.
  let appBase: string;
  try {
    appBase = getEnv().APP_BASE_URL;
  } catch (e) {
    const cat = toCategory(e, "missing_configuration");
    logCategory("callback", cat);
    // Fall back to relative URL when app base cannot be resolved.
    return Response.redirect("/oauth/n8n/result?status=error&reason=" + cat, 302);
  }

  // Always consume the pending cookie exactly once, regardless of outcome.
  const pending = await takePendingAuthCookie();

  if (errorParam === "access_denied" || errorParam === "user_cancelled") {
    logCategory("callback", "access_denied");
    return redirectToResult(appBase, "cancelled", { reason: "access_denied" });
  }
  if (errorParam) {
    // Any other provider error → surface only as access_denied category.
    logCategory("callback", "access_denied");
    return redirectToResult(appBase, "error", { reason: "access_denied" });
  }
  if (!code || !state) {
    logCategory("callback", "missing_code_or_state");
    return redirectToResult(appBase, "error", { reason: "missing_code_or_state" });
  }
  if (!pending) {
    logCategory("callback", "state_expired");
    return redirectToResult(appBase, "error", { reason: "state_expired" });
  }
  if (pending.state !== state) {
    logCategory("callback", "state_mismatch");
    return redirectToResult(appBase, "error", { reason: "state_mismatch" });
  }

  const sid = ensureSessionId();

  let category: ErrorCategory = "token_exchange_failed";
  try {
    const meta = await getASMetadata(pending.issuer);
    const reg = await getRegistration(pending.issuer, pending.redirectUri);
    if (!meta || !reg) {
      logCategory("callback", "missing_registration");
      return redirectToResult(appBase, "error", { reason: "missing_registration" });
    }

    category = "token_exchange_failed";
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

    // Full MCP lifecycle validation.
    category = "mcp_initialize_failed";
    const list = await runInitializeAndListTools(sid);

    return redirectToResult(appBase, "success", {
      tools: String(list.tools.length),
      protocol: list.negotiatedProtocolVersion,
    });
  } catch (e) {
    const cat = e instanceof CategorizedError ? e.category : category;
    logCategory("callback", cat);
    return redirectToResult(appBase, "error", { reason: cat });
  }
}

export const Route = createFileRoute("/oauth/n8n/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCallback(request),
    },
  },
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: () => null,
});
