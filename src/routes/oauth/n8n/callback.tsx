import { createFileRoute, redirect } from "@tanstack/react-router";
import { getEnv } from "@/lib/n8n/env.server";
import {
  CategorizedError,
  ErrorCategory,
  logCategory,
  toCategory,
} from "@/lib/n8n/errors.server";
import { getASMetadata, getRegistration, putTokens } from "@/lib/n8n/kv.server";
import { takePendingAuth } from "@/lib/n8n/db.server";
import { runInitializeAndListTools } from "@/lib/n8n/mcp.server";
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

  let appBase: string;
  try {
    appBase = getEnv().APP_BASE_URL;
  } catch (e) {
    const cat = toCategory(e, "missing_configuration");
    logCategory("callback", cat);
    return Response.redirect("/oauth/n8n/result?status=error&reason=" + cat, 302);
  }

  if (errorParam === "access_denied" || errorParam === "user_cancelled") {
    logCategory("callback", "access_denied");
    return redirectToResult(appBase, "cancelled", { reason: "access_denied" });
  }
  if (errorParam) {
    logCategory("callback", "access_denied");
    return redirectToResult(appBase, "error", { reason: "access_denied" });
  }
  if (!code || !state) {
    logCategory("callback", "missing_code_or_state");
    return redirectToResult(appBase, "error", { reason: "missing_code_or_state" });
  }

  const pending = await takePendingAuth(state);
  if (!pending) {
    logCategory("callback", "state_expired");
    return redirectToResult(appBase, "error", { reason: "state_expired" });
  }

  const sid = ensureSessionId();
  // If the cookie session differs from the sid that started the flow, prefer
  // the sid captured at start so tokens land on the same session row.
  const targetSid = pending.sid || sid;

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
      redirect_uri: pending.redirectUri,
      client_id: reg.client_id,
      token_endpoint_auth_method: reg.token_endpoint_auth_method,
    });
    await putTokens(targetSid, stored);

    category = "mcp_initialize_failed";
    const list = await runInitializeAndListTools(targetSid);

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
